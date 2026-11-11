import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runMigrations } from '@revops/db';
import { loadTestDatabaseEnv, truncateAll } from '@revops/db/testing';
import postgres from 'postgres';

/**
 * Fresh test database (migrated; every public table empty, incl. rate limits; no leftover pg-boss
 * jobs from earlier runs) and an empty mailbox.
 */
export default async function globalSetup(): Promise<void> {
  const { ownerUrl } = loadTestDatabaseEnv();
  await runMigrations(ownerUrl);
  await truncateAll(ownerUrl);
  const sql = postgres(ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    await sql`delete from pgboss.job`;
  } finally {
    await sql.end({ timeout: 5 });
  }
  await rm(resolve(import.meta.dirname, '..', '.e2e-mail'), { recursive: true, force: true });
}
