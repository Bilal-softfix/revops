import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runMigrations } from '@revops/db';
import { createDb } from '@revops/db';
import { loadTestDatabaseEnv, seedAccounts, truncateAll } from '@revops/db/testing';
import postgres from 'postgres';
import { fixtureAccounts } from './fixtures';
import { PASSWORD } from './helpers';

/**
 * Fresh test database (migrated; every public table empty, incl. rate limits; no leftover pg-boss
 * jobs from earlier runs), the fixture accounts (./fixtures.ts) and an empty mailbox.
 */
export default async function globalSetup(): Promise<void> {
  const { appUrl, ownerUrl } = loadTestDatabaseEnv();
  await runMigrations(ownerUrl);
  await truncateAll(ownerUrl);
  const app = createDb(appUrl, { max: 1 });
  try {
    await seedAccounts(app.db, PASSWORD, fixtureAccounts());
  } finally {
    await app.close();
  }
  const sql = postgres(ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    await sql`delete from pgboss.job`;
  } finally {
    await sql.end({ timeout: 5 });
  }
  await rm(resolve(import.meta.dirname, '..', '.e2e-mail'), { recursive: true, force: true });
}
