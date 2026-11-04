import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import postgres from 'postgres';
import { findRepoRoot, loadEnvFiles } from '@revops/shared/env';
import { afterAll, describe, expect, it } from 'vitest';
import { withTarget } from './neon-urls.js';
import { REQUIRED_EXTENSIONS, runBootstrap } from './run-bootstrap.js';

// Needs an owner role with CREATEDB + CREATEROLE (CI: revops_owner, like neondb_owner on Neon).
// Required in CI. Locally opt in with RUN_BOOTSTRAP_INTEGRATION=1 — it creates and drops
// throwaway bt_* databases/roles in whatever DATABASE_URL_TEST_OWNER points at.
const enabled = process.env.CI === 'true' || process.env.RUN_BOOTSTRAP_INTEGRATION === '1';
if (enabled) loadEnvFiles([join(findRepoRoot(import.meta.dirname), '.env')]);
const adminUrl = process.env.DATABASE_URL_TEST_OWNER;

const suffix = randomBytes(3).toString('hex');
const databases = [`bt_${suffix}_dev`, `bt_${suffix}_test`];
const appRole = `bt_${suffix}_app`;

async function query<T extends object>(url: URL, text: string): Promise<T[]> {
  const sql = postgres(url.toString(), { max: 1, prepare: false, connect_timeout: 10 });
  try {
    return (await sql.unsafe(text)) as unknown as T[];
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const appUrl = (ownerUrl: URL, database: string, password: string) =>
  withTarget(ownerUrl, { host: ownerUrl.hostname, database, user: appRole, password });

describe.runIf(enabled)(
  'runBootstrap (against a real Postgres)',
  () => {
    it('has an admin URL configured', () => {
      expect(adminUrl, 'DATABASE_URL_TEST_OWNER must be set').toBeTruthy();
    });

    let ownerUrl: URL;
    let firstPassword: string;

    afterAll(async () => {
      if (!adminUrl) return;
      const admin = new URL(adminUrl);
      for (const db of databases)
        await query(admin, `DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
      await query(admin, `DROP ROLE IF EXISTS "${appRole}"`);
    });

    it('first run creates both databases, the extensions and a plain login role', async () => {
      const result = await runBootstrap({ adminUrl: adminUrl ?? '', databases, appRole });
      ownerUrl = result.ownerUrl;

      expect(result.createdDatabases).toEqual(databases);
      expect(result.existingDatabases).toEqual([]);
      expect(result.roleCreated).toBe(true);
      expect(result.appPassword).toMatch(/^[A-Za-z0-9_-]{43}$/);
      for (const db of databases)
        expect(result.extensions[db]).toEqual([...REQUIRED_EXTENSIONS].sort());
      firstPassword = result.appPassword ?? '';

      const [attrs] = await query<{
        rolsuper: boolean;
        rolbypassrls: boolean;
        rolcanlogin: boolean;
      }>(
        ownerUrl,
        `select rolsuper, rolbypassrls, rolcanlogin from pg_roles where rolname = '${appRole}'`,
      );
      expect(attrs).toEqual({ rolsuper: false, rolbypassrls: false, rolcanlogin: true });
    });

    it('the generated password logs the app role into both databases', async () => {
      for (const db of databases) {
        const [row] = await query<{ who: string; db: string }>(
          appUrl(ownerUrl, db, firstPassword),
          'select current_user::text as who, current_database()::text as db',
        );
        expect(row).toEqual({ who: appRole, db });
      }
    });

    it('second run is a no-op and never returns a password', async () => {
      const result = await runBootstrap({ adminUrl: adminUrl ?? '', databases, appRole });
      expect(result.createdDatabases).toEqual([]);
      expect(result.existingDatabases).toEqual(databases);
      expect(result.roleCreated).toBe(false);
      expect(result.passwordReset).toBe(false);
      expect(result.appPassword).toBeNull();
      // ...and the original password still works.
      await expect(
        query(appUrl(ownerUrl, databases[0] ?? '', firstPassword), 'select 1'),
      ).resolves.toHaveLength(1);
    });

    it('--reset-app-password rotates it: new one works, old one is rejected', async () => {
      const result = await runBootstrap({
        adminUrl: adminUrl ?? '',
        databases,
        appRole,
        resetAppPassword: true,
      });
      expect(result.passwordReset).toBe(true);
      expect(result.appPassword).not.toBe(firstPassword);
      const db = databases[0] ?? '';
      await expect(
        query(appUrl(ownerUrl, db, result.appPassword ?? ''), 'select 1'),
      ).resolves.toHaveLength(1);
      await expect(query(appUrl(ownerUrl, db, firstPassword), 'select 1')).rejects.toThrow(
        /password/i,
      );
    });

    it('refuses to run as a role without CREATEDB/CREATEROLE', async () => {
      const reset = await runBootstrap({
        adminUrl: adminUrl ?? '',
        databases,
        appRole,
        resetAppPassword: true,
      });
      const asApp = appUrl(ownerUrl, databases[0] ?? '', reset.appPassword ?? '').toString();
      await expect(runBootstrap({ adminUrl: asApp, databases, appRole })).rejects.toThrow(
        /lacks CREATEDB \+ CREATEROLE/,
      );
    });
  },
  60_000,
);
