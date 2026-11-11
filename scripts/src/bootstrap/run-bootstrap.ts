// Idempotent database bootstrap: databases → extensions → roles' passwords (last, so a failure
// earlier never loses a freshly generated password). Connects to the DIRECT endpoint.
//
// Three modes, picked from what the admin role may do:
//   dedicated-owner  admin is a superuser (native local Postgres, ADR-012): creates a separate
//                    NOSUPERUSER owner role that owns the databases and runs migrations, so
//                    SECURITY DEFINER functions never run as a superuser (same as Neon and CI).
//   admin-owner      admin has CREATEDB + CREATEROLE but isn't a superuser (Neon's neondb_owner,
//                    CI's revops_owner): the admin itself owns the databases.
//   verify-only      admin can do neither but owns every database (a rerun with only
//                    DATABASE_URL_OWNER left): nothing is created, only checked.
import postgres from 'postgres';
import {
  assertIdentifier,
  deriveHosts,
  generatePassword,
  passwordLiteral,
  withTarget,
} from './db-urls.js';

export const REQUIRED_EXTENSIONS = ['citext', 'pg_trgm'] as const;
/** pgvector: needed from M4 (knowledge base). Missing locally is a warning, not a failure. */
export const OPTIONAL_EXTENSIONS = ['vector'] as const;

export type BootstrapMode = 'dedicated-owner' | 'admin-owner' | 'verify-only';

export interface BootstrapOptions {
  /** Admin role URL (pooled or direct — the direct host is always used). */
  adminUrl: string;
  databases: readonly string[];
  appRole: string;
  /** Owner role created in dedicated-owner mode. */
  ownerRole: string;
  /** Rotate the app role's password even if it already exists. */
  resetAppPassword?: boolean;
  /** Rotate the dedicated owner role's password even if it already exists. */
  resetOwnerPassword?: boolean;
  log?: (message: string) => void;
}

export interface RoleOutcome {
  role: string;
  created: boolean;
  passwordReset: boolean;
  /**
   * Set only when this run created the role or reset its password. In admin-owner/verify-only
   * mode the owner is the admin and this is the admin URL's password. Null = unknown, not shown.
   */
  password: string | null;
}

export interface BootstrapResult {
  mode: BootstrapMode;
  /** The admin URL on the direct host. */
  adminUrl: URL;
  createdDatabases: string[];
  existingDatabases: string[];
  /** Installed extensions per database (required + optional that are present). */
  extensions: Record<string, string[]>;
  /** Optional extensions that are not installed, per database (e.g. pgvector not on this server). */
  missingOptional: Record<string, string[]>;
  owner: RoleOutcome;
  app: RoleOutcome;
}

function connect(url: URL): postgres.Sql {
  return postgres(url.toString(), {
    max: 1,
    prepare: false,
    connect_timeout: 15,
    onnotice: () => undefined, // "extension already exists, skipping"
  });
}

async function withSql<T>(url: URL, fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = connect(url);
  try {
    return await fn(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * True if `url` logs in; false only on a wrong password (28P01) or unknown role (28000).
 * Anything else (network, TLS) is rethrown so it is never mistaken for a bad password.
 */
export async function canLogin(url: URL): Promise<boolean> {
  try {
    await withSql(url, (sql) => sql`select 1`);
    return true;
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === '28P01' || code === '28000') return false;
    throw error;
  }
}

interface AdminFacts {
  name: string;
  superuser: boolean;
  createdb: boolean;
  createrole: boolean;
}

function pickMode(admin: AdminFacts, ownsAll: boolean): BootstrapMode {
  if (admin.superuser) return 'dedicated-owner';
  if (admin.createdb && admin.createrole) return 'admin-owner';
  if (ownsAll) return 'verify-only';
  throw new Error(
    `role "${admin.name}" lacks CREATEDB + CREATEROLE — use a superuser (local Postgres: postgres) ` +
      'or the Neon owner role (neondb_owner) in DB_BOOTSTRAP_URL',
  );
}

async function ensureExtensions(
  sql: postgres.Sql,
  db: string,
  log: (message: string) => void,
): Promise<{ installed: string[]; missingOptional: string[] }> {
  const all = [...REQUIRED_EXTENSIONS, ...OPTIONAL_EXTENSIONS];
  const rows = await sql<{ name: string; installed: boolean }[]>`
    select name::text, installed_version is not null as installed
    from pg_available_extensions where name in ${sql(all)}`;
  const state = new Map(rows.map((r) => [r.name, r.installed]));
  const missingOptional: string[] = [];
  for (const ext of all) {
    const optional = (OPTIONAL_EXTENSIONS as readonly string[]).includes(ext);
    if (state.get(ext)) continue;
    if (!state.has(ext)) {
      if (!optional) {
        throw new Error(`extension "${ext}" is not available on this server (${db})`);
      }
      missingOptional.push(ext);
      continue;
    }
    try {
      await sql.unsafe(`CREATE EXTENSION IF NOT EXISTS "${ext}"`);
    } catch (error) {
      if (!optional) throw error;
      missingOptional.push(ext);
      log(
        `database ${db}: could not create optional extension ${ext} (${(error as Error).message})`,
      );
    }
  }
  const installed = await sql<{ extname: string }[]>`
    select extname::text from pg_extension where extname in ${sql(all)} order by extname`;
  return { installed: installed.map((r) => r.extname), missingOptional };
}

export async function runBootstrap(options: BootstrapOptions): Promise<BootstrapResult> {
  const log = options.log ?? (() => undefined);
  const databases = options.databases.map((db) => assertIdentifier('database', db));
  const appRole = assertIdentifier('role', options.appRole);
  const dedicatedOwner = assertIdentifier('role', options.ownerRole);

  const given = new URL(options.adminUrl);
  const adminUrl = withTarget(given, {
    host: deriveHosts(given.hostname).direct,
    database: decodeURIComponent(given.pathname.slice(1)) || 'postgres',
  });

  const createdDatabases: string[] = [];
  const existingDatabases: string[] = [];

  const setup = await withSql(adminUrl, async (sql) => {
    const [me] = await sql<AdminFacts[]>`
      select current_user::text as name, rolsuper as superuser,
             rolcreatedb or rolsuper as createdb, rolcreaterole or rolsuper as createrole
      from pg_roles where rolname = current_user`;
    if (!me) throw new Error('could not read the bootstrap role');
    const owned = await sql<{ datname: string; owner: string }[]>`
      select datname::text, pg_get_userbyid(datdba)::text as owner
      from pg_database where datname in ${sql(databases)}`;
    const ownsAll = owned.length === databases.length && owned.every((d) => d.owner === me.name);
    const mode = pickMode(me, ownsAll);
    const ownerRole = mode === 'dedicated-owner' ? dedicatedOwner : me.name;
    log(`mode: ${mode} (connected as ${me.name}${me.superuser ? ', superuser' : ''})`);

    let ownerCreated = false;
    if (mode === 'dedicated-owner') {
      const [exists] = await sql`select 1 from pg_roles where rolname = ${ownerRole}`;
      if (exists) {
        log(`role ${ownerRole}: exists, skipped`);
      } else {
        // No password yet (set last). Owns the databases; no superuser, no BYPASSRLS.
        await sql.unsafe(
          `CREATE ROLE "${ownerRole}" WITH LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`,
        );
        ownerCreated = true;
        log(`role ${ownerRole}: created`);
      }
    }

    const ownerOf = new Map(owned.map((d) => [d.datname, d.owner]));
    for (const db of databases) {
      const current = ownerOf.get(db);
      if (current !== undefined) {
        existingDatabases.push(db);
        log(`database ${db}: exists, skipped`);
        if (current !== ownerRole) {
          log(`  warning: ${db} is owned by ${current}, not ${ownerRole} — left unchanged`);
        }
      } else if (mode === 'verify-only') {
        throw new Error(`database ${db} does not exist (verify-only mode creates nothing)`);
      } else {
        await sql.unsafe(
          mode === 'dedicated-owner'
            ? `CREATE DATABASE "${db}" OWNER "${ownerRole}"`
            : `CREATE DATABASE "${db}"`,
        );
        createdDatabases.push(db);
        log(`database ${db}: created`);
      }
    }

    const [app] = await sql`select 1 from pg_roles where rolname = ${appRole}`;
    if (!app && mode === 'verify-only') {
      throw new Error(`role ${appRole} does not exist (verify-only mode creates nothing)`);
    }
    return { mode, ownerRole, ownerCreated, appExisted: Boolean(app) };
  });

  // Superusers can create pgvector; Neon lets its owner do it; elsewhere it must already exist
  // (CI installs it into template1).
  const extensions: Record<string, string[]> = {};
  const missingOptional: Record<string, string[]> = {};
  for (const db of databases) {
    const result = await withSql(
      withTarget(adminUrl, { host: adminUrl.hostname, database: db }),
      (sql) => ensureExtensions(sql, db, log),
    );
    extensions[db] = result.installed;
    missingOptional[db] = result.missingOptional;
    log(`database ${db}: extensions ${result.installed.join(', ') || '(none)'}`);
    for (const ext of result.missingOptional) {
      log(`  warning: optional extension ${ext} not installed in ${db} (needed from M4)`);
    }
  }

  // Passwords last.
  const setPassword = async (role: string, create: boolean): Promise<string> => {
    const password = generatePassword();
    const literal = passwordLiteral(password);
    await withSql(adminUrl, (sql) =>
      sql.unsafe(
        create
          ? // Plain LOGIN role: NOSUPERUSER, NOBYPASSRLS, owns nothing — so forced RLS applies.
            `CREATE ROLE "${role}" WITH LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD ${literal}`
          : `ALTER ROLE "${role}" WITH LOGIN PASSWORD ${literal}`,
      ),
    );
    return password;
  };

  let owner: RoleOutcome;
  if (setup.mode === 'dedicated-owner') {
    const rotate = setup.ownerCreated || Boolean(options.resetOwnerPassword);
    owner = {
      role: setup.ownerRole,
      created: setup.ownerCreated,
      passwordReset: rotate && !setup.ownerCreated,
      password: rotate ? await setPassword(setup.ownerRole, false) : null,
    };
    if (owner.passwordReset) log(`role ${owner.role}: password reset`);
  } else {
    owner = {
      role: setup.ownerRole,
      created: false,
      passwordReset: false,
      password: given.password ? decodeURIComponent(given.password) : null,
    };
  }

  let app: RoleOutcome;
  if (!setup.appExisted || options.resetAppPassword) {
    if (setup.mode === 'verify-only') {
      throw new Error('verify-only mode cannot reset passwords — set DB_BOOTSTRAP_URL');
    }
    const password = await setPassword(appRole, !setup.appExisted);
    app = {
      role: appRole,
      created: !setup.appExisted,
      passwordReset: setup.appExisted,
      password,
    };
    log(`role ${appRole}: ${app.created ? 'created' : 'password reset'}`);
  } else {
    app = { role: appRole, created: false, passwordReset: false, password: null };
    log(`role ${appRole}: exists, skipped (password unchanged and not shown)`);
  }

  return {
    mode: setup.mode,
    adminUrl,
    createdDatabases,
    existingDatabases,
    extensions,
    missingOptional,
    owner,
    app,
  };
}
