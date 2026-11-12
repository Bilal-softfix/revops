import { beforeAll } from 'vitest';
import { loadTestDatabaseEnv, truncateAll } from '../src/testing/index.js';

// Setup files run once per test file: every file starts from empty tables.
beforeAll(async () => {
  await truncateAll(loadTestDatabaseEnv().ownerUrl);
});
