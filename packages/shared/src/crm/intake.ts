import { z } from 'zod';

// Inbound lead intake (M2-T4): the one shape every capture channel (public form M2-T2, webhook
// M2-T3, CSV M2-T5) maps its payload to before LeadIntakeService dedupes and stores it.
// Everything here is hostile input: lengths are capped, URLs must be http(s), keys are plain.

const capped = (max: number) => z.string().trim().max(max);

const httpUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((value) => {
    try {
      const { protocol } = new URL(value);
      return protocol === 'https:' || protocol === 'http:';
    } catch {
      return false;
    }
  }, 'must be an http(s) URL');

/** Marketing attribution stored on the lead (`leads.attribution`). Unknown keys are dropped. */
export const inboundAttributionSchema = z.object({
  utm_source: capped(200).optional(),
  utm_medium: capped(200).optional(),
  utm_campaign: capped(200).optional(),
  utm_term: capped(200).optional(),
  utm_content: capped(200).optional(),
  gclid: capped(300).optional(),
  fbclid: capped(300).optional(),
  landing_url: httpUrl.optional(),
  referrer: httpUrl.optional(),
});
export type InboundAttribution = z.infer<typeof inboundAttributionSchema>;

const leadFieldKey = z.string().regex(/^[a-z][a-z0-9_]{0,49}$/);
const leadFieldValue = z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]);

/**
 * Raw contact data as received: the intake normalises the phone to E.164 and the email to lower
 * case, and needs at least one of them that is valid.
 */
export const intakeLeadInputSchema = z.object({
  name: capped(200).optional(),
  phone: capped(40).optional(),
  email: capped(254).optional(),
  city: capped(100).optional(),
  /** Lead custom field values by key; invalid ones are dropped and reported, not fatal. */
  leadFields: z
    .record(leadFieldKey, leadFieldValue)
    .refine((v) => Object.keys(v).length <= 50, 'at most 50 fields')
    .optional(),
  attribution: inboundAttributionSchema.optional(),
});
export type IntakeLeadInput = z.infer<typeof intakeLeadInputSchema>;

export const INTAKE_OUTCOMES = ['created', 'reenquiry', 'duplicate'] as const;
export type IntakeOutcome = (typeof INTAKE_OUTCOMES)[number];

// ---- manual contact merge (M2-T4) ----

/** Which contact's value survives, per field: `this` = the contact in the URL (it survives). */
export const mergePickSchema = z.enum(['this', 'other']);
export type MergePick = z.infer<typeof mergePickSchema>;

export const mergeContactsRequestSchema = z.strictObject({
  /** The contact merged INTO the one in the URL; it is soft-deleted afterwards. */
  otherContactId: z.uuid(),
  /** Omitted fields keep this contact's value (or the other's when this one is empty). */
  pick: z
    .strictObject({
      name: mergePickSchema.optional(),
      phone: mergePickSchema.optional(),
      email: mergePickSchema.optional(),
      city: mergePickSchema.optional(),
    })
    .default({}),
  /** Per contact custom field key; same default rule. */
  customFields: z.record(leadFieldKey, mergePickSchema).default({}),
});
export type MergeContactsRequest = z.infer<typeof mergeContactsRequestSchema>;
