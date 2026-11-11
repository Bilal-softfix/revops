import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import postgres from 'postgres';
import { findRepoRoot, loadEnvFiles } from '@revops/shared/env';
import { afterAll, describe, expect, it } from 'vitest';
import { withTarget } from './db-urls.js';
import { OPTIONAL_EXTENSIONS, REQUIRED_EXTENSIONS, runBootstrap } from './run-bootstrap.js';

// Creates and drops throwaway bt_* databases/roles. Required in CI. Locally opt in with
// RUN_BOOTSTRAP_INTEGRATION=1.
//  * admin-owner mode: DATABASE_URL_TEST_OWNER (CI: revops_owner with CREATEDB + CREATEROLE, like
//    Neon's neondb_owner).
//  * dedicated-owner mode: BOOTSTRAP_SUPERUSER_URL, a superuser (CI: the container's postgres;
//    locally: your postgres superuser). Skipped when unset.
const enabled = process.env.CI === 'true' || process.env.RUN_BOOTSTRAP_INTEGRATION === '1';
if (enabled) loadEnvFiles([join(findRepoRoot(import.meta.dirname), '.env')]);
const adminUrl = process.env.DATABASE_URL_TEST_OWNER;
const superuserUrl = process.env.BOOTSTRAP_SUPERUSER_URL;

async function query<T extends object>(url: URL, text: string): Promise<T[]> {
  const sql = postgres(url.toString(), { max: 1, prepare: false, connect_timeout: 10 });
  try {
    return (await sql.unsafe(text)) as unknown as T[];
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** The extensions this server can provide: pgvector may be absent on a local install. */
async function expectedExtensions(url: URL): Promise<string[]> {
  const rows = await query<{ name: string }>(
    url,
    `select name::text from pg_available_extensions where name = any('{${OPTIONAL_EXTENSIONS.join(',')}}')`,
  );
  return [...REQUIRED_EXTENSIONS, ...rows.map((r) => r.name)].sort();
}

function names(prefix: string) {
  const suffix = randomBytes(3).toString('hex');
  return {
    databases: [`${prefix}_${suffix}_dev`, `${prefix}_${suffix}_test`],
    appRole: `${prefix}_${suffix}_app`,
    ownerRole: `${prefix}_${suffix}_owner`,
  };
}

async function cleanup(admin: string, n: ReturnType<typeof names>) {
  const url = new URL(admin);
  for (const db of n.databases) await query(url, `DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
  for (const role of [n.appRole, n.ownerRole]) await query(url, `DROP ROLE IF EXISTS "${role}"`);
}

const roleUrl = (server: URL, database: string, user: string, password: string) =>
  withTarget(server, { host: server.hostname, database, user, password });

describe.runIf(enabled)(
  'runBootstrap admin-owner mode (Neon-like owner, against a real Postgres)',
  () => {
    const n = names('bt');
    const { databases, appRole } = n;
    let serverUrl: URL;
    let firstPassword: string;

    it('has an admin URL configured', () => {
      expect(adminUrl, 'DATABASE_URL_TEST_OWNER must be set').toBeTruthy();
    });

    afterAll(async () => {
      if (adminUrl) await cleanup(adminUrl, n);
    });

    const run = (extra: { resetAppPassword?: boolean; adminUrl?: string } = {}) =>
      runBootstrap({
        adminUrl: adminUrl ?? '',
        databases,
        appRole,
        ownerRole: n.ownerRole,
        ...extra,
      });

    it('first run creates both databases, the extensions and a plain login role', async () => {
      const result = await run();
      serverUrl = result.adminUrl;

      expect(result.mode).toBe('admin-owner');
      expect(result.createdDatabases).toEqual(databases);
      expect(result.existingDatabases).toEqual([]);
      expect(result.app.created).toBe(true);
      expect(result.app.password).toMatch(/^[A-Za-z0-9_-]{43}$/);
      // The admin owns the databases; no extra owner role is created.
      expect(result.owner.role).not.toBe(n.ownerRole);
      const expected = await expectedExtensions(serverUrl);
      for (const db of databases) expect(result.extensions[db]).toEqual(expected);
      firstPassword = result.app.password ?? '';

      const [attrs] = await query<{
        rolsuper: boolean;
        rolbypassrls: boolean;
        rolcanlogin: boolean;
      }>(
        serverUrl,
        `select rolsuper, rolbypassrls, rolcanlogin from pg_roles where rolname = '${appRole}'`,
      );
      expect(attrs).toEqual({ rolsuper: false, rolbypassrls: false, rolcanlogin: true });
    });

    it('the generated password logs the app role into both databases', async () => {
      for (const db of databases) {
        const [row] = await query<{ who: string; db: string }>(
          roleUrl(serverUrl, db, appRole, firstPassword),
          'select current_user::text as who, current_database()::text as db',
        );
        expect(row).toEqual({ who: appRole, db });
      }
    });

    it('second run is a no-op and never returns the app password', async () => {
      const result = await run();
      expect(result.createdDatabases).toEqual([]);
      expect(result.existingDatabases).toEqual(databases);
      expect(result.app).toMatchObject({ created: false, passwordReset: false, password: null });
      await expect(
        query(roleUrl(serverUrl, databases[0] ?? '', appRole, firstPassword), 'select 1'),
      ).resolves.toHaveLength(1);
    });

    it('--reset-app-password rotates it: new one works, old one is rejected', async () => {
      const result = await run({ resetAppPassword: true });
      expect(result.app.passwordReset).toBe(true);
      expect(result.app.password).not.toBe(firstPassword);
      const db = databases[0] ?? '';
      await expect(
        query(roleUrl(serverUrl, db, appRole, result.app.password ?? ''), 'select 1'),
      ).resolves.toHaveLength(1);
      await expect(
        query(roleUrl(serverUrl, db, appRole, firstPassword), 'select 1'),
      ).rejects.toThrow(/password/i);
      firstPassword = result.app.password ?? '';
    });

    it('refuses to run as a role that neither has CREATEDB/CREATEROLE nor owns the databases', async () => {
      const asApp = roleUrl(serverUrl, databases[0] ?? '', appRole, firstPassword).toString();
      await expect(run({ adminUrl: asApp })).rejects.toThrow(/lacks CREATEDB \+ CREATEROLE/);
    });
  },
  60_000,
);

describe.runIf(enabled && Boolean(superuserUrl))(
  'runBootstrap dedicated-owner mode (superuser, e.g. a native local Postgres)',
  () => {
    const n = names('bts');
    const { databases, appRole, ownerRole } = n;
    let serverUrl: URL;
    let ownerPassword: string;

    afterAll(async () => {
      if (superuserUrl) await cleanup(superuserUrl, n);
    });

    const run = (extra: { adminUrl?: string; resetOwnerPassword?: boolean } = {}) =>
      runBootstrap({ adminUrl: superuserUrl ?? '', databases, appRole, ownerRole, ...extra });

    it('creates a NOSUPERUSER owner that owns both databases, plus the app role', async () => {
      const result = await run();
      serverUrl = result.adminUrl;
      expect(result.mode).toBe('dedicated-owner');
      expect(result.createdDatabases).toEqual(databases);
      expect(result.owner).toMatchObject({ role: ownerRole, created: true });
      expect(result.owner.password).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(result.app.created).toBe(true);
      ownerPassword = result.owner.password ?? '';

      const owners = await query<{ datname: string; owner: string }>(
        serverUrl,
        `select datname::text, pg_get_userbyid(datdba)::text as owner from pg_database
         where datname in ('${databases.join("','")}') order by 1`,
      );
      expect(owners).toEqual(databases.map((datname) => ({ datname, owner: ownerRole })));
      const [attrs] = await query<{ rolsuper: boolean; rolbypassrls: boolean }>(
        serverUrl,
        `select rolsuper, rolbypassrls from pg_roles where rolname = '${ownerRole}'`,
      );
      expect(attrs).toEqual({ rolsuper: false, rolbypassrls: false });
      const expected = await expectedExtensions(serverUrl);
      for (const db of databases) expect(result.extensions[db]).toEqual(expected);
    });

    it('the owner can log in and create tables in public (what migrations need)', async () => {
      const url = roleUrl(serverUrl, databases[1] ?? '', ownerRole, ownerPassword);
      await query(url, 'create table bt_probe (id int); drop table bt_probe;');
    });

    it('rerun as the superuser is a no-op and keeps both passwords hidden', async () => {
      const result = await run();
      expect(result.createdDatabases).toEqual([]);
      expect(result.owner).toMatchObject({ created: false, passwordReset: false, password: null });
      expect(result.app).toMatchObject({ created: false, passwordReset: false, password: null });
    });

    it('rerun with only the owner URL (DB_BOOTSTRAP_URL removed) is verify-only', async () => {
      const asOwner = roleUrl(serverUrl, databases[0] ?? '', ownerRole, ownerPassword).toString();
      const result = await run({ adminUrl: asOwner });
      expect(result.mode).toBe('verify-only');
      expect(result.existingDatabases).toEqual(databases);
      expect(result.owner).toMatchObject({ role: ownerRole, password: ownerPassword });
      expect(result.app.password).toBeNull();
    });
  },
  60_000,
);
