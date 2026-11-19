import { Injectable } from '@nestjs/common';
import { DomainError } from '../../platform/errors/domain-error';
import { RateLimiter } from '../../platform/rate-limit/rate-limiter';
import type { CrmAuth } from './crm.service';

const HOUR = 60 * 60 * 1000;

/**
 * Per-user, per-tenant ceilings on authenticated CRM writes (M2-T0). Sized for normal team use —
 * a busy agent enters a few dozen leads an hour — while bounding scripted abuse: the duplicate
 * check on create is a phone/email existence oracle, and bulk/export are heavy.
 * Contact create and lead create share one bucket (both can create a contact).
 */
export const CRM_RATE_LIMITS = {
  create: { limit: 300, windowMs: HOUR },
  bulk: { limit: 60, windowMs: HOUR },
  export: { limit: 30, windowMs: HOUR },
} as const;

export type CrmRateLimitBucket = keyof typeof CRM_RATE_LIMITS;

@Injectable()
export class CrmRateLimits {
  constructor(private readonly limiter: RateLimiter) {}

  /** Counts one attempt (refused ones too); throws 429 `rate_limited` with Retry-After. */
  async consume(auth: CrmAuth, bucket: CrmRateLimitBucket): Promise<void> {
    const { limit, windowMs } = CRM_RATE_LIMITS[bucket];
    const retryAfter = await this.limiter.consume(
      `crm-${bucket}:${auth.tenantId}:${auth.userId}`,
      limit,
      windowMs,
    );
    if (retryAfter > 0) {
      throw new DomainError('rate_limited', 429, 'Too many requests — try again later', {
        headers: { 'Retry-After': String(retryAfter) },
      });
    }
  }
}
