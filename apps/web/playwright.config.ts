import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { loadTestDatabaseEnv } from '@revops/db/testing';

// E2E: the BUILT api + worker + web (next start) against the TEST database (guarded: name must
// end in _test), on their own ports so a running `pnpm dev` is untouched. Emails go to files
// (EMAIL_DRIVER=file) that the tests read. Build first: `pnpm turbo run build` (CI does).
const { appUrl } = loadTestDatabaseEnv();

const WEB_PORT = 3100;
const API_PORT = 4100;
const WORKER_PORT = 4101;
const MAIL_DIR = resolve(import.meta.dirname, '.e2e-mail');
const apiDir = resolve(import.meta.dirname, '..', 'api');

const backendEnv = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'warn',
  DATABASE_URL: appUrl,
  API_PORT: String(API_PORT),
  WORKER_PORT: String(WORKER_PORT),
  APP_URL: `http://localhost:${WEB_PORT}`,
  EMAIL_DRIVER: 'file',
  EMAIL_FILE_DIR: MAIL_DIR,
  OUTBOX_POLL_INTERVAL_MS: '500',
  METRICS_TOKEN: '',
};

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      name: 'api',
      command: 'node dist/main.js',
      cwd: apiDir,
      env: backendEnv,
      url: `http://localhost:${API_PORT}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      name: 'worker',
      command: 'node dist/worker.js',
      cwd: apiDir,
      env: backendEnv,
      url: `http://localhost:${WORKER_PORT}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      name: 'web',
      command: `pnpm exec next start --port ${WEB_PORT}`,
      // Playwright runs with NODE_ENV=test; `next start` must see production.
      env: { NODE_ENV: 'production', API_INTERNAL_URL: `http://localhost:${API_PORT}` },
      url: `http://localhost:${WEB_PORT}/login`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
