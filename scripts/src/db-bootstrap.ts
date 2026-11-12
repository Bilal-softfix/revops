// `pnpm run db:bootstrap [--write-env] [--reset-app-password] [--reset-owner-password]` — one-off
// database setup without a SQL client. Works with a native local Postgres (ADR-012), Neon, or any
// Postgres 18. Reads DB_BOOTSTRAP_URL (a superuser, or a role with CREATEDB + CREATEROLE) from the
// repo-root .env at runtime — or, once that has been removed, DATABASE_URL_OWNER (verify-only) —
// then idempotently creates revops_dev + revops_test, the extensions, the owner role (superuser
// mode only) and app_user. See run-bootstrap.ts for the modes.
//   default:      prints the 4 DATABASE_* lines (they contain passwords).
//   --write-env:  writes them into .env and apps/api/.env, drops DB_BOOTSTRAP_URL, prints only
//                 a masked summary.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  bootstrapEnvSchema,
  findRepoRoot,
  loadEnvFiles,
  migrationEnvSchema,
  parseEnv,
} from '@revops/shared/env';
import { checkDuplicateEnvKeys, maskUrl } from './checks.js';
import { buildEnvLines, deriveHosts, withTarget } from './bootstrap/db-urls.js';
import { editEnv, readEnvValue } from './bootstrap/env-file.js';
import { type RoleOutcome, canLogin, runBootstrap } from './bootstrap/run-bootstrap.js';

const DATABASES = { dev: 'revops_dev', test: 'revops_test' } as const;
const APP_ROLE = 'app_user';
const OWNER_ROLE = 'revops_owner';
/** Removed by --write-env. NEON_BOOTSTRAP_URL is the pre-ADR-012 name of DB_BOOTSTRAP_URL. */
const BOOTSTRAP_KEYS = ['DB_BOOTSTRAP_URL', 'NEON_BOOTSTRAP_URL'];

function adminUrlFromEnv(): { adminUrl: string; source: string } {
  if (process.env.NEON_BOOTSTRAP_URL && !process.env.DB_BOOTSTRAP_URL) {
    throw new Error('NEON_BOOTSTRAP_URL was renamed to DB_BOOTSTRAP_URL — rename it in .env');
  }
  if (!process.env.DB_BOOTSTRAP_URL && process.env.DATABASE_URL_OWNER) {
    return {
      adminUrl: parseEnv(migrationEnvSchema).DATABASE_URL_OWNER,
      source: 'DATABASE_URL_OWNER (DB_BOOTSTRAP_URL not set)',
    };
  }
  return { adminUrl: parseEnv(bootstrapEnvSchema).DB_BOOTSTRAP_URL, source: 'DB_BOOTSTRAP_URL' };
}

function readIfExists(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

/** Passwords for `role` already present under `keys` in the env files, deduplicated. */
function knownPasswords(contents: readonly string[], keys: readonly string[], role: string) {
  const passwords = new Set<string>();
  for (const content of contents) {
    for (const key of keys) {
      const value = readEnvValue(content, key);
      if (!value) continue;
      try {
        const url = new URL(value);
        if (url.username === role && url.password) passwords.add(decodeURIComponent(url.password));
      } catch {
        // not a URL; ignore
      }
    }
  }
  return [...passwords];
}

/** Reuses a password from .env for a role that already existed, but only if it really logs in. */
async function resolvePassword(
  outcome: RoleOutcome,
  candidates: readonly string[],
  loginUrl: (password: string) => URL,
  resetFlag: string,
): Promise<string> {
  if (outcome.password) return outcome.password;
  for (const candidate of candidates) {
    if (await canLogin(loginUrl(candidate))) {
      console.log(`  role ${outcome.role}: reusing the working password already in .env`);
      return candidate;
    }
  }
  throw new Error(
    `${outcome.role} exists but no working ${outcome.role} password was found in the .env files — ` +
      `rerun with --write-env ${resetFlag} to rotate it and write the new one`,
  );
}

async function main(): Promise<void> {
  const writeEnv = process.argv.includes('--write-env');
  const root = findRepoRoot();
  const envFiles = [join(root, '.env'), join(root, 'apps', 'api', '.env')];
  loadEnvFiles([envFiles[0] ?? '']);
  const dupes = checkDuplicateEnvKeys('.env', readIfExists(envFiles[0] ?? ''));
  if (dupes.status !== 'pass') console.log(`⚠ ${dupes.name}: ${dupes.detail}`);
  const { adminUrl, source } = adminUrlFromEnv();
  console.log(`admin connection: ${source} → ${maskUrl(adminUrl)}`);

  const result = await runBootstrap({
    adminUrl,
    databases: [DATABASES.dev, DATABASES.test],
    appRole: APP_ROLE,
    ownerRole: OWNER_ROLE,
    resetAppPassword: process.argv.includes('--reset-app-password'),
    resetOwnerPassword: process.argv.includes('--reset-owner-password'),
    log: (message) => console.log(`  ${message}`),
  });

  const hosts = deriveHosts(result.adminUrl.hostname);
  const contents = envFiles.map(readIfExists);
  let ownerPassword = result.owner.password;
  let appPassword = result.app.password;
  if (writeEnv) {
    ownerPassword = await resolvePassword(
      result.owner,
      knownPasswords(contents, ['DATABASE_URL_OWNER', 'DATABASE_URL_TEST_OWNER'], OWNER_ROLE),
      (password) =>
        withTarget(result.adminUrl, {
          host: hosts.direct,
          database: DATABASES.dev,
          user: OWNER_ROLE,
          password,
        }),
      '--reset-owner-password',
    );
    appPassword = await resolvePassword(
      result.app,
      knownPasswords(contents, ['DATABASE_URL', 'DATABASE_URL_TEST'], APP_ROLE),
      (password) =>
        withTarget(result.adminUrl, {
          host: hosts.pooled,
          database: DATABASES.dev,
          user: APP_ROLE,
          password,
        }),
      '--reset-app-password',
    );
  }

  const lines = buildEnvLines({
    serverUrl: result.adminUrl,
    owner: { role: result.owner.role, password: ownerPassword },
    app: { role: APP_ROLE, password: appPassword },
    devDatabase: DATABASES.dev,
    testDatabase: DATABASES.test,
  });
  const missingVector = Object.values(result.missingOptional).some((m) => m.length > 0);

  if (!writeEnv) {
    console.log(
      '\nPaste into the repo-root .env (these lines contain passwords — never share them):\n',
    );
    for (const line of lines) console.log(line);
    for (const role of [result.owner, result.app]) {
      if (role.created || role.passwordReset) {
        console.log(
          `\n${role.role} password was ${role.created ? 'generated' : 'reset'} just now and is shown only once.`,
        );
      } else if (!role.password) {
        console.log(
          `\n${role.role} already existed: its password was not changed and is not shown. ` +
            'Use the one you saved, or rerun with --write-env (it reuses the one in .env).',
        );
      }
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
    const { content, changes } = editEnv(before, values, BOOTSTRAP_KEYS);
    if (content !== before) writeFileSync(path, content, 'utf8');
    console.log(`${relative(root, path)}${before ? '' : ' (created)'}:`);
    for (const [key, change] of changes) {
      const value = values.get(key);
      console.log(`  ${change.padEnd(9)} ${key}${value ? `=${maskUrl(value)}` : ''}`);
    }
  });
  for (const role of [result.owner, result.app]) {
    if (role.created || role.passwordReset) {
      console.log(
        `\n${role.role} password was ${role.created ? 'generated' : 'reset'} and written to the files above only.`,
      );
    }
  }
  if (missingVector) {
    console.log('\nNote: pgvector is not installed — fine until M4; doctor shows it as a warning.');
  }
  console.log(
    'Next: `pnpm db:migrate`, `pnpm db:migrate --test`, `pnpm db:seed`, `pnpm run doctor`.',
  );
}

main().catch((error: unknown) => {
  console.error(`db:bootstrap failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
