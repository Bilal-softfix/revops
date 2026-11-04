// Idempotent Neon bootstrap: databases → extensions → app role (last, so a failure earlier never
// loses a freshly generated password). Connects as the owner role on the DIRECT endpoint.
import postgres from 'postgres';
import {
  assertIdentifier,
  deriveHosts,
  generatePassword,
  passwordLiteral,
  withTarget,
} from './neon-urls.js';

export const REQUIRED_EXTENSIONS = ['vector', 'citext', 'pg_trgm'] as const;

export interface BootstrapOptions {
  /** Owner role URL (pooled or direct — the direct host is always used). */
  adminUrl: string;
  databases: readonly string[];
  appRole: string;
  /** Rotate the app role's password even if it already exists. */
  resetAppPassword?: boolean;
  log?: (message: string) => void;
}

export interface BootstrapResult {
  ownerUrl: URL;
  createdDatabases: string[];
  existingDatabases: string[];
  extensions: Record<string, string[]>;
  roleCreated: boolean;
  passwordReset: boolean;
  /** Set only when this run created the role or reset its password. Never otherwise. */
  appPassword: string | null;
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

export async function runBootstrap(options: BootstrapOptions): Promise<BootstrapResult> {
  const log = options.log ?? (() => undefined);
  const databases = options.databases.map((db) => assertIdentifier('database', db));
  const appRole = assertIdentifier('role', options.appRole);

  const given = new URL(options.adminUrl);
  const ownerUrl = withTarget(given, {
    host: deriveHosts(given.hostname).direct,
    database: decodeURIComponent(given.pathname.slice(1)) || 'postgres',
  });

  const createdDatabases: string[] = [];
  const existingDatabases: string[] = [];

  const roleExisted = await withSql(ownerUrl, async (sql) => {
    const [me] = await sql<{ name: string; createdb: boolean; createrole: boolean }[]>`
      select current_user::text as name,
             rolcreatedb or rolsuper as createdb,
             rolcreaterole or rolsuper as createrole
      from pg_roles where rolname = current_user`;
    if (!me) throw new Error('could not read the bootstrap role');
    const missing = [!me.createdb && 'CREATEDB', !me.createrole && 'CREATEROLE'].filter(Boolean);
    if (missing.length > 0) {
      throw new Error(
        `role "${me.name}" lacks ${missing.join(' + ')} — use the Neon owner role (e.g. neondb_owner)`,
      );
    }

    for (const db of databases) {
      const [found] = await sql`select 1 from pg_database where datname = ${db}`;
      if (found) {
        existingDatabases.push(db);
        log(`database ${db}: exists, skipped`);
      } else {
        await sql.unsafe(`CREATE DATABASE "${db}"`);
        createdDatabases.push(db);
        log(`database ${db}: created`);
      }
    }

    const [role] = await sql`select 1 from pg_roles where rolname = ${appRole}`;
    return Boolean(role);
  });

  const extensions: Record<string, string[]> = {};
  for (const db of databases) {
    extensions[db] = await withSql(
      withTarget(ownerUrl, { host: ownerUrl.hostname, database: db }),
      async (sql) => {
        for (const ext of REQUIRED_EXTENSIONS) {
          await sql.unsafe(`CREATE EXTENSION IF NOT EXISTS "${ext}"`);
        }
        const rows = await sql<{ extname: string }[]>`
        select extname::text from pg_extension where extname in ${sql([...REQUIRED_EXTENSIONS])}
        order by extname`;
        return rows.map((r) => r.extname);
      },
    );
    log(`database ${db}: extensions ${extensions[db]?.join(', ')}`);
  }

  let appPassword: string | null = null;
  let roleCreated = false;
  let passwordReset = false;
  if (!roleExisted || options.resetAppPassword) {
    const password = generatePassword();
    const literal = passwordLiteral(password);
    await withSql(ownerUrl, async (sql) => {
      // Plain LOGIN role: NOSUPERUSER, NOBYPASSRLS, owns nothing — so forced RLS applies to it.
      await sql.unsafe(
        roleExisted
          ? `ALTER ROLE "${appRole}" WITH LOGIN PASSWORD ${literal}`
          : `CREATE ROLE "${appRole}" WITH LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD ${literal}`,
      );
    });
    appPassword = password;
    roleCreated = !roleExisted;
    passwordReset = roleExisted;
    log(`role ${appRole}: ${roleCreated ? 'created' : 'password reset'}`);
  } else {
    log(`role ${appRole}: exists, skipped (password unchanged and not shown)`);
  }

  return {
    ownerUrl,
    createdDatabases,
    existingDatabases,
    extensions,
    roleCreated,
    passwordReset,
    appPassword,
  };
}
