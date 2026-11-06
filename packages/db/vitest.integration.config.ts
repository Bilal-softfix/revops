import { defineConfig } from 'vitest/config';

// Integration tests hit DATABASE_URL_TEST: migrations once in globalSetup, tables truncated before
// each file, one file at a time (they share one database).
export default defineConfig({
  test: {
    include: ['test/**/*.int.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    setupFiles: ['test/truncate-per-file.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
