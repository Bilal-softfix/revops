import { z } from 'zod';
import type { Tx } from '@revops/db';

/** Retry/retention settings for a queue (pg-boss queue options, ADR-011). */
export interface QueueSettings {
  /** Attempts after the first. Default 3. */
  retryLimit?: number;
  /** Seconds before the first retry; doubles each time (with jitter). Default 5. */
  retryDelaySeconds?: number;
  /** A job running longer than this is considered failed and retried. Default 5 min. */
  expireInSeconds?: number;
  /** How long completed jobs are kept (debugging). Default 1 day — job data can hold emails. */
  deleteAfterSeconds?: number;
}

/**
 * A named job type: its queue name, the Zod schema its payload must satisfy (validated when the
 * job is sent AND when it runs — job rows are input like any other), and queue settings.
 * Payloads must never hold secrets (passwords, plaintext tokens): job rows persist in Postgres.
 */
export interface JobDefinition<T> {
  readonly name: string;
  readonly schema: z.ZodType<T>;
  readonly settings: Required<QueueSettings>;
}

const QUEUE_NAME = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;

export const DEFAULT_QUEUE_SETTINGS: Required<QueueSettings> = {
  retryLimit: 3,
  retryDelaySeconds: 5,
  expireInSeconds: 300,
  deleteAfterSeconds: 86_400,
};

export function defineJob<T>(
  name: string,
  schema: z.ZodType<T>,
  settings: QueueSettings = {},
): JobDefinition<T> {
  if (!QUEUE_NAME.test(name)) throw new Error(`invalid job name "${name}" (use module.action)`);
  return { name, schema, settings: { ...DEFAULT_QUEUE_SETTINGS, ...settings } };
}

/** Payload of scheduled (cron) jobs: nothing. */
export const EMPTY_PAYLOAD = z.strictObject({});
export type EmptyPayload = z.infer<typeof EMPTY_PAYLOAD>;

export interface SendOptions {
  /** Job id (uuid). A second send with the same id for the same queue is a no-op. */
  id?: string;
  /** Run no earlier than this. */
  startAfter?: Date;
  /** Enqueue inside this transaction: the job exists only if the transaction commits. */
  tx?: Tx;
}

export interface JobContext {
  jobId: string;
  /** 0 on the first attempt. */
  attempt: number;
}

/**
 * Runs one job type. Any Nest provider extending this is discovered by the worker's JobRunner
 * (and by the in-memory queue in tests). Throwing fails the attempt; pg-boss retries it.
 */
export abstract class JobHandler<T = unknown> {
  abstract readonly job: JobDefinition<T>;
  /** Optional cron (UTC) — the job is then also scheduled with an empty payload. */
  readonly cron?: string;
  abstract handle(data: T, context: JobContext): Promise<void>;
}
