import type { JobDefinition, SendOptions } from './job';

/**
 * Producer side of our queue interface (ADR-011). Modules depend on this, never on pg-boss:
 * PgBossJobQueue in the app, InMemoryJobQueue in unit/integration tests.
 */
export abstract class JobQueue {
  /**
   * Validates `data` against the job's schema and enqueues it. Returns the job id, or null when a
   * job with the same `options.id` already exists in that queue (deduplicated).
   */
  abstract send<T>(job: JobDefinition<T>, data: T, options?: SendOptions): Promise<string | null>;
}
