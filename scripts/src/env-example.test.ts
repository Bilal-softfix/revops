import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv as parseDotenv } from 'node:util';
import {
  apiEnvSchema,
  findRepoRoot,
  migrationEnvSchema,
  bootstrapEnvSchema,
  seedEnvSchema,
  testDatabaseEnvSchema,
  workerEnvSchema,
} from '@revops/shared/env';
import { describe, expect, it } from 'vitest';
import { checkTestDbIsolation } from './checks.js';

// Keeps `.env.example` files complete and valid: every var a schema knows must be documented.
const root = findRepoRoot(import.meta.dirname);
const readExample = (path: string) => parseDotenv(readFileSync(join(root, path), 'utf8'));

const rootExample = readExample('.env.example');
const apiExample = { ...rootExample, ...readExample('apps/api/.env.example') };

const schemas = {
  api: apiEnvSchema,
  worker: workerEnvSchema,
  migrations: migrationEnvSchema,
  tests: testDatabaseEnvSchema,
  bootstrap: bootstrapEnvSchema,
  seed: seedEnvSchema,
};

describe('.env.example files', () => {
  it.each(Object.entries(schemas))('satisfy the %s env schema', (_name, schema) => {
    expect(schema.safeParse(apiExample).error?.issues ?? []).toEqual([]);
  });

  it.each(Object.entries(schemas))('document every %s variable', (_name, schema) => {
    const missing = Object.keys(schema.shape).filter((key) => !(key in apiExample));
    expect(missing).toEqual([]);
  });

  it('use a separate *_test database for DATABASE_URL_TEST', () => {
    const { DATABASE_URL, DATABASE_URL_TEST } = rootExample;
    expect(checkTestDbIsolation(DATABASE_URL ?? '', DATABASE_URL_TEST ?? '').status).toBe('pass');
  });

  it('contain only placeholder secrets', () => {
    for (const [key, value] of Object.entries(apiExample)) {
      if (!/URL$/.test(key) || !value) continue; // blank = optional and unset
      expect(new URL(value ?? '').password, key).toMatch(/^(change-me)?$/);
    }
  });
});
