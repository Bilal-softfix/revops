// `pnpm run db:bootstrap [--reset-app-password]` — one-off Neon setup without the SQL editor.
// Reads NEON_BOOTSTRAP_URL (owner role) from the repo-root .env at runtime, then idempotently
// creates revops_dev + revops_test, the extensions, and app_user; prints the 4 DATABASE_URL lines.
import { join } from 'node:path';
import { findRepoRoot, loadEnvFiles, neonBootstrapEnvSchema, parseEnv } from '@revops/shared/env';
import { buildEnvLines, deriveHosts } from './bootstrap/neon-urls.js';
import { runBootstrap } from './bootstrap/run-bootstrap.js';

const DATABASES = { dev: 'revops_dev', test: 'revops_test' } as const;
const APP_ROLE = 'app_user';

async function main(): Promise<void> {
  const resetAppPassword = process.argv.includes('--reset-app-password');
  const root = findRepoRoot();
  loadEnvFiles([join(root, '.env')]);
  const { NEON_BOOTSTRAP_URL } = parseEnv(neonBootstrapEnvSchema);

  const host = new URL(NEON_BOOTSTRAP_URL).hostname;
  if (!deriveHosts(host).isNeon) {
    console.log(
      `note: ${host} is not a Neon ep-* host — pooled and direct URLs will be the same host\n`,
    );
  }

  const result = await runBootstrap({
    adminUrl: NEON_BOOTSTRAP_URL,
    databases: [DATABASES.dev, DATABASES.test],
    appRole: APP_ROLE,
    resetAppPassword,
    log: (message) => console.log(`  ${message}`),
  });

  const lines = buildEnvLines({
    ownerUrl: result.ownerUrl,
    appRole: APP_ROLE,
    appPassword: result.appPassword,
    devDatabase: DATABASES.dev,
    testDatabase: DATABASES.test,
  });

  console.log(
    '\nPaste into the repo-root .env (these lines contain passwords — never share them):\n',
  );
  for (const line of lines) console.log(line);

  if (result.appPassword) {
    console.log(
      `\n${APP_ROLE} password was ${result.roleCreated ? 'generated' : 'reset'} just now and is shown only once.`,
    );
  } else {
    console.log(
      `\n${APP_ROLE} already existed: its password was not changed and is not shown.\n` +
        'Replace <APP_USER_PASSWORD> with the password you saved, or rerun with --reset-app-password.',
    );
  }
  console.log('Next: `pnpm run doctor`. (NEON_BOOTSTRAP_URL is only used by this script.)');
}

main().catch((error: unknown) => {
  console.error(`db:bootstrap failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
