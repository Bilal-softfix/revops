import { z } from 'zod';
import { KEY_PATTERN, leadSourceTypeSchema } from './enums.js';

// Lead sources (M2-T1): where leads come from, plus the per-source capture config that the
// public form (M2-T2), webhook (M2-T3) and CSV import (M2-T5) use.

export const ASSIGNMENT_STRATEGIES = ['round_robin', 'user', 'unassigned'] as const;
export type AssignmentStrategy = (typeof ASSIGNMENT_STRATEGIES)[number];

/** Built-in contact fields an inbound field can map to; `lead.<key>` maps to a lead custom field. */
export const MAPPING_BUILTINS = ['name', 'phone', 'email', 'city'] as const;
const LEAD_FIELD_TARGET = new RegExp(`^lead\\.${KEY_PATTERN.source.slice(1, -1)}$`);
export const mappingTargetSchema = z.union([
  z.enum(MAPPING_BUILTINS),
  z.string().regex(LEAD_FIELD_TARGET, 'use name, phone, email, city or lead.<field_key>'),
]);
export type MappingTarget = z.infer<typeof mappingTargetSchema>;

/** Inbound (form/webhook/CSV) field names: plain identifiers, no paths or prototype keys. */
const INBOUND_FIELD = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
export const MAX_MAPPED_FIELDS = 50;
export const MAX_ALLOWED_ORIGINS = 20;

/** An exact web origin: http(s)://host[:port], no path, query or credentials. */
export const originSchema = z
  .string()
  .trim()
  .max(200)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        (url.protocol === 'https:' || url.protocol === 'http:') &&
        url.pathname === '/' &&
        !url.search &&
        !url.hash &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  }, 'use an origin like https://www.example.com (no path)')
  // Lower-case host, default port dropped: exactly what browsers send in `Origin`.
  .transform((value) => new URL(value).origin);

export const assignmentConfigSchema = z.discriminatedUnion('strategy', [
  z.strictObject({ strategy: z.literal('round_robin') }),
  z.strictObject({ strategy: z.literal('user'), userId: z.uuid() }),
  z.strictObject({ strategy: z.literal('unassigned') }),
]);
export type AssignmentConfig = z.infer<typeof assignmentConfigSchema>;

/**
 * How webhook deliveries to an API source authenticate (M2-T3). `hmac` (default): signed
 * `X-RevOps-Signature`. `token`: the secret itself in `X-Webhook-Token` — for no-code tools
 * (Zapier, Make) that can't sign; less secure (no replay window, the secret travels each time).
 */
export const WEBHOOK_AUTH_MODES = ['hmac', 'token'] as const;
export type WebhookAuthMode = (typeof WEBHOOK_AUTH_MODES)[number];

export const leadSourceConfigSchema = z.strictObject({
  /** Browser origins allowed to post the public form (CORS). Empty = no browser posts. */
  allowedOrigins: z
    .array(originSchema)
    .max(MAX_ALLOWED_ORIGINS)
    .default([])
    .transform((list) => [...new Set(list)]),
  /** Require a captcha token on public form posts. */
  captcha: z.boolean().default(false),
  /** Inbound field name → where it goes. */
  fieldMapping: z
    .record(
      z
        .string()
        .regex(INBOUND_FIELD, 'field names: letters, digits, _ . -')
        .refine((k) => !FORBIDDEN_KEYS.has(k), 'reserved name'),
      mappingTargetSchema,
    )
    .refine((m) => Object.keys(m).length <= MAX_MAPPED_FIELDS, {
      message: `at most ${MAX_MAPPED_FIELDS} mapped fields`,
    })
    .default({}),
  /** Where new leads land; null = the tenant's default pipeline and its first open stage. */
  pipelineId: z.uuid().nullable().default(null),
  stageId: z.uuid().nullable().default(null),
  /** Owner of new leads from this source (M2-T6). */
  assignment: assignmentConfigSchema.default({ strategy: 'round_robin' }),
  /** API sources: webhook authentication (M2-T3). */
  webhookAuth: z.enum(WEBHOOK_AUTH_MODES).default('hmac'),
});
export type LeadSourceConfig = z.infer<typeof leadSourceConfigSchema>;
export type LeadSourceConfigInput = z.input<typeof leadSourceConfigSchema>;

/** Public keys: 32 random bytes, base64url (43 chars). Backfilled rows: 64 hex chars. */
export const PUBLIC_KEY_PATTERN = /^[A-Za-z0-9_-]{32,64}$/;

export const leadSourceSchema = z.object({
  id: z.uuid(),
  key: z.string().nullable(),
  name: z.string(),
  type: leadSourceTypeSchema,
  isActive: z.boolean(),
  publicKey: z.string(),
  config: leadSourceConfigSchema,
  /** Only `api` sources have a webhook secret; it is shown once, on create or rotate. */
  hasWebhookSecret: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type LeadSource = z.infer<typeof leadSourceSchema>;
export const leadSourceListSchema = z.object({ items: z.array(leadSourceSchema) });
export type LeadSourceList = z.infer<typeof leadSourceListSchema>;

/** Create / rotate-secret response: the plaintext secret appears here and nowhere else. */
export const leadSourceWithSecretSchema = z.object({
  source: leadSourceSchema,
  webhookSecret: z.string().optional(),
});
export type LeadSourceWithSecret = z.infer<typeof leadSourceWithSecretSchema>;

const sourceName = z.string().trim().min(1, 'required').max(80);

export const createLeadSourceRequestSchema = z.strictObject({
  name: sourceName,
  type: leadSourceTypeSchema,
  config: leadSourceConfigSchema.optional(),
});
export type CreateLeadSourceRequest = z.infer<typeof createLeadSourceRequestSchema>;

/** `config` replaces the whole config (the settings form always sends all of it). */
export const updateLeadSourceRequestSchema = z
  .strictObject({
    name: sourceName.optional(),
    isActive: z.boolean().optional(),
    config: leadSourceConfigSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'nothing to update' });
export type UpdateLeadSourceRequest = z.infer<typeof updateLeadSourceRequestSchema>;
