// `pnpm db:migrate [--test]` — applies migrations as the owner role on the direct endpoint:
// DATABASE_URL_OWNER (dev) or, with --test, DATABASE_URL_TEST_OWNER.
import { join } from 'node:path';
import {
  findRepoRoot,
  loadEnvFiles,
  migrationEnvSchema,
  parseEnv,
  testDatabaseEnvSchema,
} from '@revops/shared/env';
import { runMigrations } from '../migrate.js';

const test = process.argv.includes('--test');
loadEnvFiles([join(findRepoRoot(), '.env')]);
const url = test
  ? parseEnv(testDatabaseEnvSchema).DATABASE_URL_TEST_OWNER
  : parseEnv(migrationEnvSchema).DATABASE_URL_OWNER;

runMigrations(url)
  .then(() => console.log(`migrations applied (${test ? 'test' : 'dev'} database)`))
  .catch((error: unknown) => {
    console.error(`db:migrate failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
