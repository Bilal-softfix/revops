import { z } from 'zod';
import { emailSchema, nameSchema } from '../auth/schemas.js';
import { customFieldValuesInputSchema } from './custom-fields.js';
import { keySchema, stageCategorySchema } from './enums.js';
import { phoneSchema } from './phone.js';
import { PHONE_OR_EMAIL_MESSAGE } from './contacts.js';

// Leads API contracts (M1-T4): /v1/leads, /v1/leads/board, /v1/lead-views.

/** A lead's status mirrors its stage's category (open / won / lost); stored for filtering. */
export const leadStatusSchema = stageCategorySchema;
export type LeadStatus = z.infer<typeof leadStatusSchema>;

/** Paise (₹1 = 100) as a safe JSON integer; the DB column is bigint. */
export const paiseSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

/** UTM / click ids / Meta ids / landing page… (docs/02-data-model.md). Small flat object. */
export const attributionSchema = z
  .record(
    z.string().regex(/^[a-z][a-z0-9_]{0,49}$/),
    z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]),
  )
  .refine((obj) => Object.keys(obj).length <= 50, { message: 'too many attribution keys' });

const lostReasonSchema = z.string().trim().min(1).max(200);

/** New contact created together with the lead; an existing phone/email links to that contact. */
export const newLeadContactSchema = z
  .object({
    name: nameSchema,
    phone: phoneSchema.optional(),
    email: emailSchema.optional(),
  })
  .refine((c) => c.phone !== undefined || c.email !== undefined, {
    message: PHONE_OR_EMAIL_MESSAGE,
    path: ['phone'],
  });
export type NewLeadContact = z.infer<typeof newLeadContactSchema>;

export const createLeadRequestSchema = z
  .object({
    /** Exactly one of contactId (an existing contact you can see) or contact (new). */
    contactId: z.uuid().optional(),
    contact: newLeadContactSchema.optional(),
    /** Default: the tenant's default pipeline. */
    pipelineId: z.uuid().optional(),
    /** Default: the pipeline's first open stage. */
    stageId: z.uuid().optional(),
    /** Only `lead.assign` roles may set it; default the creator. null = unassigned. */
    ownerUserId: z.uuid().nullable().optional(),
    sourceId: z.uuid().nullable().optional(),
    valuePaise: paiseSchema.nullable().optional(),
    attribution: attributionSchema.optional(),
    /** Needed when the initial stage is a lost stage. */
    lostReason: lostReasonSchema.optional(),
    /** Validated against the lead fields that apply to the lead's pipeline. */
    customFields: customFieldValuesInputSchema.optional(),
  })
  .refine((b) => (b.contactId === undefined) !== (b.contact === undefined), {
    message: 'choose an existing contact or enter a new one',
    path: ['contact'],
  });
export type CreateLeadRequest = z.infer<typeof createLeadRequestSchema>;

/** Plain edits. Stage/pipeline moves go through POST /v1/leads/:id/stage (events, won/lost). */
export const updateLeadRequestSchema = z
  .strictObject({
    ownerUserId: z.uuid().nullable(),
    sourceId: z.uuid().nullable(),
    valuePaise: paiseSchema.nullable(),
    attribution: attributionSchema,
    /** Patch semantics; only fields of the lead's pipeline. */
    customFields: customFieldValuesInputSchema,
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'nothing to update' });
export type UpdateLeadRequest = z.infer<typeof updateLeadRequestSchema>;

/**
 * Stage change, optionally into another pipeline (`pipelineId`; the stage must belong to it).
 * Entering a lost stage needs `lostReason`. Emits `lead.stage_changed.v1`.
 */
export const changeLeadStageRequestSchema = z.object({
  pipelineId: z.uuid().optional(),
  stageId: z.uuid(),
  lostReason: lostReasonSchema.optional(),
});
export type ChangeLeadStageRequest = z.infer<typeof changeLeadStageRequestSchema>;

export const leadSchema = z.object({
  id: z.uuid(),
  contact: z.object({
    id: z.uuid(),
    name: z.string(),
    phoneE164: z.string().nullable(),
    email: z.string().nullable(),
  }),
  pipelineId: z.uuid(),
  stageId: z.uuid(),
  status: leadStatusSchema,
  owner: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  source: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  valuePaise: z.number().int().nullable(),
  currency: z.string(),
  attribution: z.record(z.string(), z.unknown()),
  /** Only values of active fields that apply to the lead's pipeline. */
  customFields: z.record(z.string(), z.unknown()),
  wonAt: z.iso.datetime().nullable(),
  lostAt: z.iso.datetime().nullable(),
  lostReason: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Lead = z.infer<typeof leadSchema>;

export const leadPageSchema = z.object({
  items: z.array(leadSchema),
  nextCursor: z.string().nullable(),
});
export type LeadPage = z.infer<typeof leadPageSchema>;

/**
 * Custom field filter, per field type: text → contains; select → any of; multiselect → has;
 * bool → equals; number/date → range (inclusive). Keys must be active lead fields.
 */
export const customFieldFilterValueSchema = z.union([
  z.string().trim().min(1).max(200),
  z.boolean(),
  z.array(z.string().min(1).max(100)).min(1).max(50),
  z
    .object({
      min: z.union([z.number(), z.iso.date()]).optional(),
      max: z.union([z.number(), z.iso.date()]).optional(),
    })
    .refine((r) => r.min !== undefined || r.max !== undefined, { message: 'give min or max' }),
]);
export type CustomFieldFilterValue = z.infer<typeof customFieldFilterValueSchema>;
export const customFieldFiltersSchema = z
  .record(keySchema, customFieldFilterValueSchema)
  .refine((obj) => Object.keys(obj).length <= 20, { message: 'too many field filters' });

/** Owner filter: a user id, `me`, or `unassigned` (read-all roles only). */
export const ownerFilterSchema = z.union([z.uuid(), z.literal('me'), z.literal('unassigned')]);

/** Lead filters: the list, the board and saved views share this shape. */
export const leadFiltersSchema = z.object({
  pipelineId: z.uuid().optional(),
  stageIds: z.array(z.uuid()).min(1).max(30).optional(),
  status: leadStatusSchema.optional(),
  owner: ownerFilterSchema.optional(),
  sourceId: z.uuid().optional(),
  /** Created on/after / before (ISO datetimes; the web sends tenant-timezone day bounds). */
  createdFrom: z.iso.datetime({ offset: true }).optional(),
  createdTo: z.iso.datetime({ offset: true }).optional(),
  /** Contact name, phone digits or email fragment. */
  q: z.string().trim().min(1).max(100).optional(),
  customFields: customFieldFiltersSchema.optional(),
});
export type LeadFilters = z.infer<typeof leadFiltersSchema>;

const csvIds = z
  .string()
  .transform((s) => s.split(',').filter(Boolean))
  .pipe(z.array(z.uuid()).min(1).max(30));
const jsonParam = z.string().transform((s, ctx) => {
  try {
    return JSON.parse(s) as unknown;
  } catch {
    ctx.addIssue({ code: 'custom', message: 'must be JSON' });
    return z.NEVER;
  }
});

/** Query string form of the filters: `stageIds=a,b` and `cf=<json>` (custom field filters). */
export const leadQuerySchema = z
  .object({
    pipelineId: z.uuid().optional(),
    stageIds: csvIds.optional(),
    status: leadStatusSchema.optional(),
    owner: ownerFilterSchema.optional(),
    sourceId: z.uuid().optional(),
    createdFrom: z.iso.datetime({ offset: true }).optional(),
    createdTo: z.iso.datetime({ offset: true }).optional(),
    q: z.string().trim().min(1).max(100).optional(),
    cf: jsonParam.pipe(customFieldFiltersSchema).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.uuid().optional(),
  })
  .transform(({ cf, limit, cursor, ...filters }) => ({
    filters: { ...filters, ...(cf ? { customFields: cf } : {}) },
    limit,
    cursor,
  }));
export type LeadQuery = z.infer<typeof leadQuerySchema>;

/** Same filters as the list, minus paging; `pipelineId` is required (one board per pipeline). */
export const leadBoardQuerySchema = z
  .object({
    pipelineId: z.uuid(),
    status: leadStatusSchema.optional(),
    owner: ownerFilterSchema.optional(),
    sourceId: z.uuid().optional(),
    createdFrom: z.iso.datetime({ offset: true }).optional(),
    createdTo: z.iso.datetime({ offset: true }).optional(),
    q: z.string().trim().min(1).max(100).optional(),
    cf: jsonParam.pipe(customFieldFiltersSchema).optional(),
    perStage: z.coerce.number().int().min(1).max(100).default(25),
  })
  .transform(({ cf, perStage, ...filters }) => ({
    filters: { ...filters, ...(cf ? { customFields: cf } : {}) },
    perStage,
  }));
export type LeadBoardQuery = z.infer<typeof leadBoardQuerySchema>;

export const leadBoardSchema = z.object({
  pipelineId: z.uuid(),
  columns: z.array(
    z.object({
      stageId: z.uuid(),
      /** All matching leads in the stage (the column shows the first `perStage`). */
      count: z.number().int(),
      items: z.array(leadSchema),
      /** Load more with GET /v1/leads?stageIds=<stageId>&cursor=… */
      nextCursor: z.string().nullable(),
    }),
  ),
});
export type LeadBoard = z.infer<typeof leadBoardSchema>;

// Saved views: private to the user who saved them.
export const LEAD_VIEW_LAYOUTS = ['list', 'board'] as const;
export const leadViewSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  layout: z.enum(LEAD_VIEW_LAYOUTS),
  filters: leadFiltersSchema,
  createdAt: z.iso.datetime(),
});
export type LeadView = z.infer<typeof leadViewSchema>;
export const leadViewListSchema = z.object({ items: z.array(leadViewSchema) });
export type LeadViewList = z.infer<typeof leadViewListSchema>;
export const createLeadViewRequestSchema = z.object({
  name: z.string().trim().min(1).max(60),
  layout: z.enum(LEAD_VIEW_LAYOUTS).default('list'),
  filters: leadFiltersSchema,
});
export type CreateLeadViewRequest = z.infer<typeof createLeadViewRequestSchema>;

/** Query-string encoding of filters (web → list/board endpoints). Inverse of leadQuerySchema. */
export function leadFiltersToParams(filters: LeadFilters): URLSearchParams {
  const params = new URLSearchParams();
  const { customFields, stageIds, ...scalars } = filters;
  for (const [key, value] of Object.entries(scalars)) {
    if (value !== undefined) params.set(key, value);
  }
  if (stageIds?.length) params.set('stageIds', stageIds.join(','));
  if (customFields && Object.keys(customFields).length > 0) {
    params.set('cf', JSON.stringify(customFields));
  }
  return params;
}
