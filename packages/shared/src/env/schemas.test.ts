import { describe, expect, it } from 'vitest';
import { EnvValidationError, parseEnv } from './load.js';
import { apiEnvSchema, testDatabaseEnvSchema } from './schemas.js';

const validApiEnv = {
  DATABASE_URL: 'postgresql://app_user:pw@localhost:5432/revops_dev',
  REDIS_URL: 'redis://localhost:6379',
};

describe('apiEnvSchema', () => {
  it('applies defaults for optional values', () => {
    const env = parseEnv(apiEnvSchema, validApiEnv);
    expect(env).toMatchObject({ NODE_ENV: 'development', LOG_LEVEL: 'info', API_PORT: 4000 });
  });

  it('treats blank values as unset so defaults still apply', () => {
    const env = parseEnv(apiEnvSchema, { ...validApiEnv, API_PORT: '', NODE_ENV: '' });
    expect(env.API_PORT).toBe(4000);
    expect(env.NODE_ENV).toBe('development');
  });

  it('coerces the port from a string', () => {
    expect(parseEnv(apiEnvSchema, { ...validApiEnv, API_PORT: '4100' }).API_PORT).toBe(4100);
  });

  it.each(['0', '70000', 'abc'])('rejects invalid port %s', (value) => {
    expect(() => parseEnv(apiEnvSchema, { ...validApiEnv, API_PORT: value })).toThrow(
      EnvValidationError,
    );
  });

  it('accepts both postgres:// and postgresql:// and redis:// / rediss://', () => {
    expect(() =>
      parseEnv(apiEnvSchema, {
        DATABASE_URL: 'postgres://u:p@h/db',
        REDIS_URL: 'rediss://default:p@h:1234',
      }),
    ).not.toThrow();
  });

  it('rejects a non-postgres DATABASE_URL and a non-redis REDIS_URL', () => {
    try {
      parseEnv(apiEnvSchema, { DATABASE_URL: 'mysql://u:p@h/db', REDIS_URL: 'http://h' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const issues = (error as EnvValidationError).issues;
      expect(issues).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^DATABASE_URL: /),
          expect.stringMatching(/^REDIS_URL: /),
        ]),
      );
    }
  });

  it('never echoes secret values in validation messages', () => {
    const secret = 's3cr3t-password';
    try {
      parseEnv(apiEnvSchema, { DATABASE_URL: `mysql://u:${secret}@h/db` });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain(secret);
    }
  });

  it('reports missing required vars by name as "is required"', () => {
    expect(() => parseEnv(apiEnvSchema, {})).toThrow(
      /DATABASE_URL: is required[\s\S]*REDIS_URL: is required/,
    );
  });

  it('treats a blank required var as missing', () => {
    expect(() => parseEnv(apiEnvSchema, { ...validApiEnv, DATABASE_URL: '' })).toThrow(
      /DATABASE_URL: is required/,
    );
  });

  it('says "must be a postgres:// URL" only when a value is present but wrong', () => {
    expect(() =>
      parseEnv(apiEnvSchema, { ...validApiEnv, DATABASE_URL: 'mysql://u:p@h/db' }),
    ).toThrow(/DATABASE_URL: must be a postgres:\/\/ URL/);
  });
});

describe('testDatabaseEnvSchema', () => {
  it('requires both test URLs', () => {
    expect(() =>
      parseEnv(testDatabaseEnvSchema, { DATABASE_URL_TEST: 'postgres://u:p@h/revops_test' }),
    ).toThrow(/DATABASE_URL_TEST_OWNER/);
  });
});
