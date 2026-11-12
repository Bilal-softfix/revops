import { runMigrations } from '@revops/db';
import { loadTestDatabaseEnv } from '@revops/db/testing';

/** Once per run: guard against non-test databases, then migrate the test DB as its owner. */
export default async function setup(): Promise<void> {
  await runMigrations(loadTestDatabaseEnv().ownerUrl);
}
