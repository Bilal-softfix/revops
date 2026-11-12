import { describe, expect, it } from 'vitest';
import { safeErrorSummary } from './safe-error';

describe('safeErrorSummary', () => {
  it('drops the message (drizzle puts query params in it) but keeps class, SQLSTATE and frames', () => {
    const cause = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint_name: 'tenants_slug_unique',
    });
    const error = new Error(
      'Failed query: insert into "users" ...\nparams: asha@example.com,Asha,$argon2id$v=19$secret',
      { cause },
    );
    error.name = 'DrizzleQueryError';
    const summary = safeErrorSummary(error);
    expect(summary).toMatch(/^DrizzleQueryError code=23505 constraint=tenants_slug_unique/);
    expect(summary).toMatch(/\n\s+at /);
    expect(summary).not.toMatch(/asha@example\.com|argon2id|Failed query|params/);
  });

  it('handles non-Error throws', () => {
    expect(safeErrorSummary('boom')).toBe('non-error thrown (string)');
  });
});
