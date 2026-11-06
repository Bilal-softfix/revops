import { describe, expect, it } from 'vitest';
import {
  assertIdentifier,
  buildEnvLines,
  deriveHosts,
  generatePassword,
  passwordLiteral,
  withTarget,
} from './neon-urls.js';

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

  it('leaves non-Neon hosts unchanged', () => {
    expect(deriveHosts('localhost')).toEqual({
      direct: 'localhost',
      pooled: 'localhost',
      isNeon: false,
    });
  });
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

describe('withTarget', () => {
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
  const ownerUrl = new URL(
    `postgresql://neondb_owner:ownerpw@${NEON_DIRECT}/neondb?sslmode=require`,
  );
  const input = {
    ownerUrl,
    appRole: 'app_user',
    devDatabase: 'revops_dev',
    testDatabase: 'revops_test',
  };

  it('builds app_user on the pooled host and the owner on the direct host', () => {
    expect(buildEnvLines({ ...input, appPassword: 'secretpw' })).toEqual([
      `DATABASE_URL=postgresql://app_user:secretpw@${NEON_POOLED}/revops_dev?sslmode=require`,
      `DATABASE_URL_OWNER=postgresql://neondb_owner:ownerpw@${NEON_DIRECT}/revops_dev?sslmode=require`,
      `DATABASE_URL_TEST=postgresql://app_user:secretpw@${NEON_POOLED}/revops_test?sslmode=require`,
      `DATABASE_URL_TEST_OWNER=postgresql://neondb_owner:ownerpw@${NEON_DIRECT}/revops_test?sslmode=require`,
    ]);
  });

  it('uses a placeholder (never a guessed password) when the role already existed', () => {
    const lines = buildEnvLines({ ...input, appPassword: null });
    expect(lines[0]).toBe(
      `DATABASE_URL=postgresql://app_user:<APP_USER_PASSWORD>@${NEON_POOLED}/revops_dev?sslmode=require`,
    );
    expect(lines[2]).toContain('app_user:<APP_USER_PASSWORD>@');
  });

  it('derives the same lines whether the bootstrap URL was pooled or direct', () => {
    const pooledOwner = new URL(ownerUrl.toString().replace(NEON_DIRECT, NEON_POOLED));
    expect(buildEnvLines({ ...input, ownerUrl: pooledOwner, appPassword: 'p' })).toEqual(
      buildEnvLines({ ...input, appPassword: 'p' }),
    );
  });

  it('produces URLs the env schemas accept and the doctor isolation check passes', async () => {
    const { apiEnvSchema, testDatabaseEnvSchema, migrationEnvSchema } =
      await import('@revops/shared/env');
    const { checkTestDbIsolation } = await import('../checks.js');
    const env = Object.fromEntries(
      buildEnvLines({ ...input, appPassword: generatePassword() }).map((l) => {
        const i = l.indexOf('=');
        return [l.slice(0, i), l.slice(i + 1)];
      }),
    ) as Record<string, string>;
    expect(apiEnvSchema.safeParse({ ...env, REDIS_URL: 'redis://h:1' }).success).toBe(true);
    expect(testDatabaseEnvSchema.safeParse(env).success).toBe(true);
    expect(migrationEnvSchema.safeParse(env).success).toBe(true);
    expect(checkTestDbIsolation(env.DATABASE_URL ?? '', env.DATABASE_URL_TEST ?? '').status).toBe(
      'pass',
    );
  });
});
