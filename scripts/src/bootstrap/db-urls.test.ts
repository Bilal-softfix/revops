import { describe, expect, it } from 'vitest';
import {
  assertIdentifier,
  buildEnvLines,
  deriveHosts,
  generatePassword,
  passwordLiteral,
  withTarget,
  isLocalHost,
} from './db-urls.js';

const NEON_DIRECT = 'ep-cool-darkness-a1b2c3d4.ap-southeast-1.aws.neon.tech';
const NEON_POOLED = 'ep-cool-darkness-a1b2c3d4-pooler.ap-southeast-1.aws.neon.tech';

describe('deriveHosts', () => {
  it('adds -pooler to the endpoint id of a direct Neon host', () => {
    expect(deriveHosts(NEON_DIRECT)).toEqual({
      direct: NEON_DIRECT,
      pooled: NEON_POOLED,
      isNeon: true,
    });
  });

  it('accepts a pooled host and derives the direct one (no double -pooler)', () => {
    expect(deriveHosts(NEON_POOLED)).toEqual({
      direct: NEON_DIRECT,
      pooled: NEON_POOLED,
      isNeon: true,
    });
  });

  it.each(['localhost', '127.0.0.1', 'db.internal', 'ep-lookalike.example.com'])(
    'never derives a -pooler host for non-Neon host %s',
    (host) => {
      expect(deriveHosts(host)).toEqual({ direct: host, pooled: host, isNeon: false });
    },
  );
});

describe('generatePassword', () => {
  it('is 43 URL-safe chars (256 bits) and unique', () => {
    const a = generatePassword();
    const b = generatePassword();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it('survives a round trip through a postgres URL unescaped', () => {
    const password = generatePassword();
    const url = new URL(`postgresql://app_user:${password}@h/db`);
    expect(url.password).toBe(password);
  });
});

describe('assertIdentifier / passwordLiteral (DDL injection guards)', () => {
  it.each(['revops_dev', 'app_user', '_x1'])('accepts %s', (name) => {
    expect(assertIdentifier('database', name)).toBe(name);
  });

  it.each(['Revops', 'a-b', 'x"; drop role app_user; --', '', '1abc', 'a'.repeat(64)])(
    'rejects %j',
    (name) => {
      expect(() => assertIdentifier('database', name)).toThrow(/invalid database name/);
    },
  );

  it('quotes a URL-safe password and rejects anything else', () => {
    expect(passwordLiteral('Ab_9-x')).toBe("'Ab_9-x'");
    expect(() => passwordLiteral("x' OR '1")).toThrow();
  });
});

describe('isLocalHost', () => {
  it.each(['localhost', '127.0.0.1', '::1', '[::1]'])('%s is local', (h) => {
    expect(isLocalHost(h)).toBe(true);
  });
  it('a Neon host is not', () => expect(isLocalHost(NEON_DIRECT)).toBe(false));
});

describe('withTarget', () => {
  it('adds sslmode=disable for a local host without one, and keeps an explicit sslmode', () => {
    const local = new URL('postgresql://postgres:pw@localhost:5432/postgres');
    expect(withTarget(local, { host: 'localhost', database: 'revops_dev' }).toString()).toBe(
      'postgresql://postgres:pw@localhost:5432/revops_dev?sslmode=disable',
    );
    const explicit = new URL('postgresql://postgres:pw@localhost:5432/postgres?sslmode=require');
    expect(
      withTarget(explicit, { host: 'localhost', database: 'x' }).searchParams.get('sslmode'),
    ).toBe('require');
  });

  it('keeps port and query (sslmode, channel_binding) while changing host/db/user', () => {
    const base = new URL(
      `postgresql://neondb_owner:ownerpw@${NEON_DIRECT}:5432/neondb?sslmode=require&channel_binding=require`,
    );
    const url = withTarget(base, {
      host: NEON_POOLED,
      database: 'revops_dev',
      user: 'app_user',
      password: 'pw',
    });
    expect(url.toString()).toBe(
      `postgresql://app_user:pw@${NEON_POOLED}:5432/revops_dev?sslmode=require&channel_binding=require`,
    );
  });
});

describe('buildEnvLines', () => {
  const neon = new URL(`postgresql://neondb_owner:ownerpw@${NEON_DIRECT}/neondb?sslmode=require`);
  const base = {
    serverUrl: neon,
    owner: { role: 'neondb_owner', password: 'ownerpw' },
    devDatabase: 'revops_dev',
    testDatabase: 'revops_test',
  };

  it('Neon: app_user on the pooled host, the owner on the direct host', () => {
    expect(buildEnvLines({ ...base, app: { role: 'app_user', password: 'secretpw' } })).toEqual([
      `DATABASE_URL=postgresql://app_user:secretpw@${NEON_POOLED}/revops_dev?sslmode=require`,
      `DATABASE_URL_OWNER=postgresql://neondb_owner:ownerpw@${NEON_DIRECT}/revops_dev?sslmode=require`,
      `DATABASE_URL_TEST=postgresql://app_user:secretpw@${NEON_POOLED}/revops_test?sslmode=require`,
      `DATABASE_URL_TEST_OWNER=postgresql://neondb_owner:ownerpw@${NEON_DIRECT}/revops_test?sslmode=require`,
    ]);
  });

  it('local Postgres: one host, the dedicated owner role, sslmode=disable', () => {
    const lines = buildEnvLines({
      serverUrl: new URL('postgresql://postgres:superpw@localhost:5432/postgres'),
      owner: { role: 'revops_owner', password: 'ownerpw' },
      app: { role: 'app_user', password: 'apppw' },
      devDatabase: 'revops_dev',
      testDatabase: 'revops_test',
    });
    expect(lines).toEqual([
      'DATABASE_URL=postgresql://app_user:apppw@localhost:5432/revops_dev?sslmode=disable',
      'DATABASE_URL_OWNER=postgresql://revops_owner:ownerpw@localhost:5432/revops_dev?sslmode=disable',
      'DATABASE_URL_TEST=postgresql://app_user:apppw@localhost:5432/revops_test?sslmode=disable',
      'DATABASE_URL_TEST_OWNER=postgresql://revops_owner:ownerpw@localhost:5432/revops_test?sslmode=disable',
    ]);
    expect(lines.join(' ')).not.toContain('superpw');
  });

  it('uses placeholders (never a guessed password) when a role already existed', () => {
    const lines = buildEnvLines({
      ...base,
      owner: { role: 'revops_owner', password: null },
      app: { role: 'app_user', password: null },
    });
    expect(lines[0]).toBe(
      `DATABASE_URL=postgresql://app_user:<APP_USER_PASSWORD>@${NEON_POOLED}/revops_dev?sslmode=require`,
    );
    expect(lines[1]).toContain('revops_owner:<OWNER_PASSWORD>@');
    expect(lines[2]).toContain('app_user:<APP_USER_PASSWORD>@');
  });

  it('derives the same lines whether the bootstrap URL was pooled or direct', () => {
    const pooled = new URL(neon.toString().replace(NEON_DIRECT, NEON_POOLED));
    const app = { role: 'app_user', password: 'p' };
    expect(buildEnvLines({ ...base, serverUrl: pooled, app })).toEqual(
      buildEnvLines({ ...base, app }),
    );
  });

  it.each([
    ['Neon', neon],
    ['local', new URL('postgresql://postgres:x@localhost:5432/postgres')],
  ])('%s: URLs pass the env schemas and the doctor isolation check', async (_label, serverUrl) => {
    const { apiEnvSchema, testDatabaseEnvSchema, migrationEnvSchema } =
      await import('@revops/shared/env');
    const { checkTestDbIsolation } = await import('../checks.js');
    const env = Object.fromEntries(
      buildEnvLines({
        ...base,
        serverUrl,
        app: { role: 'app_user', password: generatePassword() },
      }).map((l) => {
        const i = l.indexOf('=');
        return [l.slice(0, i), l.slice(i + 1)];
      }),
    ) as Record<string, string>;
    expect(apiEnvSchema.safeParse(env).success).toBe(true);
    expect(testDatabaseEnvSchema.safeParse(env).success).toBe(true);
    expect(migrationEnvSchema.safeParse(env).success).toBe(true);
    expect(checkTestDbIsolation(env.DATABASE_URL ?? '', env.DATABASE_URL_TEST ?? '').status).toBe(
      'pass',
    );
  });
});
