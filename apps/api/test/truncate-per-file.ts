import { loadTestDatabaseEnv, truncateAll } from '@revops/db/testing';
import { beforeAll } from 'vitest';

beforeAll(async () => {
  await truncateAll(loadTestDatabaseEnv().ownerUrl);
});
