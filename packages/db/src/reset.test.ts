import { describe, expect, it } from 'vitest';
import { assertResettableDevDatabase, databaseName } from './reset.js';

const url = (db: string, user = 'revops_owner') => `postgresql://${user}:pw@localhost:5432/${db}`;

describe('assertResettableDevDatabase (db:reset:dev guard)', () => {
  it('allows the local *_dev database', () => {
    expect(
      assertResettableDevDatabase({
        urls: [url('revops_dev', 'app_user'), url('revops_dev')],
        nodeEnv: 'development',
        testUrls: [url('revops_test')],
      }),
    ).toBe('revops_dev');
  });

  it.each([
    ['production', { urls: [url('revops_dev')], nodeEnv: 'production' }, /NODE_ENV=production/],
    ['a non-_dev name', { urls: [url('revops')], nodeEnv: 'development' }, /ends in _dev/],
    ['a _test name', { urls: [url('revops_test')], nodeEnv: 'development' }, /ends in _dev/],
    ['a prod-like name', { urls: [url('revops_dev_prod')], nodeEnv: undefined }, /ends in _dev/],
    [
      'URLs pointing at different databases',
      { urls: [url('revops_dev'), url('other_dev')], nodeEnv: 'development' },
      /different databases/,
    ],
    [
      'the test database configured with a _dev name',
      { urls: [url('shared_dev')], nodeEnv: 'test', testUrls: [url('shared_dev')] },
      /also the test database/,
    ],
  ])('refuses %s', (_label, input, message) => {
    expect(() => assertResettableDevDatabase(input)).toThrow(message);
  });

  it('databaseName decodes the path', () => {
    expect(databaseName('postgresql://u:p@h:5432/my%5Fdev?sslmode=disable')).toBe('my_dev');
  });
});
