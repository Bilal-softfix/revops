import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Unit tests only; *.int.test.ts need the test database (vitest.integration.config.mts).
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    exclude: ['**/*.int.test.ts', '**/node_modules/**'],
  },
  // esbuild can't emit decorator metadata; SWC can (Nest DI needs it).
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
