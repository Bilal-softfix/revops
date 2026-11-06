import { defineConfig } from 'vitest/config';

// Unit tests only; *.int.test.ts need a database and run via vitest.integration.config.ts.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    exclude: ['**/*.int.test.ts', '**/node_modules/**'],
  },
});
