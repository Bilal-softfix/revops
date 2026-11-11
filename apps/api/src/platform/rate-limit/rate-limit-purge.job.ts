import { Injectable, Logger } from '@nestjs/common';
import { EMPTY_PAYLOAD, type EmptyPayload, JobHandler, defineJob } from '../queue/job';
import { RateLimiter } from './rate-limiter';

/** Deletes rate-limit buckets whose window has ended (rate_limit_purge), every 10 minutes. */
@Injectable()
export class RateLimitPurgeJob extends JobHandler<EmptyPayload> {
  readonly job = defineJob('platform.rate-limit-purge', EMPTY_PAYLOAD, { retryLimit: 1 });
  override readonly cron = '*/10 * * * *';
  private readonly logger = new Logger('RateLimitPurge');

  constructor(private readonly rateLimiter: RateLimiter) {
    super();
  }

  async handle(): Promise<void> {
    const removed = await this.rateLimiter.purgeExpired();
    if (removed > 0) this.logger.debug(`purged ${removed} expired bucket(s)`);
  }
}
