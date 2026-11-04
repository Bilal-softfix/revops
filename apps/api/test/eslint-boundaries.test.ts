import { join } from 'node:path';
import { createConfig } from '@revops/config/eslint';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

// Runs the real shared ESLint config against a fixture tree shaped like the repo.
const fixtureRoot = join(__dirname, 'fixtures', 'boundaries');
const moduleFile = (name: string) => `apps/api/src/modules/beta/${name}.ts`;

describe('api import boundaries (eslint-plugin-boundaries)', () => {
  let eslint: ESLint;

  beforeAll(() => {
    eslint = new ESLint({
      cwd: fixtureRoot,
      overrideConfigFile: true,
      overrideConfig: createConfig({ rootDir: fixtureRoot }),
    });
  });

  async function boundaryErrors(file: string) {
    const [result] = await eslint.lintFiles([moduleFile(file)]);
    const fatal = result?.messages.filter((m) => m.fatal) ?? [];
    expect(fatal, 'fixture must parse').toEqual([]);
    return result?.messages.filter((m) => m.ruleId === 'boundaries/dependencies') ?? [];
  }

  it('allows importing another module through its index', async () => {
    expect(await boundaryErrors('via-index')).toEqual([]);
  });

  it('allows imports inside the same module', async () => {
    expect(await boundaryErrors('internal')).toEqual([]);
  });

  it("rejects importing another module's internals", async () => {
    const errors = await boundaryErrors('deep-import');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('Import "alpha" through its public index.ts');
  });

  it("rejects importing a provider's implementation directly", async () => {
    const errors = await boundaryErrors('provider-deep-import');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('Import "email" through its public index.ts');
  });
}, 60_000);
