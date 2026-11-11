import { Injectable } from '@nestjs/common';
import { sql } from '@revops/db';
import { fromDrizzle } from 'pg-boss';
import type { JobDefinition, SendOptions } from './job';
import { JobQueue } from './job-queue';
import { PgBossClient } from './pg-boss-client';

/** JobQueue on pg-boss (ADR-011). `options.tx` enqueues inside the caller's drizzle transaction. */
@Injectable()
export class PgBossJobQueue extends JobQueue {
  constructor(private readonly client: PgBossClient) {
    super();
  }

  async send<T>(job: JobDefinition<T>, data: T, options: SendOptions = {}): Promise<string | null> {
    const payload = job.schema.parse(data) as object;
    const boss = await this.client.ready(job);
    return boss.send(job.name, payload, {
      ...(options.id ? { id: options.id } : {}),
      ...(options.startAfter ? { startAfter: options.startAfter } : {}),
      ...(options.tx ? { db: fromDrizzle(options.tx, sql) } : {}),
    });
  }
}
