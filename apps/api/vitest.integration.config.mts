import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// API integration tests against DATABASE_URL_TEST (same strategy as packages/db): migrate once,
// truncate before each file, one file at a time.
export default defineConfig({
  test: {
    include: ['test/**/*.int.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    setupFiles: ['test/truncate-per-file.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
