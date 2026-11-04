// `pnpm run db:bootstrap [--write-env] [--reset-app-password]` — one-off Neon setup without the
// SQL editor. Reads NEON_BOOTSTRAP_URL (owner role) from the repo-root .env at runtime — or, once
// that has been removed, DATABASE_URL_OWNER — then idempotently creates revops_dev + revops_test,
// the extensions, and app_user.
//   default:      prints the 4 DATABASE_* lines (they contain passwords).
//   --write-env:  writes them into .env and apps/api/.env, drops NEON_BOOTSTRAP_URL, prints only
//                 a masked summary.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  findRepoRoot,
  loadEnvFiles,
  migrationEnvSchema,
  neonBootstrapEnvSchema,
  parseEnv,
} from '@revops/shared/env';
import { maskUrl } from './checks.js';
import { editEnv, readEnvValue } from './bootstrap/env-file.js';
import { buildEnvLines, deriveHosts, withTarget } from './bootstrap/neon-urls.js';
import { canLogin, runBootstrap } from './bootstrap/run-bootstrap.js';

const DATABASES = { dev: 'revops_dev', test: 'revops_test' } as const;
const APP_ROLE = 'app_user';
const APP_URL_KEYS = ['DATABASE_URL', 'DATABASE_URL_TEST'] as const;

function adminUrlFromEnv(): { adminUrl: string; source: string } {
  if (!process.env.NEON_BOOTSTRAP_URL && process.env.DATABASE_URL_OWNER) {
    return {
      adminUrl: parseEnv(migrationEnvSchema).DATABASE_URL_OWNER,
      source: 'DATABASE_URL_OWNER (NEON_BOOTSTRAP_URL not set)',
    };
  }
  return {
    adminUrl: parseEnv(neonBootstrapEnvSchema).NEON_BOOTSTRAP_URL,
    source: 'NEON_BOOTSTRAP_URL',
  };
}

function readIfExists(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

/** app_user passwords already present in the env files, in preference order, deduplicated. */
function knownAppPasswords(contents: readonly string[]): string[] {
  const passwords = new Set<string>();
  for (const content of contents) {
    for (const key of APP_URL_KEYS) {
      const value = readEnvValue(content, key);
      if (!value) continue;
      try {
        const url = new URL(value);
        if (url.username === APP_ROLE && url.password)
          passwords.add(decodeURIComponent(url.password));
      } catch {
        // not a URL; ignore
      }
    }
  }
  return [...passwords];
}

async function main(): Promise<void> {
  const writeEnv = process.argv.includes('--write-env');
  const resetAppPassword = process.argv.includes('--reset-app-password');
  const root = findRepoRoot();
  const envFiles = [join(root, '.env'), join(root, 'apps', 'api', '.env')];
  loadEnvFiles([envFiles[0] ?? '']);
  const { adminUrl, source } = adminUrlFromEnv();
  console.log(`admin connection: ${source} → ${maskUrl(adminUrl)}`);

  const host = new URL(adminUrl).hostname;
  if (!deriveHosts(host).isNeon) {
    console.log(
      `note: ${host} is not a Neon ep-* host — pooled and direct URLs will be the same host`,
    );
  }

  const result = await runBootstrap({
    adminUrl,
    databases: [DATABASES.dev, DATABASES.test],
    appRole: APP_ROLE,
    resetAppPassword,
    log: (message) => console.log(`  ${message}`),
  });

  let appPassword = result.appPassword;
  const contents = envFiles.map(readIfExists);
  if (writeEnv && !appPassword) {
    // Role already existed: reuse the password from .env, but only if it really logs in.
    const pooledDev = (password: string) =>
      withTarget(result.ownerUrl, {
        host: deriveHosts(result.ownerUrl.hostname).pooled,
        database: DATABASES.dev,
        user: APP_ROLE,
        password,
      });
    for (const candidate of knownAppPasswords(contents)) {
      if (await canLogin(pooledDev(candidate))) {
        appPassword = candidate;
        break;
      }
    }
    if (!appPassword) {
      throw new Error(
        `${APP_ROLE} exists but no working ${APP_ROLE} password was found in the .env files — ` +
          'rerun with --write-env --reset-app-password to rotate it and write the new one',
      );
    }
    console.log(`  role ${APP_ROLE}: reusing the working password already in .env`);
  }

  const lines = buildEnvLines({
    ownerUrl: result.ownerUrl,
    appRole: APP_ROLE,
    appPassword,
    devDatabase: DATABASES.dev,
    testDatabase: DATABASES.test,
  });

  if (!writeEnv) {
    console.log(
      '\nPaste into the repo-root .env (these lines contain passwords — never share them):\n',
    );
    for (const line of lines) console.log(line);
    if (appPassword) {
      console.log(
        `\n${APP_ROLE} password was ${result.roleCreated ? 'generated' : 'reset'} just now and is shown only once.`,
      );
    } else {
      console.log(
        `\n${APP_ROLE} already existed: its password was not changed and is not shown.\n` +
          'Replace <APP_USER_PASSWORD> with the password you saved, or rerun with --reset-app-password.',
      );
    }
    console.log(
      'Next: `pnpm run db:bootstrap --write-env` does this for you; then `pnpm run doctor`.',
    );
    return;
  }

  const values = new Map(
    lines.map((line) => {
      const i = line.indexOf('=');
      return [line.slice(0, i), line.slice(i + 1)] as const;
    }),
  );
  console.log('');
  envFiles.forEach((path, i) => {
    const before = contents[i] ?? '';
    const { content, changes } = editEnv(before, values, ['NEON_BOOTSTRAP_URL']);
    if (content !== before) writeFileSync(path, content, 'utf8');
    console.log(`${relative(root, path)}${before ? '' : ' (created)'}:`);
    for (const [key, change] of changes) {
      const value = values.get(key);
      console.log(`  ${change.padEnd(9)} ${key}${value ? `=${maskUrl(value)}` : ''}`);
    }
  });
  if (result.appPassword) {
    console.log(
      `\n${APP_ROLE} password was ${result.roleCreated ? 'generated' : 'reset'} and written to the files above only.`,
    );
  }
  console.log('Next: `pnpm run doctor`.');
}

main().catch((error: unknown) => {
  console.error(`db:bootstrap failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
