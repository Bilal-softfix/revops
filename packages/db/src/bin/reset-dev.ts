// `pnpm db:reset:dev` — DEV ONLY. Drops everything the migrations created in the dev database,
// re-runs the migrations and the seed, so the demo tenants always get their current templates.
// Refuses unless the database name ends in _dev, NODE_ENV isn't production, and it isn't the
// test database (see assertResettableDevDatabase).
import { join } from 'node:path';
import {
  commonEnvSchema,
  databaseEnvSchema,
  findRepoRoot,
  loadEnvFiles,
  migrationEnvSchema,
  parseEnv,
  seedEnvSchema,
} from '@revops/shared/env';
import { createDb } from '../client.js';
import { runMigrations } from '../migrate.js';
import { assertResettableDevDatabase, dropMigratedObjects } from '../reset.js';
import { DEMO_TENANTS, seedDemo } from '../seed.js';

async function main(): Promise<void> {
  loadEnvFiles([join(findRepoRoot(), '.env')]);
  const env = parseEnv(
    commonEnvSchema
      .extend(databaseEnvSchema.shape)
      .extend(migrationEnvSchema.shape)
      .extend(seedEnvSchema.shape),
  );
  const name = assertResettableDevDatabase({
    urls: [env.DATABASE_URL, env.DATABASE_URL_OWNER],
    nodeEnv: process.env.NODE_ENV,
    testUrls: [process.env.DATABASE_URL_TEST, process.env.DATABASE_URL_TEST_OWNER],
  });

  console.log(`resetting dev database "${name}": dropping migrated objects…`);
  await dropMigratedObjects(env.DATABASE_URL_OWNER);
  console.log('re-running migrations…');
  await runMigrations(env.DATABASE_URL_OWNER);
  console.log('seeding…');
  const handle = createDb(env.DATABASE_URL, { max: 1 });
  try {
    await seedDemo(handle.db, env.SEED_PASSWORD);
  } finally {
    await handle.close();
  }
  console.log(`done. Demo tenants (password = SEED_PASSWORD):`);
  for (const tenant of DEMO_TENANTS) {
    console.log(`  ${tenant.name} (${tenant.slug}, ${tenant.industryTemplate})`);
  }
}

main().catch((error: unknown) => {
  console.error(`db:reset:dev failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
