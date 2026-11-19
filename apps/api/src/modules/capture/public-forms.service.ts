import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  type LeadSourceConfig,
  PUBLIC_KEY_PATTERN,
  leadSourceConfigSchema,
  publicFormSubmissionSchema,
} from '@revops/shared';
import { Database } from '../../platform/database/database';
import { DomainError } from '../../platform/errors/domain-error';
import { RateLimiter } from '../../platform/rate-limit/rate-limiter';
import { CaptchaVerifier } from '../../providers/captcha';
import { LeadIntakeService } from '../crm';
import { CaptureRepository, type ResolvedSource } from './capture.repository';
import { toIntakeInput } from './mapping';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/**
 * Ceilings for the unauthenticated form endpoint (M2-T2). Per IP before any lookup (cheap reject
 * of floods), per source per hour and per tenant per day (bounds what one leaked key can do).
 */
export const PUBLIC_FORM_LIMITS = {
  ip: { limit: 30, windowMs: 10 * MINUTE },
  source: { limit: 300, windowMs: HOUR },
  tenant: { limit: 5000, windowMs: 24 * HOUR },
} as const;

/** A human needs more than this to fill a form; faster posts are treated like the honeypot. */
export const MIN_FILL_MS = 1500;

const notFound = () => new DomainError('not_found', 404, 'Not found');
const rateLimited = (retryAfter: number) =>
  new DomainError('rate_limited', 429, 'Too many submissions — try again later', {
    headers: { 'Retry-After': String(retryAfter) },
  });

export type FormOutcome = 'accepted' | 'spam';

export interface ResolvedForm {
  source: ResolvedSource;
  config: LeadSourceConfig;
}

/**
 * Public web form intake (M2-T2). Hostile input throughout: the tenant comes only from the
 * unguessable public key, the browser origin must be on the source's allow-list, payloads are
 * capped and validated, and the response never says whether the person was already known.
 */
@Injectable()
export class PublicFormsService {
  private readonly logger = new Logger(PublicFormsService.name);

  constructor(
    private readonly repository: CaptureRepository,
    private readonly database: Database,
    private readonly limiter: RateLimiter,
    private readonly captcha: CaptchaVerifier,
    private readonly intake: LeadIntakeService,
  ) {}

  private async limit(key: string, rule: { limit: number; windowMs: number }): Promise<void> {
    const retryAfter = await this.limiter.consume(key, rule.limit, rule.windowMs);
    if (retryAfter > 0) throw rateLimited(retryAfter);
  }

  /** IP limit, then the source behind `publicKey` (web forms only). 404 for anything else. */
  async resolve(publicKey: string, ip: string | null): Promise<ResolvedForm> {
    await this.limit(`public-form-ip:${ip ?? 'unknown'}`, PUBLIC_FORM_LIMITS.ip);
    if (!PUBLIC_KEY_PATTERN.test(publicKey)) throw notFound();
    const source = await this.repository.resolveSource(publicKey);
    if (source?.type !== 'web_form') throw notFound();
    const config = leadSourceConfigSchema.safeParse(source.config);
    if (!config.success) throw notFound();
    return { source, config: config.data };
  }

  /** Exact match against the source's allow-list (configs store normalised origins). */
  originAllowed(form: ResolvedForm, origin: string | undefined): origin is string {
    return origin !== undefined && form.config.allowedOrigins.includes(origin.toLowerCase());
  }

  async submit(form: ResolvedForm, body: unknown, ip: string | null): Promise<FormOutcome> {
    const parsed = publicFormSubmissionSchema.safeParse(body);
    if (!parsed.success) {
      throw new DomainError('validation_failed', 400, 'Invalid submission');
    }
    const submission = parsed.data;
    const { source, config } = form;
    await this.limit(`public-form-source:${source.sourceId}`, PUBLIC_FORM_LIMITS.source);
    await this.limit(`public-form-tenant:${source.tenantId}`, PUBLIC_FORM_LIMITS.tenant);

    // Honeypot filled or posted faster than a person can type: accept silently, store nothing.
    if ((submission._hp ?? '').trim() !== '' || (submission._ts ?? MIN_FILL_MS) < MIN_FILL_MS) {
      this.logger.log(`public form spam dropped (source ${source.sourceId})`);
      return 'spam';
    }
    if (config.captcha) {
      const token = submission._captcha;
      if (!token || !(await this.captcha.verify(token, ip))) {
        throw new DomainError('captcha_failed', 400, 'Please complete the captcha and try again');
      }
    }

    const input = toIntakeInput(submission.fields, submission.attribution, config);
    await this.database.withContext({ tenantId: source.tenantId }, (tx) =>
      this.intake.ingest(tx, {
        tenantId: source.tenantId,
        source: { id: source.sourceId, name: source.name, config },
        idempotencyKey: `form:${source.sourceId}:${submission.submissionId ?? randomUUID()}`,
        input,
      }),
    );
    return 'accepted';
  }
}
