import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
  // esbuild can't emit decorator metadata; SWC can (Nest DI needs it).
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
