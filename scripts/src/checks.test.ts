import { describe, expect, it } from 'vitest';
import { apiEnvSchema } from '@revops/shared/env';
import {
  type PostgresFacts,
  checkEnv,
  checkNodeVersion,
  checkDuplicateEnvKeys,
  checkRoleSeparation,
  checkTestDbIsolation,
  checkUv,
  evaluateAppPostgres,
  maskUrl,
  checkOwnerNotSuperuser,
  summarize,
} from './checks.js';

const goodFacts: PostgresFacts = {
  versionNum: 180_006,
  version: '18.6',
  role: 'app_user',
  isSuperuser: false,
  bypassRls: false,
  databaseOwner: 'neondb_owner',
  ownedPublicTables: 0,
  extensions: ['plpgsql', 'vector', 'citext', 'pg_trgm'],
};

const statusOf = (results: { name: string; status: string }[], suffix: string) =>
  results.find((r) => r.name.endsWith(suffix))?.status;

describe('maskUrl', () => {
  it('masks the password and drops query params', () => {
    const masked = maskUrl(
      'postgresql://app_user:hunter2@ep-x.neon.tech/revops_dev?sslmode=require',
    );
    expect(masked).toBe('postgresql://app_user:****@ep-x.neon.tech/revops_dev');
    expect(masked).not.toContain('hunter2');
  });

  it('never returns an unparseable input verbatim', () => {
    expect(maskUrl('not a url with secret')).toBe('<unparseable url>');
  });
});

describe('checkNodeVersion', () => {
  it.each(['22.23.4', 'v22.12.0'])('passes on %s', (v) => {
    expect(checkNodeVersion(v).status).toBe('pass');
  });
  // 22.11 lacks unflagged require(esm); 24 is the system Node we must never use silently.
  it.each(['24.18.0', 'v20.11.0', '22.11.0', '23.0.0'])('fails on %s', (v) => {
    expect(checkNodeVersion(v).status).toBe('fail');
  });
});

describe('checkUv', () => {
  it('fails when uv is missing', () => expect(checkUv(null).status).toBe('fail'));
  it('passes with a version', () => expect(checkUv('uv 0.13.7').status).toBe('pass'));
});

describe('checkEnv', () => {
  it('lists missing variable names without values', () => {
    const result = checkEnv('env: api', apiEnvSchema, {});
    expect(result.status).toBe('fail');
    expect(result.detail).toMatch(/DATABASE_URL/);
  });
});

describe('checkDuplicateEnvKeys', () => {
  it('passes when every key is defined once', () => {
    expect(checkDuplicateEnvKeys('.env', 'A=1\nB=2\n').status).toBe('pass');
  });
  it('warns with key names and line numbers, never values', () => {
    const result = checkDuplicateEnvKeys('.env', 'A=real-secret\n# x\nB=2\nA=placeholder\n');
    expect(result.status).toBe('warn');
    expect(result.detail).toContain('A (lines 1, 4)');
    expect(result.detail).not.toMatch(/real-secret|placeholder/);
  });
});

describe('no Redis (ADR-011)', () => {
  it('api/worker env validate with only a DATABASE_URL', () => {
    const env = { DATABASE_URL: 'postgresql://app_user:p@h/revops_dev' };
    expect(checkEnv('env: api', apiEnvSchema, env).status).toBe('pass');
  });
});

describe('checkTestDbIsolation', () => {
  const dev = 'postgresql://u:p@ep-x-pooler.aws.neon.tech/revops_dev';

  it('passes for a separate *_test database', () => {
    expect(
      checkTestDbIsolation(dev, 'postgresql://u:p@ep-x-pooler.aws.neon.tech/revops_test').status,
    ).toBe('pass');
  });

  it('fails when test URL is the dev database (even via the direct endpoint)', () => {
    expect(checkTestDbIsolation(dev, dev).status).toBe('fail');
    expect(checkTestDbIsolation(dev, 'postgresql://o:q@ep-x.aws.neon.tech/revops_dev').status).toBe(
      'fail',
    );
  });

  it('fails when the test database name does not end in _test', () => {
    expect(checkTestDbIsolation(dev, 'postgresql://u:p@ep-x.aws.neon.tech/scratch').status).toBe(
      'fail',
    );
  });
});

describe('evaluateAppPostgres', () => {
  it('passes for a plain app_user with all extensions on PG18', () => {
    expect(evaluateAppPostgres('DB', goodFacts).every((r) => r.status === 'pass')).toBe(true);
  });

  it('fails below PostgreSQL 18 (ADR-010)', () => {
    const results = evaluateAppPostgres('DB', {
      ...goodFacts,
      versionNum: 160_004,
      version: '16.4',
    });
    expect(statusOf(results, 'version')).toBe('fail');
  });

  it('fails on missing required extensions and names them', () => {
    const results = evaluateAppPostgres('DB', { ...goodFacts, extensions: ['vector'] });
    const ext = results.find((r) => r.name.endsWith('extensions'));
    expect(ext?.status).toBe('fail');
    expect(ext?.detail).toContain('citext');
    expect(ext?.detail).toContain('pg_trgm');
  });

  it('only warns when pgvector is missing (optional until M4), so doctor stays green', () => {
    const results = evaluateAppPostgres('DB', { ...goodFacts, extensions: ['citext', 'pg_trgm'] });
    expect(statusOf(results, 'pgvector')).toBe('warn');
    expect(statusOf(results, 'extensions')).toBe('pass');
    expect(summarize(results).ok).toBe(true);
  });

  it.each<[string, Partial<PostgresFacts>]>([
    ['superuser', { isSuperuser: true }],
    ['BYPASSRLS', { bypassRls: true }],
    ['database owner', { databaseOwner: 'app_user' }],
    ['table owner', { ownedPublicTables: 3 }],
  ])('fails the role check when the app role is %s (RLS would not apply)', (_label, patch) => {
    expect(statusOf(evaluateAppPostgres('DB', { ...goodFacts, ...patch }), 'role')).toBe('fail');
  });
});

describe('checkRoleSeparation', () => {
  it('fails when app and owner use the same role', () => {
    expect(checkRoleSeparation('neondb_owner', 'neondb_owner').status).toBe('fail');
  });
  it('passes for distinct roles', () => {
    expect(checkRoleSeparation('app_user', 'neondb_owner').status).toBe('pass');
  });
});

describe('checkOwnerNotSuperuser', () => {
  it('warns for a superuser owner (definer functions would bypass RLS)', () => {
    expect(checkOwnerNotSuperuser('DB', 'postgres', true).status).toBe('warn');
  });
  it('passes for a plain owner role', () => {
    expect(checkOwnerNotSuperuser('DB', 'revops_owner', false).status).toBe('pass');
  });
});

describe('summarize', () => {
  it('is not ok when anything fails', () => {
    const { ok, counts } = summarize([
      { name: 'a', status: 'pass', detail: '' },
      { name: 'b', status: 'warn', detail: '' },
      { name: 'c', status: 'fail', detail: '' },
    ]);
    expect(ok).toBe(false);
    expect(counts).toEqual({ pass: 1, warn: 1, fail: 1 });
  });
});
