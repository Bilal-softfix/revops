import { join } from 'node:path';
import {
  type ApiEnv,
  type WorkerEnv,
  EnvValidationError,
  apiEnvSchema,
  loadAppEnv,
  parseEnv,
  productionEnvProblems,
  workerEnvSchema,
} from '@revops/shared/env';

/** DI token for the validated env (ApiEnv; the worker provides its WorkerEnv superset). */
export const API_ENV = Symbol('API_ENV');

// Compiled to dist/config or run from src/config — either way apps/api is two levels up.
const APP_DIR = join(__dirname, '..', '..');

function assertProductionSafe<T extends ApiEnv>(env: T): T {
  const problems = productionEnvProblems(env);
  if (problems.length > 0) throw new EnvValidationError(problems);
  return env;
}

export function loadApiEnv(): ApiEnv {
  loadAppEnv(APP_DIR);
  return assertProductionSafe(parseEnv(apiEnvSchema));
}

/** The worker sends the auth emails too, so the same production checks apply. */
export function loadWorkerEnv(): WorkerEnv {
  loadAppEnv(APP_DIR);
  return assertProductionSafe(parseEnv(workerEnvSchema));
}
