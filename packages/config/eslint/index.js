// Shared ESLint flat config for the monorepo. Composed by the root eslint.config.js, so it
// applies whether ESLint runs from the repo root (editor hook) or from a package (`pnpm lint`).
import { join } from 'node:path';
import js from '@eslint/js';
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import prettier from 'eslint-config-prettier';
import boundaries from 'eslint-plugin-boundaries';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const TS_FILES = ['**/*.{ts,tsx,mts,cts}'];

/**
 * Re-scopes a shareable config to one app directory. Blocks without `files` would otherwise apply
 * to the whole repo, so they get the app's source glob.
 */
function scopeTo(dir, configs) {
  return configs.map((config) => {
    const keys = Object.keys(config).filter((key) => key !== 'name');
    if (keys.length === 1 && keys[0] === 'ignores') {
      return { ...config, ignores: config.ignores.map((glob) => `${dir}/${glob}`) };
    }
    const files = config.files ?? ['**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}'];
    return { ...config, files: files.map((glob) => `${dir}/${glob}`) };
  });
}

/**
 * API module boundaries: a module (or provider) may only be imported by other modules through its
 * public `index.ts`. Inside a module, anything goes. Policies are evaluated last-match-wins.
 */
const apiBoundaries = {
  files: ['apps/api/src/**/*.ts'],
  plugins: { boundaries },
  settings: {
    'import/resolver': { node: { extensions: ['.ts', '.js', '.mjs', '.json'] } },
    'boundaries/elements': [
      { type: 'api-module', pattern: 'apps/api/src/modules/*', capture: ['name'] },
      { type: 'api-provider', pattern: 'apps/api/src/providers/*', capture: ['name'] },
    ],
  },
  rules: {
    'boundaries/dependencies': [
      'error',
      {
        default: 'allow',
        policies: [
          {
            from: { element: { types: ['api-module', 'api-provider'] } },
            disallow: { to: { element: { types: ['api-module', 'api-provider'] } } },
            message:
              'Import "{{ to.element.captured.name }}" through its public index.ts, not its internals.',
          },
          {
            from: { element: { types: ['api-module', 'api-provider'] } },
            allow: {
              to: {
                element: { types: ['api-module', 'api-provider'], fileInternalPath: 'index.ts' },
              },
            },
          },
          {
            from: { element: { types: ['api-module', 'api-provider'] } },
            allow: { dependency: { relationship: { to: 'internal' } } },
          },
        ],
      },
    ],
  },
};

/**
 * @param {{ rootDir: string }} options rootDir = absolute repo root (for boundaries + tsconfig lookup)
 * @returns {import('eslint').Linter.Config[]}
 */
export function createConfig({ rootDir }) {
  return tseslint.config(
    {
      ignores: [
        '**/node_modules/**',
        '**/dist/**',
        '**/.next/**',
        '**/.turbo/**',
        '**/coverage/**',
        '**/.venv/**',
        '**/next-env.d.ts',
        '**/test/fixtures/**',
      ],
    },
    js.configs.recommended,
    {
      languageOptions: {
        ecmaVersion: 2024,
        sourceType: 'module',
        globals: { ...globals.node },
      },
    },
    ...scopeTo('apps/web', nextCoreWebVitals),
    {
      files: TS_FILES,
      extends: [tseslint.configs.recommendedTypeChecked],
      languageOptions: {
        parserOptions: { projectService: true, tsconfigRootDir: rootDir },
      },
      rules: {
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/consistent-type-imports': [
          'error',
          // Nest DI reads constructor param types at runtime — they must stay value imports.
          {
            prefer: 'type-imports',
            fixStyle: 'inline-type-imports',
            disallowTypeAnnotations: false,
          },
        ],
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
        ],
      },
    },
    {
      files: ['apps/api/**/*.ts'],
      rules: {
        // Decorated Nest classes need runtime imports for metadata; let the compiler decide.
        '@typescript-eslint/consistent-type-imports': 'off',
        '@typescript-eslint/no-extraneous-class': 'off',
      },
    },
    {
      settings: { next: { rootDir: join(rootDir, 'apps/web') }, 'boundaries/root-path': rootDir },
    },
    apiBoundaries,
    prettier,
  );
}
