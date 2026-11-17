// `pnpm db:seed` — four demo tenants, their users and demo CRM data on the dev database, as
// app_user (so it goes through RLS and the app's grants exactly like the API will).
// `pnpm db:seed -- --volume` also adds 10,000 leads to Demo Realty (M1-T7 volume check).
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
import { DEMO_TENANTS, seedDemo } from '../seed.js';

async function main(): Promise<void> {
  loadEnvFiles([join(findRepoRoot(), '.env')]);
  const env = parseEnv(commonEnvSchema.extend(databaseEnvSchema.shape).extend(seedEnvSchema.shape));
  if (env.NODE_ENV === 'production') throw new Error('refusing to seed with NODE_ENV=production');

  const handle = createDb(env.DATABASE_URL, { max: 1 });
  try {
    const volume = process.argv.includes('--volume');
    const { leadsAdded } = await seedDemo(handle.db, env.SEED_PASSWORD, { volume });
    console.log(
      `seeded demo tenants, ${leadsAdded} new leads (every user logs in with SEED_PASSWORD):`,
    );
    for (const tenant of DEMO_TENANTS) {
      console.log(`  ${tenant.name} (${tenant.slug})`);
      for (const m of tenant.members) console.log(`    ${m.role.padEnd(8)} ${m.email}`);
    }
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  console.error(`db:seed failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
