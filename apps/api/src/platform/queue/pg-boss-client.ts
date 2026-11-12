import { type BeforeApplicationShutdown, Logger } from '@nestjs/common';
import { PgBoss } from 'pg-boss';
import { safeErrorSummary } from '../errors/safe-error';
import type { JobDefinition } from './job';

export const PGBOSS_SCHEMA = 'pgboss';

export interface PgBossClientOptions {
  /** app_user URL (DATABASE_URL). pg-boss never needs DDL: migration 0013 installed its schema. */
  url: string;
  /** Worker: runs maintenance (retention, expiry) and the cron scheduler. API: producer only. */
  role: 'api' | 'worker';
}

/**
 * One PgBoss instance per process, started lazily on first use (so the API boots and serves
 * /health even if the queue is briefly unavailable, and tests that swap in the fake never
 * connect). Queues are created on first use; createQueue is idempotent DML (non-partitioned).
 */
export class PgBossClient implements BeforeApplicationShutdown {
  private readonly logger = new Logger('PgBoss');
  private readonly boss: PgBoss;
  private started: Promise<PgBoss> | undefined;
  private readonly queues = new Map<string, Promise<void>>();

  constructor(options: PgBossClientOptions) {
    const worker = options.role === 'worker';
    this.boss = new PgBoss({
      connectionString: options.url,
      schema: PGBOSS_SCHEMA,
      application_name: `revops-${options.role}`,
      max: worker ? 6 : 3,
      // The owner installs and upgrades the schema (migrations); app_user only uses it.
      migrate: false,
      createSchema: false,
      // REINDEX needs table ownership, which app_user deliberately lacks.
      reindex: false,
      supervise: worker,
      schedule: worker,
      instanceName: `revops-${options.role}`,
    });
    this.boss.on('error', (error: unknown) => this.logger.error(safeErrorSummary(error)));
  }

  /** The started instance. */
  instance(): Promise<PgBoss> {
    this.started ??= this.boss.start().catch((error: unknown) => {
      this.started = undefined; // let the next call retry
      throw error;
    });
    return this.started;
  }

  /** Started instance with `job`'s queue created (once per process). */
  async ready(job: JobDefinition<unknown>): Promise<PgBoss> {
    const boss = await this.instance();
    let created = this.queues.get(job.name);
    if (!created) {
      const { retryLimit, retryDelaySeconds, expireInSeconds, deleteAfterSeconds } = job.settings;
      created = boss
        .createQueue(job.name, {
          retryLimit,
          retryDelay: retryDelaySeconds,
          retryBackoff: true,
          expireInSeconds,
          deleteAfterSeconds,
        })
        .catch((error: unknown) => {
          this.queues.delete(job.name);
          throw error;
        });
      this.queues.set(job.name, created);
    }
    await created;
    return boss;
  }

  /**
   * Before (not during) onApplicationShutdown: Nest closes every provider of a module in parallel
   * there, so the DB pool would end under in-flight jobs. Graceful stop lets them finish first.
   */
  async beforeApplicationShutdown(): Promise<void> {
    if (!this.started) return;
    try {
      await this.started;
    } catch {
      return; // never started
    }
    await this.boss.stop({ graceful: true, timeout: 10_000 });
  }
}
