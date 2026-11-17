import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type BeforeApplicationShutdown,
} from '@nestjs/common';
import { sql } from '@revops/db';
import { type OutboxEnvelope, eventDefinition, outboxEnvelopeSchema } from '@revops/shared';
import type { z } from 'zod';
import { Clock } from '../clock';
import { Database } from '../database/database';
import { safeErrorSummary } from '../errors/safe-error';
import { Metrics } from '../metrics/metrics';
import { JobHandlers } from '../queue/job-handlers';
import { JobQueue } from '../queue/job-queue';
import { OutboxConsumer } from './outbox-consumer';

export const OUTBOX_RELAY_OPTIONS = Symbol('OUTBOX_RELAY_OPTIONS');

export interface OutboxRelayOptions {
  pollIntervalMs: number;
  batchSize: number;
  /** false in tests: they call relayOnce() themselves. */
  autoStart: boolean;
}

interface ClaimedRow extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  type: string;
  aggregate_id: string | null;
  payload: Record<string, unknown>;
  occurred_at: string | Date;
}

/**
 * Worker only. Moves outbox_events to consumer queues (ADR-011):
 *   one transaction = claim a batch (FOR UPDATE SKIP LOCKED, so concurrent relays never share
 *   rows) → enqueue one job per subscribed consumer with job id = event id (a re-send of the same
 *   event to the same queue is a no-op) → mark the batch published.
 * A crash before commit leaves the events unpublished and no jobs behind; consumers dedupe on
 * the event id anyway (processOnce), so delivery is effectively exactly-once.
 *
 * A row that can't be valid (type not in the shared event registry, or a payload failing its
 * schema) is dead-lettered in the same pass (`outbox_dead_letter`, with a value-free reason)
 * instead of failing the batch — one bad event never blocks delivery for any tenant (M1-T0).
 */
@Injectable()
export class OutboxRelay implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger('OutboxRelay');
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<unknown> | undefined;
  private stopped = false;

  constructor(
    private readonly database: Database,
    private readonly queue: JobQueue,
    private readonly handlers: JobHandlers,
    private readonly metrics: Metrics,
    private readonly clock: Clock,
    @Inject(OUTBOX_RELAY_OPTIONS) private readonly options: OutboxRelayOptions,
  ) {}

  /** Consumers by event type. */
  subscriptions(): Map<string, OutboxConsumer[]> {
    const map = new Map<string, OutboxConsumer[]>();
    for (const handler of this.handlers.all()) {
      if (!(handler instanceof OutboxConsumer)) continue;
      for (const type of handler.events) map.set(type, [...(map.get(type) ?? []), handler]);
    }
    return map;
  }

  /**
   * One pass. Returns how many events were handled — published or dead-lettered (0 = nothing
   * pending; a full batch means more may be waiting).
   */
  async relayOnce(): Promise<number> {
    const subscriptions = this.subscriptions();
    const now = this.clock.now().toISOString();
    const result = await this.database.db.transaction(async (tx) => {
      const rows = (await tx.execute<ClaimedRow>(
        sql`select * from outbox_claim_batch(${this.options.batchSize})`,
      )) as unknown as ClaimedRow[];
      const published: string[] = [];
      const dead: { row: ClaimedRow; reason: string }[] = [];
      for (const row of rows) {
        const checked = validate(row);
        if ('reason' in checked) {
          dead.push({ row, reason: checked.reason });
          continue;
        }
        for (const consumer of subscriptions.get(row.type) ?? []) {
          await this.queue.send(consumer.job, checked.envelope, { id: row.id, tx });
        }
        published.push(row.id);
      }
      if (published.length > 0) {
        const ids = sql.join(
          published.map((id) => sql`${id}`),
          sql`, `,
        );
        await tx.execute(
          sql`select outbox_mark_published(array[${ids}]::uuid[], ${now}::timestamptz)`,
        );
      }
      for (const { row, reason } of dead) {
        await tx.execute(
          sql`select outbox_dead_letter(${row.id}::uuid, ${reason}, ${now}::timestamptz)`,
        );
      }
      return { handled: rows.length, published: published.length, dead };
    });
    if (result.published > 0) this.metrics.outboxPublished.inc(result.published);
    for (const { row, reason } of result.dead) {
      this.metrics.outboxDeadLettered.inc({ type: row.type.slice(0, 100) });
      this.logger.error(
        `dead-lettered outbox event ${row.id} (${row.type}, tenant ${row.tenant_id}): ${reason}`,
      );
    }
    return result.handled;
  }

  onApplicationBootstrap(): void {
    if (!this.options.autoStart) return;
    this.logger.log(`polling every ${this.options.pollIntervalMs} ms`);
    this.schedule(0);
  }

  private schedule(delay: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.running = this.relayOnce()
        .then((count) =>
          // A full batch means more may be waiting: go again right away.
          this.schedule(count >= this.options.batchSize ? 0 : this.options.pollIntervalMs),
        )
        .catch((error: unknown) => {
          this.metrics.outboxRelayErrors.inc();
          this.logger.error(`relay pass failed: ${safeErrorSummary(error)}`);
          this.schedule(this.options.pollIntervalMs);
        });
    }, delay);
  }

  /** Stops polling and waits for the current pass, before the DB pool closes. */
  async beforeApplicationShutdown(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
  }
}

/** Paths and codes of Zod issues — never the offending values (payloads can hold PII). */
function describeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.code}`)
    .join('; ');
}

/** The envelope to deliver, or why this row can never be delivered. */
function validate(row: ClaimedRow): { envelope: OutboxEnvelope } | { reason: string } {
  const definition = eventDefinition(row.type);
  if (!definition) return { reason: 'unknown event type (not in the shared event registry)' };
  const envelope = outboxEnvelopeSchema.safeParse({
    eventId: row.id,
    tenantId: row.tenant_id,
    type: row.type,
    aggregateId: row.aggregate_id,
    payload: row.payload,
    occurredAt: new Date(row.occurred_at).toISOString(),
  });
  if (!envelope.success) return { reason: `invalid envelope: ${describeIssues(envelope.error)}` };
  const payload = definition.schema.safeParse(envelope.data.payload);
  if (!payload.success) return { reason: `invalid payload: ${describeIssues(payload.error)}` };
  return { envelope: envelope.data };
}
