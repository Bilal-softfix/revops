import { describe, expect, it } from 'vitest';
import { apiEnvSchema } from '@revops/shared/env';
import {
  type PostgresFacts,
  checkEnv,
  checkNodeVersion,
  REDIS_NOT_CONFIGURED,
  checkDuplicateEnvKeys,
  checkRoleSeparation,
  checkTestDbIsolation,
  checkUv,
  evaluateAppPostgres,
  evaluateRedis,
  maskUrl,
  parseRedisInfo,
  summarize,
} from './checks.js';

const goodFacts: PostgresFacts = {
  versionNum: 160_004,
  version: '16.4',
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

describe('REDIS_NOT_CONFIGURED', () => {
  it('is a warning, so doctor stays green without Redis until M0-T6', () => {
    expect(REDIS_NOT_CONFIGURED.status).toBe('warn');
    expect(summarize([REDIS_NOT_CONFIGURED]).ok).toBe(true);
  });
  it('api/worker env validate without REDIS_URL', () => {
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
  it('passes for a plain app_user with all extensions on PG16', () => {
    expect(evaluateAppPostgres('DB', goodFacts).every((r) => r.status === 'pass')).toBe(true);
  });

  it('fails below PostgreSQL 16', () => {
    const results = evaluateAppPostgres('DB', {
      ...goodFacts,
      versionNum: 150_008,
      version: '15.8',
    });
    expect(statusOf(results, 'version')).toBe('fail');
  });

  it('names missing extensions', () => {
    const results = evaluateAppPostgres('DB', { ...goodFacts, extensions: ['citext'] });
    const ext = results.find((r) => r.name.endsWith('extensions'));
    expect(ext?.status).toBe('fail');
    expect(ext?.detail).toContain('vector');
    expect(ext?.detail).toContain('pg_trgm');
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

describe('Redis', () => {
  const info = '# Server\r\nredis_version:7.4.2\r\n\r\n# Memory\r\nmaxmemory_policy:noeviction\r\n';

  it('parses INFO output with CRLF line endings', () => {
    expect(parseRedisInfo(info).get('maxmemory_policy')).toBe('noeviction');
  });

  it('passes for Redis 7 with noeviction', () => {
    expect(evaluateRedis(info).every((r) => r.status === 'pass')).toBe(true);
  });

  it('warns (not fails) on an evicting policy', () => {
    const results = evaluateRedis(info.replace('noeviction', 'volatile-lru'));
    expect(statusOf(results, 'maxmemory-policy')).toBe('warn');
    expect(summarize(results).ok).toBe(true);
  });

  it('warns when INFO is unavailable', () => {
    expect(evaluateRedis('').map((r) => r.status)).toEqual(['warn', 'warn']);
  });

  it('warns on Redis 6', () => {
    expect(statusOf(evaluateRedis(info.replace('7.4.2', '6.2.14')), 'version')).toBe('warn');
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
