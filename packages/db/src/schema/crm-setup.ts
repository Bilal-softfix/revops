import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, timestamps } from './columns.js';
import { customFieldEntity, customFieldType, leadSourceType, stageCategory } from './enums.js';
import { tenants } from './tenants.js';

// CRM setup (M1-T3a): a tenant's pipelines, stages, custom field definitions and lead sources.
// Seeded once from its industry template (packages/shared/src/templates), then owned and edited
// by the tenant. All tenant-owned, FORCE RLS.
//
// Cross-tenant references are impossible by construction: child rows reference their parent by
// (tenant_id, id) — FK checks bypass RLS, so a plain `pipeline_id` FK would let one tenant point
// at another tenant's pipeline by guessing its uuid.

const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' });

export const pipelines = pgTable(
  'pipelines',
  {
    id: id(),
    tenantId: tenantId(),
    /** Template key it was seeded from (`repair_jobs`); null for pipelines created by users. */
    key: text('key'),
    name: text('name').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    position: integer('position').notNull().default(0),
    /** Suggested reasons when a lead moves to a lost stage (free text is still allowed). */
    lostReasons: jsonb('lost_reasons').$type<string[]>().notNull().default([]),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    unique('pipelines_tenant_id_id_unique').on(t.tenantId, t.id),
    uniqueIndex('pipelines_one_default')
      .on(t.tenantId)
      .where(sql`${t.isDefault} and ${t.deletedAt} is null`),
    uniqueIndex('pipelines_tenant_key_unique')
      .on(t.tenantId, t.key)
      .where(sql`${t.key} is not null`),
  ],
);

export const pipelineStages = pgTable(
  'pipeline_stages',
  {
    id: id(),
    tenantId: tenantId(),
    pipelineId: uuid('pipeline_id').notNull(),
    key: text('key'),
    name: text('name').notNull(),
    position: integer('position').notNull(),
    category: stageCategory('category').notNull(),
    probability: smallint('probability').notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    unique('pipeline_stages_tenant_id_id_unique').on(t.tenantId, t.id),
    foreignKey({
      name: 'pipeline_stages_pipeline_fk',
      columns: [t.tenantId, t.pipelineId],
      foreignColumns: [pipelines.tenantId, pipelines.id],
    }).onDelete('cascade'),
    uniqueIndex('pipeline_stages_pipeline_key_unique')
      .on(t.pipelineId, t.key)
      .where(sql`${t.key} is not null`),
    index('pipeline_stages_pipeline_position_idx').on(t.pipelineId, t.position),
    check('pipeline_stages_probability_range', sql`${t.probability} between 0 and 100`),
  ],
);

export interface CustomFieldOption {
  value: string;
  label: string;
}

export const customFieldDefs = pgTable(
  'custom_field_defs',
  {
    id: id(),
    tenantId: tenantId(),
    entity: customFieldEntity('entity').notNull(),
    /** Immutable; values live under it in contacts/leads.custom_fields (jsonb). */
    key: text('key').notNull(),
    label: text('label').notNull(),
    type: customFieldType('type').notNull(),
    options: jsonb('options').$type<CustomFieldOption[]>(),
    required: boolean('required').notNull().default(false),
    position: integer('position').notNull().default(0),
    /** Deleting a definition hides its values; they are never destroyed. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    // Including deleted ones: a key is never reused, so old values can't resurface under a new type.
    unique('custom_field_defs_tenant_entity_key_unique').on(t.tenantId, t.entity, t.key),
  ],
);

export const leadSources = pgTable(
  'lead_sources',
  {
    id: id(),
    tenantId: tenantId(),
    key: text('key'),
    name: text('name').notNull(),
    type: leadSourceType('type').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    unique('lead_sources_tenant_id_id_unique').on(t.tenantId, t.id),
    uniqueIndex('lead_sources_tenant_key_unique')
      .on(t.tenantId, t.key)
      .where(sql`${t.key} is not null`),
  ],
);
