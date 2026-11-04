import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findRepoRoot, loadAppEnv, loadEnvFiles } from './load.js';

const KEYS = ['REVOPS_TEST_A', 'REVOPS_TEST_B', 'REVOPS_TEST_C'] as const;

describe('env loading', () => {
  let root: string;
  let appDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'revops-env-'));
    appDir = join(root, 'apps', 'api');
    mkdirSync(appDir, { recursive: true });
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages: []\n');
    for (const key of KEYS) delete process.env[key];
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    for (const key of KEYS) delete process.env[key];
  });

  it('finds the repo root from a nested directory', () => {
    expect(findRepoRoot(appDir)).toBe(root);
  });

  it('throws when there is no workspace root', () => {
    const outside = mkdtempSync(join(tmpdir(), 'revops-noroot-'));
    try {
      expect(() => findRepoRoot(outside)).toThrow(/pnpm-workspace\.yaml/);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('skips missing files', () => {
    expect(loadEnvFiles([join(root, 'nope.env')])).toEqual([]);
  });

  it('applies precedence: real env > app .env > root .env', () => {
    writeFileSync(
      join(root, '.env'),
      'REVOPS_TEST_A=root\nREVOPS_TEST_B=root\nREVOPS_TEST_C=root\n',
    );
    writeFileSync(join(appDir, '.env'), 'REVOPS_TEST_B=app\nREVOPS_TEST_C=app\n');
    process.env.REVOPS_TEST_C = 'real';

    const loaded = loadAppEnv(appDir);

    expect(loaded).toEqual([join(appDir, '.env'), join(root, '.env')]);
    expect(process.env.REVOPS_TEST_A).toBe('root');
    expect(process.env.REVOPS_TEST_B).toBe('app');
    expect(process.env.REVOPS_TEST_C).toBe('real');
  });
});
