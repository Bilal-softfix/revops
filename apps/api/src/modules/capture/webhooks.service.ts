import { Injectable, Logger } from '@nestjs/common';
import {
  PUBLIC_KEY_PATTERN,
  type RejectedDeliveryList,
  type WebhookAccepted,
  leadSourceConfigSchema,
  webhookLeadPayloadSchema,
} from '@revops/shared';
import type { Tx } from '@revops/db';
import { z } from 'zod';
import { Clock } from '../../platform/clock';
import { SecretBox } from '../../platform/crypto/secret-box';
import { Database } from '../../platform/database/database';
import { DomainError } from '../../platform/errors/domain-error';
import {
  EMPTY_PAYLOAD,
  type EmptyPayload,
  type JobContext,
  JobHandler,
  defineJob,
} from '../../platform/queue/job';
import { JobQueue } from '../../platform/queue/job-queue';
import { RateLimiter } from '../../platform/rate-limit/rate-limiter';
import { LeadIntakeService, webhookSecretContext } from '../crm';
import { CaptureRepository } from './capture.repository';
import { toIntakeInput } from './mapping';
import {
  type SignatureCheck,
  type TokenCheck,
  verifyWebhookSignature,
  verifyWebhookToken,
} from './webhook-signature';

const MINUTE = 60 * 1000;

/**
 * Ceilings for the webhook endpoint (M2-T3): per IP before any lookup, and per source for every
 * delivery — valid or not — so a leaked URL can't fill the table with rejected rows.
 */
export const WEBHOOK_LIMITS = {
  ip: { limit: 120, windowMs: MINUTE },
  source: { limit: 600, windowMs: 60 * MINUTE },
} as const;

/** Raw deliveries are kept this long (PII retention), then purged. */
export const WEBHOOK_RETENTION_DAYS = 30;

/**
 * Rejected (unauthenticated) deliveries (M2-T3 review): kept 7 days, at most the first 16 KB of
 * the body, and at most `perSourcePerHour` stored per source — the rest are answered 401 unstored.
 */
export const REJECTED_WEBHOOKS = {
  retentionDays: 7,
  maxBytes: 16 * 1024,
  perSourcePerHour: 20,
} as const;

/** Unreadable (non-JSON) authenticated bodies: same text cap. */
const RAW_KEEP = REJECTED_WEBHOOKS.maxBytes;
const DAY = 24 * 3600_000;
const REJECTED_LIST_LIMIT = 50;

export const WEBHOOK_PROCESS_JOB = defineJob(
  'capture.webhook-process',
  z.object({ tenantId: z.uuid(), webhookId: z.uuid() }),
  { retryLimit: 3 },
);

const notFound = () => new DomainError('not_found', 404, 'Not found');

/** Short machine codes stored in `inbound_webhooks.error` (never values). */
const signatureFailure = (check: SignatureCheck) => (check === 'ok' ? null : `signature_${check}`);
const tokenFailure = (check: TokenCheck) => (check === 'ok' ? null : `token_${check}`);

/** The first 16 KB of the body as text, never parsed (rejected and non-JSON deliveries). */
function rawExcerpt(raw: Buffer | undefined): { raw: string; truncated: boolean } {
  const bytes = raw ?? Buffer.alloc(0);
  return {
    raw: bytes.subarray(0, RAW_KEEP).toString('utf8'),
    truncated: bytes.length > RAW_KEEP,
  };
}

/** What an authenticated body is stored as: the object, or its excerpt (never logged). */
function storable(body: unknown, raw: Buffer | undefined): Record<string, unknown> {
  if (body !== null && typeof body === 'object' && !Array.isArray(body)) {
    return body as Record<string, unknown>;
  }
  return rawExcerpt(raw);
}

/**
 * Signed generic webhook (M2-T3; CLAUDE.md rule 5): verify the signature, persist the raw delivery
 * to `inbound_webhooks` (bad signatures too, as rejected), answer fast, process in a job.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly repository: CaptureRepository,
    private readonly database: Database,
    private readonly limiter: RateLimiter,
    private readonly secrets: SecretBox,
    private readonly jobs: JobQueue,
    private readonly clock: Clock,
  ) {}

  private async limit(key: string, rule: { limit: number; windowMs: number }): Promise<void> {
    const retryAfter = await this.limiter.consume(key, rule.limit, rule.windowMs);
    if (retryAfter > 0) {
      throw new DomainError('rate_limited', 429, 'Too many requests — try again later', {
        headers: { 'Retry-After': String(retryAfter) },
      });
    }
  }

  async receive(input: {
    publicKey: string;
    signature: string | undefined;
    token: string | undefined;
    rawBody: Buffer | undefined;
    body: unknown;
    ip: string | null;
  }): Promise<WebhookAccepted> {
    await this.limit(`public-webhook-ip:${input.ip ?? 'unknown'}`, WEBHOOK_LIMITS.ip);
    if (!PUBLIC_KEY_PATTERN.test(input.publicKey)) throw notFound();
    const source = await this.repository.resolveWebhookSource(input.publicKey);
    if (!source) throw notFound();
    await this.limit(`public-webhook-source:${source.sourceId}`, WEBHOOK_LIMITS.source);

    const secret = this.secrets.decrypt(
      source.secretEnc,
      webhookSecretContext(source.tenantId, source.sourceId),
    );
    const now = this.clock.now();
    const { webhookAuth } = leadSourceConfigSchema.parse(source.config ?? {});
    const failure =
      webhookAuth === 'token'
        ? tokenFailure(verifyWebhookToken(input.token, secret))
        : signatureFailure(
            verifyWebhookSignature(
              input.signature,
              secret,
              input.rawBody ?? Buffer.alloc(0),
              Math.floor(now.getTime() / 1000),
            ),
          );
    const tenant = { tenantId: source.tenantId };

    if (failure) {
      // Stored for debugging, but capped: an unauthenticated sender must not fill the table.
      const overCap = await this.limiter.consume(
        `public-webhook-rejected-store:${source.sourceId}`,
        REJECTED_WEBHOOKS.perSourcePerHour,
        60 * MINUTE,
      );
      if (overCap === 0) {
        await this.database.withContext(tenant, (tx) =>
          this.repository.insertWebhook(tx, {
            tenantId: source.tenantId,
            sourceId: source.sourceId,
            externalEventId: null,
            signatureValid: false,
            payload: rawExcerpt(input.rawBody),
            status: 'rejected',
            error: failure,
            receivedAt: now,
          }),
        );
      }
      this.logger.warn(`webhook rejected (source ${source.sourceId}): ${failure}`);
      throw webhookAuth === 'token'
        ? new DomainError('invalid_token', 401, 'Invalid or missing webhook token')
        : new DomainError('invalid_signature', 401, 'Invalid or missing webhook signature');
    }

    const parsed = webhookLeadPayloadSchema.safeParse(input.body);
    if (!parsed.success) {
      const id = (input.body as { id?: unknown } | undefined)?.id;
      const externalEventId =
        typeof id === 'string' && id.trim().length > 0 && id.length <= 200 ? id.trim() : null;
      await this.database.withContext(tenant, (tx) =>
        this.repository.insertWebhook(tx, {
          tenantId: source.tenantId,
          sourceId: source.sourceId,
          externalEventId,
          signatureValid: true,
          payload: storable(input.body, input.rawBody),
          status: 'failed',
          error: 'invalid_payload',
          receivedAt: now,
          processedAt: now,
        }),
      );
      throw new DomainError('validation_failed', 400, 'Invalid webhook payload', {
        extensions: {
          errors: parsed.error.issues.map((i) => ({
            path: i.path.map(String).join('.'),
            message: i.message,
          })),
        },
      });
    }

    return this.database.withContext(tenant, async (tx) => {
      const row = await this.repository.insertWebhook(tx, {
        tenantId: source.tenantId,
        sourceId: source.sourceId,
        externalEventId: parsed.data.id,
        signatureValid: true,
        payload: input.body as Record<string, unknown>,
        status: 'received',
        receivedAt: now,
      });
      if (!row) return { ok: true as const, duplicate: true };
      await this.jobs.send(
        WEBHOOK_PROCESS_JOB,
        { tenantId: source.tenantId, webhookId: row.id },
        { id: row.id, tx },
      );
      return { ok: true as const, duplicate: false };
    });
  }
}

/** Recent rejected deliveries of one source, for owners/admins (`source.manage`). */
@Injectable()
export class RejectedWebhooksReader {
  constructor(private readonly repository: CaptureRepository) {}

  async list(tx: Tx, sourceId: string): Promise<RejectedDeliveryList> {
    const rows = await this.repository.listRejectedWebhooks(tx, sourceId, REJECTED_LIST_LIMIT);
    return {
      items: rows.map((row) => ({
        id: row.id,
        receivedAt: row.receivedAt.toISOString(),
        reason: row.error ?? 'rejected',
        raw: typeof row.payload.raw === 'string' ? row.payload.raw : JSON.stringify(row.payload),
        truncated: row.payload.truncated === true,
      })),
    };
  }
}

/**
 * Processes one received delivery (M2-T3): maps it like a form submission and hands it to the
 * intake (idempotency key `webhook:<source>:<external id>`). Idempotent: only `received` rows
 * are processed, under a row lock. A payload without a usable phone/email ends as `failed`
 * (no retry); other errors are retried by the queue.
 */
@Injectable()
export class WebhookProcessJob extends JobHandler<z.infer<typeof WEBHOOK_PROCESS_JOB.schema>> {
  readonly job = WEBHOOK_PROCESS_JOB;

  constructor(
    private readonly repository: CaptureRepository,
    private readonly database: Database,
    private readonly intake: LeadIntakeService,
    private readonly clock: Clock,
  ) {
    super();
  }

  async handle(data: { tenantId: string; webhookId: string }, _context: JobContext): Promise<void> {
    await this.database.withContext({ tenantId: data.tenantId }, async (tx) => {
      const row = await this.repository.lockReceivedWebhook(tx, data.webhookId);
      if (!row) return; // already processed (or not ours)
      const now = this.clock.now();
      const payload = webhookLeadPayloadSchema.parse(row.payload);
      const source = await this.repository.sourceForProcessing(tx, row.sourceId);
      const config = leadSourceConfigSchema.parse(source?.config ?? {});
      const input = toIntakeInput(
        {
          ...(payload.fields ?? {}),
          ...(payload.name !== undefined ? { name: payload.name } : {}),
          ...(payload.phone !== undefined ? { phone: payload.phone } : {}),
          ...(payload.email !== undefined ? { email: payload.email } : {}),
          ...(payload.city !== undefined ? { city: payload.city } : {}),
        },
        payload.attribution,
        config,
      );
      try {
        // Savepoint: an unusable payload must not abort the outer transaction that records it.
        const result = await tx.transaction((sp) =>
          this.intake.ingest(sp, {
            tenantId: data.tenantId,
            source: { id: row.sourceId, name: source?.name ?? '', config },
            idempotencyKey: `webhook:${row.sourceId}:${payload.id}`,
            input,
          }),
        );
        await this.repository.finishWebhook(tx, row.id, {
          status: 'processed',
          leadId: result.leadId,
          at: now,
        });
      } catch (error) {
        if (!(error instanceof DomainError) || error.code !== 'intake_unusable') throw error;
        await this.repository.finishWebhook(tx, row.id, {
          status: 'failed',
          error: 'intake_unusable',
          at: now,
        });
      }
    });
  }
}

/** Deletes deliveries past retention (30 days; rejected: 7), daily at 03:15 UTC. */
@Injectable()
export class WebhookPurgeJob extends JobHandler<EmptyPayload> {
  readonly job = defineJob('capture.webhook-purge', EMPTY_PAYLOAD, { retryLimit: 1 });
  override readonly cron = '15 3 * * *';
  private readonly logger = new Logger('WebhookPurge');

  constructor(
    private readonly repository: CaptureRepository,
    private readonly clock: Clock,
  ) {
    super();
  }

  async handle(): Promise<void> {
    const now = this.clock.now().getTime();
    const removed = await this.repository.purgeWebhooks(
      new Date(now - WEBHOOK_RETENTION_DAYS * DAY),
      new Date(now - REJECTED_WEBHOOKS.retentionDays * DAY),
    );
    if (removed > 0) this.logger.log(`purged ${removed} webhook deliveries`);
  }
}
