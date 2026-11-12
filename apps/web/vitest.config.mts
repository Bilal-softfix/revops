import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Unit tests for web logic (API client, proxy route, nav, redirects). Browser flows: Playwright.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./', import.meta.url)) } },
  test: {
    include: ['**/*.test.ts'],
    exclude: ['node_modules/**', '.next/**', 'e2e/**'],
    environment: 'node',
  },
});
