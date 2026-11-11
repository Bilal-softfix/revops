// `pnpm run doctor` — validates env vars and checks the dev/test databases (local Postgres 18, ADR-012).
// Exit code 1 if any check fails; warnings don't fail. Never prints secrets or raw URLs.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import postgres from 'postgres';
import {
  apiEnvSchema,
  findRepoRoot,
  loadAppEnv,
  migrationEnvSchema,
  testDatabaseEnvSchema,
  workerEnvSchema,
} from '@revops/shared/env';
import {
  type CheckResult,
  type PostgresFacts,
  checkEnv,
  checkNodeVersion,
  checkDuplicateEnvKeys,
  checkOwnerNotSuperuser,
  checkRoleSeparation,
  checkTestDbIsolation,
  checkUv,
  evaluateAppPostgres,
  evaluatePostgresVersion,
  maskUrl,
  summarize,
} from './checks.js';

const CONNECT_TIMEOUT_SEC = 10;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function uvVersion(): string | null {
  const result = spawnSync('uv', ['--version'], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

async function withPostgres<T>(url: string, fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(url, {
    max: 1,
    connect_timeout: CONNECT_TIMEOUT_SEC,
    prepare: false,
    onnotice: () => undefined,
  });
  try {
    return await fn(sql);
  } finally {
    await sql.end({ timeout: 2 });
  }
}

async function postgresFacts(url: string): Promise<PostgresFacts> {
  return withPostgres(url, async (sql) => {
    const [row] = await sql<
      {
        version_num: number;
        version: string;
        role: string;
        is_superuser: boolean;
        bypass_rls: boolean;
        database_owner: string;
        owned_public_tables: number;
        extensions: string[];
      }[]
    >`
      select current_setting('server_version_num')::int as version_num,
             current_setting('server_version') as version,
             current_user::text as role,
             r.rolsuper as is_superuser,
             r.rolbypassrls as bypass_rls,
             pg_get_userbyid(d.datdba)::text as database_owner,
             (select count(*)::int from pg_tables t
               where t.schemaname = 'public' and t.tableowner = current_user) as owned_public_tables,
             coalesce((select array_agg(extname::text) from pg_extension), '{}') as extensions
      from pg_roles r
      join pg_database d on d.datname = current_database()
      where r.rolname = current_user`;
    if (!row) throw new Error('could not read role/database facts');
    return {
      versionNum: row.version_num,
      version: row.version,
      role: row.role,
      isSuperuser: row.is_superuser,
      bypassRls: row.bypass_rls,
      databaseOwner: row.database_owner,
      ownedPublicTables: row.owned_public_tables,
      extensions: row.extensions,
    };
  });
}

async function checkAppDatabase(
  label: string,
  url: string | undefined,
): Promise<{
  results: CheckResult[];
  role?: string;
}> {
  if (!url) return { results: [{ name: label, status: 'fail', detail: 'skipped — not set' }] };
  try {
    const facts = await postgresFacts(url);
    return {
      results: [
        { name: `${label}: connect`, status: 'pass', detail: maskUrl(url) },
        ...evaluateAppPostgres(label, facts),
      ],
      role: facts.role,
    };
  } catch (error) {
    return {
      results: [{ name: `${label}: connect`, status: 'fail', detail: errorMessage(error) }],
    };
  }
}

async function checkOwnerDatabase(
  label: string,
  url: string | undefined,
): Promise<{
  results: CheckResult[];
  role?: string;
}> {
  if (!url) return { results: [{ name: label, status: 'fail', detail: 'skipped — not set' }] };
  try {
    const facts = await withPostgres(url, async (sql) => {
      const [row] = await sql<
        { version_num: number; version: string; role: string; superuser: boolean }[]
      >`
        select current_setting('server_version_num')::int as version_num,
               current_setting('server_version') as version,
               current_user::text as role,
               (select rolsuper from pg_roles where rolname = current_user) as superuser`;
      if (!row) throw new Error('empty result');
      return {
        versionNum: row.version_num,
        version: row.version,
        role: row.role,
        superuser: row.superuser,
      };
    });
    return {
      results: [
        { name: `${label}: connect`, status: 'pass', detail: maskUrl(url) },
        evaluatePostgresVersion(label, facts),
        checkOwnerNotSuperuser(label, facts.role, facts.superuser),
      ],
      role: facts.role,
    };
  } catch (error) {
    return {
      results: [{ name: `${label}: connect`, status: 'fail', detail: errorMessage(error) }],
    };
  }
}

const ICON = { pass: '✔', warn: '⚠', fail: '✖' } as const;

function print(results: readonly CheckResult[]): void {
  const width = Math.max(...results.map((r) => r.name.length));
  for (const r of results) console.log(`${ICON[r.status]} ${r.name.padEnd(width)}  ${r.detail}`);
}

async function main(): Promise<void> {
  const root = findRepoRoot();
  const loaded = loadAppEnv(join(root, 'apps', 'api'));
  console.log(
    `RevOps doctor — env files loaded: ${loaded.length ? loaded.map((p) => p.slice(root.length + 1)).join(', ') : 'none'}\n`,
  );

  const env = process.env;
  const results: CheckResult[] = [
    checkNodeVersion(process.versions.node),
    checkUv(uvVersion()),
    checkEnv('env: api', apiEnvSchema, env),
    checkEnv('env: worker', workerEnvSchema, env),
    checkEnv('env: migrations', migrationEnvSchema, env),
    checkEnv('env: tests', testDatabaseEnvSchema, env),
    ...loaded.map((path) =>
      checkDuplicateEnvKeys(relative(root, path), readFileSync(path, 'utf8')),
    ),
  ];

  if (env.DATABASE_URL && env.DATABASE_URL_TEST) {
    results.push(checkTestDbIsolation(env.DATABASE_URL, env.DATABASE_URL_TEST));
  }

  const [dev, devOwner, test, testOwner] = await Promise.all([
    checkAppDatabase('DATABASE_URL', env.DATABASE_URL),
    checkOwnerDatabase('DATABASE_URL_OWNER', env.DATABASE_URL_OWNER),
    checkAppDatabase('DATABASE_URL_TEST', env.DATABASE_URL_TEST),
    checkOwnerDatabase('DATABASE_URL_TEST_OWNER', env.DATABASE_URL_TEST_OWNER),
  ]);
  results.push(...dev.results, ...devOwner.results, ...test.results, ...testOwner.results);
  if (dev.role && devOwner.role) results.push(checkRoleSeparation(dev.role, devOwner.role));

  print(results);
  const { ok, counts } = summarize(results);
  console.log(`\n${counts.pass} passed, ${counts.warn} warning(s), ${counts.fail} failed`);
  if (!ok) {
    console.log('Fix the ✖ items — see docs/05-local-dev-setup.md');
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(`doctor crashed: ${errorMessage(error)}`);
  process.exitCode = 1;
});
