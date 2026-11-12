import { Injectable, Logger } from '@nestjs/common';
import { EMPTY_PAYLOAD, type EmptyPayload, JobHandler, defineJob } from '../../platform/queue/job';
import { IdentityRepository } from './identity.repository';

/**
 * Deletes unverified accounts (and the tenants only they belong to) older than 48 h — see
 * auth_unverified_cutoff() in migration 0005. Login, verify, resend and forgot-password already
 * treat them as non-existent; this just removes the rows. Hourly, on the worker (pg-boss cron).
 */
@Injectable()
export class UnverifiedAccountCleanupJob extends JobHandler<EmptyPayload> {
  static readonly NAME = 'identity.purge-expired-unverified';
  readonly job = defineJob(UnverifiedAccountCleanupJob.NAME, EMPTY_PAYLOAD, { retryLimit: 1 });
  override readonly cron = '15 * * * *';
  private readonly logger = new Logger('UnverifiedAccountCleanup');

  constructor(private readonly repository: IdentityRepository) {
    super();
  }

  handle(): Promise<void> {
    return this.run().then(() => undefined);
  }

  async run(): Promise<number> {
    const removed = await this.repository.purgeExpiredUnverified();
    if (removed > 0) this.logger.log(`removed ${removed} expired unverified account(s)`);
    return removed;
  }
}
