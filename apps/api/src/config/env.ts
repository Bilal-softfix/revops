import { join } from 'node:path';
import type { LogLevel } from '@nestjs/common';
import {
  type ApiEnv,
  type WorkerEnv,
  apiEnvSchema,
  loadAppEnv,
  parseEnv,
  workerEnvSchema,
} from '@revops/shared/env';

// Compiled to dist/config or run from src/config — either way apps/api is two levels up.
const APP_DIR = join(__dirname, '..', '..');

export function loadApiEnv(): ApiEnv {
  loadAppEnv(APP_DIR);
  return parseEnv(apiEnvSchema);
}

export function loadWorkerEnv(): WorkerEnv {
  loadAppEnv(APP_DIR);
  return parseEnv(workerEnvSchema);
}

const NEST_LEVELS: readonly LogLevel[] = ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'];
const LEVEL_INDEX: Record<ApiEnv['LOG_LEVEL'], number> = {
  fatal: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  trace: 5,
};

/** Maps LOG_LEVEL to Nest's built-in logger levels (replaced by pino in M0-T6). */
export function nestLogLevels(level: ApiEnv['LOG_LEVEL']): LogLevel[] {
  return NEST_LEVELS.slice(0, LEVEL_INDEX[level] + 1);
}
