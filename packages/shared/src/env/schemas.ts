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
const redisUrl = requiredUrl(/^rediss?$/, 'must be a redis:// or rediss:// URL');
const port = z.coerce.number().int().min(1).max(65_535);

export const nodeEnvSchema = z.enum(['development', 'test', 'production']);

export const commonEnvSchema = z.object({
  NODE_ENV: z.preprocess(blankAsUndefined, nodeEnvSchema.default('development')),
  LOG_LEVEL: z.preprocess(
    blankAsUndefined,
    z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  ),
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

/** One-off `pnpm run db:bootstrap`: the Neon owner role (needs CREATEDB + CREATEROLE). */
export const neonBootstrapEnvSchema = z.object({
  NEON_BOOTSTRAP_URL: postgresUrl,
});

export const redisEnvSchema = z.object({
  REDIS_URL: redisUrl,
});

export const apiEnvSchema = commonEnvSchema
  .extend(databaseEnvSchema.shape)
  .extend(redisEnvSchema.shape)
  .extend({
    API_PORT: z.preprocess(blankAsUndefined, port.default(4000)),
  });

export const workerEnvSchema = commonEnvSchema
  .extend(databaseEnvSchema.shape)
  .extend(redisEnvSchema.shape);

export type ApiEnv = z.infer<typeof apiEnvSchema>;
export type WorkerEnv = z.infer<typeof workerEnvSchema>;
