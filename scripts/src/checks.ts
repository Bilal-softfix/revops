// Pure check logic for `pnpm run doctor`. No I/O here — doctor.ts gathers facts and feeds them in.
import type { z } from 'zod';
import { formatEnvIssues } from '@revops/shared/env';
import { duplicateKeys } from './bootstrap/env-file.js';

export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface CheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
}

export const REQUIRED_NODE_MAJOR = 22;
/** 22.12 unflagged require(esm), which apps/api relies on to load the ESM workspace packages. */
export const MIN_NODE_MINOR = 12;
/** ADR-010: PostgreSQL 18 everywhere (local dev/test, CI). */
export const MIN_POSTGRES_VERSION_NUM = 180_000;
export const REQUIRED_EXTENSIONS = ['citext', 'pg_trgm'] as const;
/** pgvector: not needed until M4 (knowledge base), so missing is a warning. CI always has it. */
export const OPTIONAL_EXTENSIONS = ['vector'] as const;

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
  const clean = version.replace(/^v/, '');
  const [major, minor] = clean.split('.').map(Number);
  const ok = major === REQUIRED_NODE_MAJOR && (minor ?? 0) >= MIN_NODE_MINOR;
  return ok
    ? { name: 'Node.js', status: 'pass', detail: `v${clean}` }
    : {
        name: 'Node.js',
        status: 'fail',
        detail: `v${clean} — need ${REQUIRED_NODE_MAJOR}.x ≥ ${REQUIRED_NODE_MAJOR}.${MIN_NODE_MINOR} (run \`fnm use\`)`,
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
          detail: `missing ${missing.join(', ')} — rerun pnpm run db:bootstrap (docs/05)`,
        },
  );
  const missingOptional = OPTIONAL_EXTENSIONS.filter((ext) => !facts.extensions.includes(ext));
  results.push(
    missingOptional.length === 0
      ? { name: `${label}: pgvector`, status: 'pass', detail: 'vector installed' }
      : {
          name: `${label}: pgvector`,
          status: 'warn',
          detail: 'vector not installed — optional until M4 (knowledge base); CI has it',
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
    : {
        name: `${label}: version`,
        status: 'fail',
        detail: `PostgreSQL ${facts.version} < 18 (ADR-010)`,
      };
}

/**
 * The owner runs migrations and owns the SECURITY DEFINER functions. A superuser owner would make
 * those functions bypass RLS entirely (unlike Neon/CI), so local dev uses revops_owner (ADR-012).
 */
export function checkOwnerNotSuperuser(
  label: string,
  role: string,
  isSuperuser: boolean,
): CheckResult {
  return isSuperuser
    ? {
        name: `${label}: owner role`,
        status: 'warn',
        detail: `${role} is a superuser — definer functions would bypass RLS; rerun db:bootstrap with DB_BOOTSTRAP_URL (creates revops_owner)`,
      }
    : { name: `${label}: owner role`, status: 'pass', detail: `${role} (not superuser)` };
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

/**
 * A key defined twice in one .env file silently takes the LAST value (e.g. a pasted real URL above
 * the copied .env.example placeholder). Reports key names and line numbers only, never values.
 */
export function checkDuplicateEnvKeys(file: string, content: string): CheckResult {
  const dupes = [...duplicateKeys(content)].map(
    ([key, lines]) => `${key} (lines ${lines.join(', ')})`,
  );
  return dupes.length === 0
    ? { name: `${file}: duplicate keys`, status: 'pass', detail: 'none' }
    : {
        name: `${file}: duplicate keys`,
        status: 'warn',
        detail: `${dupes.join('; ')} — the last line wins; delete the others`,
      };
}

export function summarize(results: readonly CheckResult[]): {
  ok: boolean;
  counts: Record<CheckStatus, number>;
} {
  const counts: Record<CheckStatus, number> = { pass: 0, warn: 0, fail: 0 };
  for (const result of results) counts[result.status] += 1;
  return { ok: counts.fail === 0, counts };
}
