import { Injectable, Logger } from '@nestjs/common';
import { MEMBER_JOINED_V1, type OutboxEnvelope, USER_SIGNED_UP_V1 } from '@revops/shared';
import type { Tx } from '@revops/db';
import { Database } from '../database/database';
import type { JobContext } from '../queue/job';
import { OutboxConsumer, consumerJob, processOnce } from './outbox-consumer';

/**
 * M0-T6 demo consumer: the template for real ones (M1+). Logs each event once per event id,
 * however many times it is delivered. Real consumers put their side effects in `apply`, using
 * `tx` so they commit together with the processed_events marker.
 */
@Injectable()
export class DemoEventLogConsumer extends OutboxConsumer {
  static readonly NAME = 'platform.demo-event-log';
  readonly job = consumerJob(DemoEventLogConsumer.NAME);
  readonly events = [USER_SIGNED_UP_V1, MEMBER_JOINED_V1];
  private readonly logger = new Logger('DemoEventLog');

  constructor(private readonly database: Database) {
    super();
  }

  async handle(event: OutboxEnvelope, context: JobContext): Promise<void> {
    const applied = await processOnce(this.database, this.job.name, event, (tx) =>
      this.apply(event, tx),
    );
    if (!applied) {
      this.logger.debug(`event ${event.eventId} already processed (job ${context.jobId})`);
    }
  }

  /** The side effect. Runs inside processOnce's transaction, at most once per event. */
  protected apply(event: OutboxEnvelope, _tx: Tx): Promise<void> {
    this.logger.log(`consumed ${event.type} ${event.eventId} (tenant ${event.tenantId})`);
    return Promise.resolve();
  }
}
