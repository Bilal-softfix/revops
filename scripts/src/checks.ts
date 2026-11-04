// Pure check logic for `pnpm run doctor`. No I/O here — doctor.ts gathers facts and feeds them in.
import type { z } from 'zod';
import { formatEnvIssues } from '@revops/shared/env';

export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface CheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
}

export const REQUIRED_NODE_MAJOR = 22;
export const MIN_POSTGRES_VERSION_NUM = 160_000;
export const REQUIRED_EXTENSIONS = ['vector', 'citext', 'pg_trgm'] as const;
export const MIN_REDIS_MAJOR = 7;

/** Hides credentials: `postgresql://app_user:****@host/db`. Never print raw URLs. */
export function maskUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.password) url.password = '****';
    url.search = '';
    return url.toString();
  } catch {
    return '<unparseable url>';
  }
}

export function checkNodeVersion(version: string): CheckResult {
  const major = Number(version.replace(/^v/, '').split('.')[0]);
  return major === REQUIRED_NODE_MAJOR
    ? { name: 'Node.js', status: 'pass', detail: `v${version.replace(/^v/, '')}` }
    : {
        name: 'Node.js',
        status: 'fail',
        detail: `v${version.replace(/^v/, '')} — need ${REQUIRED_NODE_MAJOR}.x (run \`fnm use\`)`,
      };
}

export function checkUv(version: string | null): CheckResult {
  return version
    ? { name: 'uv', status: 'pass', detail: version }
    : { name: 'uv', status: 'fail', detail: 'not found on PATH — needed for apps/voice-agent' };
}

export function checkEnv(
  name: string,
  schema: z.ZodType,
  env: Record<string, string | undefined>,
): CheckResult {
  const result = schema.safeParse(env);
  return result.success
    ? { name, status: 'pass', detail: 'ok' }
    : { name, status: 'fail', detail: formatEnvIssues(result.error).join('; ') };
}

function databaseName(raw: string): string | null {
  try {
    const url = new URL(raw);
    return decodeURIComponent(url.pathname.replace(/^\//, '')) || null;
  } catch {
    return null;
  }
}

function hostAndDb(raw: string): string | null {
  try {
    const url = new URL(raw);
    return `${url.hostname.replace(/-pooler(?=\.)/, '')}/${url.pathname}`;
  } catch {
    return null;
  }
}

/** The test DB must be a different database whose name ends in `_test` (tests truncate tables). */
export function checkTestDbIsolation(devUrl: string, testUrl: string): CheckResult {
  const name = 'Test DB isolation';
  const testDb = databaseName(testUrl);
  if (!testDb) return { name, status: 'fail', detail: 'DATABASE_URL_TEST has no database name' };
  if (hostAndDb(devUrl) === hostAndDb(testUrl)) {
    return { name, status: 'fail', detail: 'DATABASE_URL_TEST points at the dev database' };
  }
  if (!testDb.endsWith('_test')) {
    return { name, status: 'fail', detail: `test database "${testDb}" must end in _test` };
  }
  return { name, status: 'pass', detail: testDb };
}

export interface PostgresFacts {
  versionNum: number;
  version: string;
  role: string;
  isSuperuser: boolean;
  bypassRls: boolean;
  databaseOwner: string;
  ownedPublicTables: number;
  extensions: string[];
}

/**
 * Checks a connection that the app (not migrations) will use: it must be a plain role so that
 * forced RLS actually applies — not superuser, no BYPASSRLS, not the DB owner, owns no tables.
 */
export function evaluateAppPostgres(label: string, facts: PostgresFacts): CheckResult[] {
  const results: CheckResult[] = [evaluatePostgresVersion(label, facts)];

  const missing = REQUIRED_EXTENSIONS.filter((ext) => !facts.extensions.includes(ext));
  results.push(
    missing.length === 0
      ? { name: `${label}: extensions`, status: 'pass', detail: REQUIRED_EXTENSIONS.join(', ') }
      : {
          name: `${label}: extensions`,
          status: 'fail',
          detail: `missing ${missing.join(', ')} — run CREATE EXTENSION as owner (docs/05)`,
        },
  );

  const problems: string[] = [];
  if (facts.isSuperuser) problems.push('is superuser');
  if (facts.bypassRls) problems.push('has BYPASSRLS');
  if (facts.role === facts.databaseOwner) problems.push('owns the database');
  if (facts.ownedPublicTables > 0) problems.push(`owns ${facts.ownedPublicTables} table(s)`);
  results.push(
    problems.length === 0
      ? { name: `${label}: role`, status: 'pass', detail: `${facts.role} (RLS will apply)` }
      : {
          name: `${label}: role`,
          status: 'fail',
          detail: `${facts.role} ${problems.join(', ')} — RLS would be bypassed; use app_user`,
        },
  );
  return results;
}

export function evaluatePostgresVersion(
  label: string,
  facts: Pick<PostgresFacts, 'versionNum' | 'version'>,
): CheckResult {
  return facts.versionNum >= MIN_POSTGRES_VERSION_NUM
    ? { name: `${label}: version`, status: 'pass', detail: `PostgreSQL ${facts.version}` }
    : { name: `${label}: version`, status: 'fail', detail: `PostgreSQL ${facts.version} < 16` };
}

/** Owner and app connections must be different roles, otherwise RLS is bypassed in the app. */
export function checkRoleSeparation(appRole: string, ownerRole: string): CheckResult {
  return appRole !== ownerRole
    ? { name: 'DB role separation', status: 'pass', detail: `app=${appRole}, owner=${ownerRole}` }
    : {
        name: 'DB role separation',
        status: 'fail',
        detail: `DATABASE_URL and DATABASE_URL_OWNER both use ${appRole}`,
      };
}

/** Parses `key:value` lines from a Redis INFO reply. */
export function parseRedisInfo(info: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const line of info.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx > 0) fields.set(line.slice(0, idx), line.slice(idx + 1).trim());
  }
  return fields;
}

export function evaluateRedis(info: string): CheckResult[] {
  const fields = parseRedisInfo(info);
  const results: CheckResult[] = [];

  const version = fields.get('redis_version');
  const major = version ? Number(version.split('.')[0]) : NaN;
  results.push(
    !version
      ? { name: 'Redis: version', status: 'warn', detail: 'unknown (INFO server not available)' }
      : major >= MIN_REDIS_MAJOR
        ? { name: 'Redis: version', status: 'pass', detail: version }
        : { name: 'Redis: version', status: 'warn', detail: `${version} — Redis 7 expected` },
  );

  // BullMQ loses jobs if Redis evicts keys under memory pressure.
  const policy = fields.get('maxmemory_policy');
  results.push(
    policy === 'noeviction'
      ? { name: 'Redis: maxmemory-policy', status: 'pass', detail: 'noeviction' }
      : {
          name: 'Redis: maxmemory-policy',
          status: 'warn',
          detail: `${policy ?? 'unknown'} — set to noeviction (BullMQ can lose jobs)`,
        },
  );
  return results;
}

export function summarize(results: readonly CheckResult[]): {
  ok: boolean;
  counts: Record<CheckStatus, number>;
} {
  const counts: Record<CheckStatus, number> = { pass: 0, warn: 0, fail: 0 };
  for (const result of results) counts[result.status] += 1;
  return { ok: counts.fail === 0, counts };
}
