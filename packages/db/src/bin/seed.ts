// `pnpm db:seed` — demo tenant + owner/admin/manager/agent on the dev database, as app_user
// (so it goes through RLS and the app's grants exactly like the API will).
import { join } from 'node:path';
import {
  commonEnvSchema,
  databaseEnvSchema,
  findRepoRoot,
  loadEnvFiles,
  parseEnv,
  seedEnvSchema,
} from '@revops/shared/env';
import { createDb } from '../client.js';
import { DEMO_USERS, seedDemo } from '../seed.js';

async function main(): Promise<void> {
  loadEnvFiles([join(findRepoRoot(), '.env')]);
  const env = parseEnv(commonEnvSchema.extend(databaseEnvSchema.shape).extend(seedEnvSchema.shape));
  if (env.NODE_ENV === 'production') throw new Error('refusing to seed with NODE_ENV=production');

  const handle = createDb(env.DATABASE_URL, { max: 1 });
  try {
    const { tenantId } = await seedDemo(handle.db, env.SEED_PASSWORD);
    console.log(`seeded demo tenant ${tenantId} with users (password: SEED_PASSWORD):`);
    for (const user of DEMO_USERS) console.log(`  ${user.role.padEnd(8)} ${user.email}`);
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  console.error(`db:seed failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
