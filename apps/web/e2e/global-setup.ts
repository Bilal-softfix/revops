import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runMigrations } from '@revops/db';
import { createDb } from '@revops/db';
import { loadTestDatabaseEnv, seedAccounts, seedCrmBatch, truncateAll } from '@revops/db/testing';
import postgres from 'postgres';
import { FIXTURES, VOLUME_LEADS, fixtureAccounts } from './fixtures';
import { PASSWORD } from './helpers';

/**
 * Fresh test database (migrated; every public table empty, incl. rate limits; no leftover pg-boss
 * jobs from earlier runs), the fixture accounts (./fixtures.ts) incl. 10k leads in the `volume`
 * workspace, and an empty mailbox.
 */
export default async function globalSetup(): Promise<void> {
  const { appUrl, ownerUrl } = loadTestDatabaseEnv();
  await runMigrations(ownerUrl);
  await truncateAll(ownerUrl);
  const app = createDb(appUrl, { max: 1 });
  try {
    const { userIds } = await seedAccounts(app.db, PASSWORD, fixtureAccounts());
    const volumeOwner = userIds.get(FIXTURES.volume.owner.email) ?? '';
    await seedCrmBatch(app.db, FIXTURES.volume.id, {
      name: 'volume',
      leads: VOLUME_LEADS,
      ownerIds: [volumeOwner],
      actorId: volumeOwner,
      phoneBlock: 90,
      activityEvery: 0,
      now: new Date(),
    });
  } finally {
    await app.close();
  }
  const sql = postgres(ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    await sql`delete from pgboss.job`;
    // Fresh planner stats after the bulk insert (autovacuum would get there within a minute).
    await sql`analyze leads, contacts`;
  } finally {
    await sql.end({ timeout: 5 });
  }
  await rm(resolve(import.meta.dirname, '..', '.e2e-mail'), { recursive: true, force: true });
}
