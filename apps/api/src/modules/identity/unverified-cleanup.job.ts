import { Injectable, Logger } from '@nestjs/common';
import { IdentityRepository } from './identity.repository';

/**
 * Deletes unverified accounts (and the tenants only they belong to) older than 48 h — see
 * auth_unverified_cutoff() in migration 0005. Login, verify, resend and forgot-password already
 * treat them as non-existent; this just removes the rows.
 *
 * Stub until M0-T6: the worker will schedule `run()` hourly as a BullMQ repeatable job.
 */
@Injectable()
export class UnverifiedAccountCleanupJob {
  static readonly NAME = 'identity.purge-expired-unverified';
  private readonly logger = new Logger('UnverifiedAccountCleanup');

  constructor(private readonly repository: IdentityRepository) {}

  async run(): Promise<number> {
    const removed = await this.repository.purgeExpiredUnverified();
    if (removed > 0) this.logger.log(`removed ${removed} expired unverified account(s)`);
    return removed;
  }
}
