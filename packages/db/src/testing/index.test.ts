import { describe, expect, it } from 'vitest';
import { assertSafeTestDatabase } from './index.js';

const NEON = 'ep-cool-a1b2.ap-southeast-1.aws.neon.tech';
const url = (host: string, db: string) => `postgresql://u:p@${host}/${db}`;

describe('assertSafeTestDatabase', () => {
  it('accepts a *_test database that is not the dev database', () => {
    expect(() =>
      assertSafeTestDatabase([url(NEON, 'revops_test')], url(NEON, 'revops_dev')),
    ).not.toThrow();
  });

  it('refuses a database whose name does not end in _test', () => {
    expect(() => assertSafeTestDatabase([url(NEON, 'revops_dev')])).toThrow(
      /does not end in _test/,
    );
  });

  it('refuses the dev URL even via the pooled vs direct host', () => {
    const pooled = NEON.replace('ep-cool-a1b2', 'ep-cool-a1b2-pooler');
    expect(() =>
      assertSafeTestDatabase([url(NEON, 'shared_test')], url(pooled, 'shared_test')),
    ).toThrow(/points at the dev database/);
  });
});
