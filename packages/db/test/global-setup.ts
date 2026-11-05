import { runMigrations } from '../src/migrate.js';
import { loadTestDatabaseEnv } from '../src/testing/index.js';

/** Once per run: guard against non-test databases, then migrate the test DB as its owner. */
export default async function setup(): Promise<void> {
  const { ownerUrl } = loadTestDatabaseEnv();
  await runMigrations(ownerUrl);
}
