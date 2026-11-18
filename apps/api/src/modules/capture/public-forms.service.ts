import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  type IntakeLeadInput,
  type LeadSourceConfig,
  MAPPING_BUILTINS,
  PUBLIC_KEY_PATTERN,
  type PublicFormSubmission,
  inboundAttributionSchema,
  leadSourceConfigSchema,
  publicFormSubmissionSchema,
} from '@revops/shared';
import { Database } from '../../platform/database/database';
import { DomainError } from '../../platform/errors/domain-error';
import { RateLimiter } from '../../platform/rate-limit/rate-limiter';
import { CaptchaVerifier } from '../../providers/captcha';
import { LeadIntakeService } from '../crm';
import { CaptureRepository, type ResolvedSource } from './capture.repository';

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

/** Field names the snippet maps without configuration (common form `name` attributes). */
const DEFAULT_MAPPING: Record<string, (typeof MAPPING_BUILTINS)[number]> = {
  name: 'name',
  full_name: 'name',
  fullname: 'name',
  phone: 'phone',
  mobile: 'phone',
  tel: 'phone',
  email: 'email',
  city: 'city',
};

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

    const input = this.map(submission, config);
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

  /** Form fields → intake input via the source's mapping (unmapped fields are ignored). */
  map(submission: PublicFormSubmission, config: LeadSourceConfig): IntakeLeadInput {
    const input: IntakeLeadInput = {};
    const leadFields: Record<string, string | number | boolean | null> = {};
    for (const [field, value] of Object.entries(submission.fields)) {
      const target = config.fieldMapping[field] ?? DEFAULT_MAPPING[field.toLowerCase()];
      if (!target || value === null) continue;
      if (target.startsWith('lead.')) {
        leadFields[target.slice(5)] = value;
        continue;
      }
      const text = String(value).trim();
      if (text === '') continue;
      const builtin = target as (typeof MAPPING_BUILTINS)[number];
      const cap = { name: 200, phone: 40, email: 254, city: 100 }[builtin];
      input[builtin] = text.slice(0, cap);
    }
    if (Object.keys(leadFields).length > 0) input.leadFields = leadFields;
    const attribution = sanitizeAttribution(submission.attribution);
    if (Object.keys(attribution).length > 0) input.attribution = attribution;
    return input;
  }
}

/** Keeps only known attribution keys whose value is valid; anything else is silently dropped. */
export function sanitizeAttribution(raw: Record<string, unknown> | undefined) {
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const [key, schema] of Object.entries(inboundAttributionSchema.shape)) {
    const value = raw[key];
    if (typeof value !== 'string' || value.trim() === '') continue;
    const parsed = schema.safeParse(value);
    if (parsed.success && typeof parsed.data === 'string') out[key] = parsed.data;
  }
  return out;
}
