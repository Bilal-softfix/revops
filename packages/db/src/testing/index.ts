// Integration-test helpers (`@revops/db/testing`): the test-DB guard, env loading and truncation.
// Used by Vitest globalSetup/setup files here and, from M0-T4, in apps/api.
import { join } from 'node:path';
import { findRepoRoot, loadEnvFiles, parseEnv, testDatabaseEnvSchema } from '@revops/shared/env';
import postgres from 'postgres';

export interface TestDatabaseEnv {
  /** app_user on the test DB (pooled on Neon). */
  appUrl: string;
  /** Owner on the test DB (direct). Migrations + truncation only. */
  ownerUrl: string;
}

function target(raw: string): { host: string; database: string } {
  const url = new URL(raw);
  return {
    host: url.hostname.replace(/-pooler(?=\.)/, ''),
    database: decodeURIComponent(url.pathname.slice(1)),
  };
}

/**
 * Tests truncate every table, so refuse anything that could be a real database: the test DB name
 * must end in `_test` and must not be the same host+database as DATABASE_URL (dev).
 */
export function assertSafeTestDatabase(testUrls: readonly string[], devUrl?: string): void {
  const dev = devUrl ? target(devUrl) : undefined;
  for (const raw of testUrls) {
    const test = target(raw);
    if (!test.database.endsWith('_test')) {
      throw new Error(`refusing to run tests: database "${test.database}" does not end in _test`);
    }
    if (dev && dev.host === test.host && dev.database === test.database) {
      throw new Error('refusing to run tests: the test database URL points at the dev database');
    }
  }
}

/** Loads the repo-root .env (real env wins), validates and guards the test DB URLs. */
export function loadTestDatabaseEnv(): TestDatabaseEnv {
  loadEnvFiles([join(findRepoRoot(import.meta.dirname), '.env')]);
  const env = parseEnv(testDatabaseEnvSchema);
  assertSafeTestDatabase(
    [env.DATABASE_URL_TEST, env.DATABASE_URL_TEST_OWNER],
    process.env.DATABASE_URL,
  );
  return { appUrl: env.DATABASE_URL_TEST, ownerUrl: env.DATABASE_URL_TEST_OWNER };
}

/** Empties every table in `public` (as owner — TRUNCATE ignores RLS). */
export async function truncateAll(ownerUrl: string): Promise<void> {
  const sql = postgres(ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    const rows = await sql<{ name: string }[]>`
      select quote_ident(tablename) as name from pg_tables where schemaname = 'public'`;
    if (rows.length > 0) {
      await sql.unsafe(`TRUNCATE ${rows.map((r) => r.name).join(', ')} RESTART IDENTITY CASCADE`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}
