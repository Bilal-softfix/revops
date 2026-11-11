import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { sql } from '@revops/db';
import type { OutboxEnvelope } from '@revops/shared';
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
 */
@Injectable()
export class OutboxRelay implements OnApplicationBootstrap, OnApplicationShutdown {
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

  /** One pass. Returns how many events were published (0 = nothing pending). */
  async relayOnce(): Promise<number> {
    const subscriptions = this.subscriptions();
    const published = await this.database.db.transaction(async (tx) => {
      const rows = (await tx.execute<ClaimedRow>(
        sql`select * from outbox_claim_batch(${this.options.batchSize})`,
      )) as unknown as ClaimedRow[];
      if (rows.length === 0) return 0;
      for (const row of rows) {
        const envelope: OutboxEnvelope = {
          eventId: row.id,
          tenantId: row.tenant_id,
          type: row.type,
          aggregateId: row.aggregate_id,
          payload: row.payload,
          occurredAt: new Date(row.occurred_at).toISOString(),
        };
        for (const consumer of subscriptions.get(row.type) ?? []) {
          await this.queue.send(consumer.job, envelope, { id: row.id, tx });
        }
      }
      const ids = sql.join(
        rows.map((row) => sql`${row.id}`),
        sql`, `,
      );
      await tx.execute(
        sql`select outbox_mark_published(array[${ids}]::uuid[], ${this.clock.now().toISOString()}::timestamptz)`,
      );
      return rows.length;
    });
    if (published > 0) this.metrics.outboxPublished.inc(published);
    return published;
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

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
  }
}
