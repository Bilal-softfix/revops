import { z } from 'zod';

/** Treats an empty string (e.g. `FOO=` in a .env file) as "not set". */
const blankAsUndefined = (value: unknown) => (value === '' ? undefined : value);

/** Required URL var: "is required" when missing/blank, `invalid` when present but wrong. */
const requiredUrl = (protocol: RegExp, invalid: string) =>
  z.preprocess(
    blankAsUndefined,
    z.url({
      protocol,
      error: (issue) => (issue.input === undefined ? 'is required' : invalid),
    }),
  );

const postgresUrl = requiredUrl(/^postgres(ql)?$/, 'must be a postgres:// URL');
const port = z.coerce.number().int().min(1).max(65_535);

export const nodeEnvSchema = z.enum(['development', 'test', 'production']);

export const commonEnvSchema = z.object({
  NODE_ENV: z.preprocess(blankAsUndefined, nodeEnvSchema.default('development')),
  LOG_LEVEL: z.preprocess(
    blankAsUndefined,
    z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  ),
  /** OTLP/HTTP collector base URL (e.g. http://localhost:4318). Unset = tracing off (no exporter). */
  OTEL_EXPORTER_OTLP_ENDPOINT: z.preprocess(
    blankAsUndefined,
    z.url({ protocol: /^https?$/ }).optional(),
  ),
  /**
   * Bearer token for GET /metrics. Optional in dev (open); required in production, where metrics
   * would otherwise leak traffic and queue details.
   */
  METRICS_TOKEN: z.preprocess(blankAsUndefined, z.string().min(16).optional()),
});

/** App runtime: connects as the non-owner `app_user` role (RLS enforced). */
export const databaseEnvSchema = z.object({
  DATABASE_URL: postgresUrl,
});

/** Migrations only: table owner role. */
export const migrationEnvSchema = z.object({
  DATABASE_URL_OWNER: postgresUrl,
});

/** Integration tests: a separate database, never the dev one. */
export const testDatabaseEnvSchema = z.object({
  DATABASE_URL_TEST: postgresUrl,
  DATABASE_URL_TEST_OWNER: postgresUrl,
});

/** `pnpm db:seed`: password for the demo users (dev data only — the seed refuses production). */
export const seedEnvSchema = z.object({
  SEED_PASSWORD: z.preprocess(
    blankAsUndefined,
    z.string({ error: 'is required' }).min(12, 'must be at least 12 characters'),
  ),
});

/**
 * One-off `pnpm run db:bootstrap`: a superuser (local Postgres, e.g. `postgres`) or a role with
 * CREATEDB + CREATEROLE (Neon's `neondb_owner`). ADR-012.
 */
export const bootstrapEnvSchema = z.object({
  DB_BOOTSTRAP_URL: postgresUrl,
});

const booleanFlag = z.enum(['true', 'false']).transform((value) => value === 'true');

export const apiEnvSchema = commonEnvSchema.extend(databaseEnvSchema.shape).extend({
  API_PORT: z.preprocess(blankAsUndefined, port.default(4000)),
  /** Web app origin, used to build links in emails (verify email, reset password). */
  APP_URL: z.preprocess(
    blankAsUndefined,
    z.url({ protocol: /^https?$/ }).default('http://localhost:3000'),
  ),
  /** `console` prints emails to the terminal (dev); `fake` keeps them in memory (tests). */
  EMAIL_DRIVER: z.preprocess(blankAsUndefined, z.enum(['console', 'fake']).default('console')),
  EMAIL_FROM: z.preprocess(blankAsUndefined, z.string().default('RevOps <no-reply@revops.local>')),
  /** Secure cookies. Browsers treat http://localhost as secure, so keep true in dev too. */
  COOKIE_SECURE: z.preprocess(blankAsUndefined, booleanFlag.default(true)),
});

/**
 * Settings that are fine in dev but unsafe in production: the console email driver writes live
 * verify/reset links (account-takeover tokens) to logs, and a non-https or localhost APP_URL puts
 * broken or downgradable links in emails. Returns `VAR: problem` messages; empty = OK.
 */
export function productionEnvProblems(env: ApiEnv): string[] {
  if (env.NODE_ENV !== 'production') return [];
  const problems: string[] = [];
  if (env.EMAIL_DRIVER === 'console' || env.EMAIL_DRIVER === 'fake') {
    problems.push(`EMAIL_DRIVER: "${env.EMAIL_DRIVER}" is not allowed in production`);
  }
  const appUrl = new URL(env.APP_URL);
  if (appUrl.protocol !== 'https:' || ['localhost', '127.0.0.1'].includes(appUrl.hostname)) {
    problems.push('APP_URL: must be a public https:// URL in production');
  }
  if (!env.COOKIE_SECURE) problems.push('COOKIE_SECURE: must be true in production');
  if (!env.METRICS_TOKEN) problems.push('METRICS_TOKEN: is required in production');
  return problems;
}

/**
 * The worker runs the same modules as the API (jobs send the auth emails), so it takes the API's
 * env plus its own settings.
 */
export const workerEnvSchema = apiEnvSchema.extend({
  /** Port of the worker's small HTTP server: GET /health, /ready, /metrics (0 = any free port). */
  WORKER_PORT: z.preprocess(
    blankAsUndefined,
    z.coerce.number().int().min(0).max(65_535).default(4001),
  ),
  /** How often the outbox relay looks for unpublished events. */
  OUTBOX_POLL_INTERVAL_MS: z.preprocess(
    blankAsUndefined,
    z.coerce.number().int().min(100).max(60_000).default(1000),
  ),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;
export type WorkerEnv = z.infer<typeof workerEnvSchema>;
