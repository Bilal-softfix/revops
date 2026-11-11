import { type OutboxEnvelope, outboxEnvelopeSchema } from '@revops/shared';
import { type Tx, processedEvents } from '@revops/db';
import type { Database } from '../database/database';
import { type JobDefinition, JobHandler, type QueueSettings, defineJob } from '../queue/job';

/** The job a consumer's queue carries: one outbox event envelope. */
export function consumerJob(name: string, settings?: QueueSettings): JobDefinition<OutboxEnvelope> {
  return defineJob(name, outboxEnvelopeSchema, settings);
}

/**
 * Subscribes to outbox event types. The relay enqueues one job per (event, subscribed consumer),
 * with job id = event id, onto the consumer's own queue (`job.name`). Consumers must be
 * idempotent: implement `handle` with `processOnce`.
 */
export abstract class OutboxConsumer extends JobHandler<OutboxEnvelope> {
  abstract readonly events: readonly string[];
}

/**
 * CLAUDE.md rule 4: applies `fn` at most once per (consumer, event). The processed_events row is
 * inserted in the same tenant transaction as `fn`'s writes, so either both commit or neither does.
 * A concurrent duplicate blocks on the primary key until the first commits, then skips. Returns
 * false when the event had already been processed.
 */
export function processOnce(
  database: Database,
  consumer: string,
  event: OutboxEnvelope,
  fn: (tx: Tx) => Promise<void>,
): Promise<boolean> {
  return database.withContext({ tenantId: event.tenantId }, async (tx) => {
    const claimed = await tx
      .insert(processedEvents)
      .values({ consumer, eventId: event.eventId, tenantId: event.tenantId })
      .onConflictDoNothing()
      .returning({ eventId: processedEvents.eventId });
    if (claimed.length === 0) return false;
    await fn(tx);
    return true;
  });
}
