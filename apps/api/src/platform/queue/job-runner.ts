import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { Job } from 'pg-boss';
import { safeErrorSummary } from '../errors/safe-error';
import { Metrics } from '../metrics/metrics';
import type { JobHandler } from './job';
import { JobHandlers } from './job-handlers';
import { PgBossClient } from './pg-boss-client';

/**
 * Worker only: subscribes every discovered JobHandler to its pg-boss queue and registers the
 * cron schedules. A thrown error fails the attempt; pg-boss retries with backoff up to the
 * queue's retryLimit. Shutdown: PgBossClient stops gracefully, waiting for in-flight jobs.
 */
@Injectable()
export class JobRunner implements OnApplicationBootstrap {
  private readonly logger = new Logger('JobRunner');
  private readonly workers: string[] = [];

  constructor(
    private readonly client: PgBossClient,
    private readonly handlers: JobHandlers,
    private readonly metrics: Metrics,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    for (const handler of this.handlers.all()) {
      const boss = await this.client.ready(handler.job);
      const id = await boss.work<unknown>(
        handler.job.name,
        { batchSize: 1, pollingIntervalSeconds: 1 },
        async (jobs: Job<unknown>[]) => {
          for (const job of jobs) await this.run(handler, job);
        },
      );
      this.workers.push(id);
      if (handler.cron) {
        await boss.schedule(handler.job.name, handler.cron, {}, { tz: 'UTC' });
        this.logger.log(`scheduled ${handler.job.name} (${handler.cron} UTC)`);
      }
    }
    this.logger.log(`working ${this.workers.length} queue(s)`);
  }

  /** One attempt, with metrics and a log line; the payload is validated before the handler. */
  async run(handler: JobHandler, job: Pick<Job<unknown>, 'id' | 'data' | 'retryCount'>) {
    const queue = handler.job.name;
    const stop = this.metrics.jobDuration.startTimer({ queue });
    try {
      const data = handler.job.schema.parse(job.data);
      await handler.handle(data, { jobId: job.id, attempt: job.retryCount });
      this.metrics.jobsProcessed.inc({ queue, outcome: 'completed' });
    } catch (error) {
      this.metrics.jobsProcessed.inc({ queue, outcome: 'failed' });
      this.logger.error(
        `job ${queue} ${job.id} attempt ${job.retryCount} failed: ${safeErrorSummary(error)}`,
      );
      throw error;
    } finally {
      stop();
    }
  }
}
