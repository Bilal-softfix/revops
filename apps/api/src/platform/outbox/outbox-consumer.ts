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
 * false when the event had already been processed — or when its tenant no longer exists (e.g. a
 * discarded unverified signup): there is nothing left to apply it to, and retrying can't help.
 */
export async function processOnce(
  database: Database,
  consumer: string,
  event: OutboxEnvelope,
  fn: (tx: Tx) => Promise<void>,
): Promise<boolean> {
  try {
    return await database.withContext({ tenantId: event.tenantId }, async (tx) => {
      const claimed = await tx
        .insert(processedEvents)
        .values({ consumer, eventId: event.eventId, tenantId: event.tenantId })
        .onConflictDoNothing()
        .returning({ eventId: processedEvents.eventId });
      if (claimed.length === 0) return false;
      await fn(tx);
      return true;
    });
  } catch (error) {
    if (isTenantGone(error)) return false;
    throw error;
  }
}

/** The processed_events → tenants foreign key failed: the event's tenant was deleted. */
function isTenantGone(error: unknown): boolean {
  for (const source of [error, (error as { cause?: unknown }).cause]) {
    const pg = source as { code?: unknown; constraint_name?: unknown } | undefined;
    if (pg?.code === '23503' && pg.constraint_name === 'processed_events_tenant_id_tenants_id_fk') {
      return true;
    }
  }
  return false;
}
