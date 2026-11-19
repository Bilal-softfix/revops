import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { timestamps, id } from './columns.js';
import { contacts } from './contacts.js';
import { stageCategory } from './enums.js';
import { leadSources, pipelineStages } from './crm-setup.js';
import { tenants } from './tenants.js';
import { users } from './users.js';

/**
 * Leads (docs/02-data-model.md). The table arrives in M1-T3b because deleting a stage must move
 * its leads; the leads API, list/kanban and stage-change events come in M1-T4 (which may add
 * columns such as status / first_response_at / qualified_at).
 *
 * References are composite (tenant_id, …) FKs: a lead can't point at another tenant's contact,
 * stage or source, and (tenant_id, pipeline_id, stage_id) → pipeline_stages guarantees the stage
 * belongs to the lead's pipeline. Stages can't be deleted while leads reference them (NO ACTION).
 */
export const leads = pgTable(
  'leads',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id').notNull(),
    pipelineId: uuid('pipeline_id').notNull(),
    stageId: uuid('stage_id').notNull(),
    /** Mirrors the stage's category (open/won/lost), kept in sync by the leads service (M1-T4). */
    status: stageCategory('status').notNull().default('open'),
    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
    sourceId: uuid('source_id'),
    /** Paise (₹1 = 100). */
    valuePaise: bigint('value_paise', { mode: 'bigint' }),
    currency: text('currency').notNull().default('INR'),
    attribution: jsonb('attribution').$type<Record<string, unknown>>().notNull().default({}),
    /** Values of lead custom fields; only the fields that apply to the pipeline are shown. */
    customFields: jsonb('custom_fields').$type<Record<string, unknown>>().notNull().default({}),
    wonAt: timestamp('won_at', { withTimezone: true }),
    lostAt: timestamp('lost_at', { withTimezone: true }),
    lostReason: text('lost_reason'),
    /**
     * M2-T6: when a person first acted on the lead (stage change now; outbound call/message from
     * M3/M5). Set once, never by the system or AI. Response time = first_response_at - created_at.
     */
    firstResponseAt: timestamp('first_response_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    unique('leads_tenant_id_id_unique').on(t.tenantId, t.id),
    foreignKey({
      name: 'leads_contact_fk',
      columns: [t.tenantId, t.contactId],
      foreignColumns: [contacts.tenantId, contacts.id],
    }),
    foreignKey({
      name: 'leads_stage_fk',
      columns: [t.tenantId, t.pipelineId, t.stageId],
      foreignColumns: [pipelineStages.tenantId, pipelineStages.pipelineId, pipelineStages.id],
    }),
    foreignKey({
      name: 'leads_source_fk',
      columns: [t.tenantId, t.sourceId],
      foreignColumns: [leadSources.tenantId, leadSources.id],
    }),
    index('leads_tenant_stage_idx').on(t.tenantId, t.stageId),
    index('leads_tenant_created_idx').on(t.tenantId, t.createdAt, t.id),
    index('leads_tenant_pipeline_created_idx').on(t.tenantId, t.pipelineId, t.createdAt, t.id),
    index('leads_tenant_contact_idx').on(t.tenantId, t.contactId),
    index('leads_tenant_owner_idx').on(t.tenantId, t.ownerUserId),
    // M1-T4: custom field filters use jsonb containment (@>).
    index('leads_custom_fields_gin_idx').using('gin', sql`${t.customFields} jsonb_path_ops`),
    check('leads_value_non_negative', sql`${t.valuePaise} is null or ${t.valuePaise} >= 0`),
    check('leads_currency_iso', sql`${t.currency} ~ '^[A-Z]{3}$'`),
  ],
);

/**
 * Saved lead views (M1-T4): a named set of filters + layout, private to the user who saved it
 * (RLS isolates tenants; the repository filters by user).
 */
export const savedViews = pgTable(
  'saved_views',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    entity: text('entity').notNull().default('lead'),
    name: text('name').notNull(),
    layout: text('layout').notNull().default('list'),
    filters: jsonb('filters').$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps(),
  },
  (t) => [
    unique('saved_views_user_name_unique').on(t.tenantId, t.userId, t.entity, t.name),
    check('saved_views_layout', sql`${t.layout} in ('list', 'board')`),
  ],
);
