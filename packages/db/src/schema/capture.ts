import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { id } from './columns.js';
import { contacts } from './contacts.js';
import { leadSources } from './crm-setup.js';
import { leads } from './leads.js';
import { tenants } from './tenants.js';

/**
 * Lead capture (M2). `lead_ingestions`: one row per inbound lead (form post, webhook event, CSV
 * row), keyed by a channel-specific idempotency key (`webhook:<source>:<external id>`,
 * `csv:<source>:<row hash>`, …). The unique key makes a replay find the first ingestion instead of
 * creating a second lead; the row records what the intake did. Tenant-owned, FORCE RLS.
 */
export const leadIngestions = pgTable(
  'lead_ingestions',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    sourceId: uuid('source_id'),
    idempotencyKey: text('idempotency_key').notNull(),
    /** created | reenquiry; null while the ingesting transaction runs. */
    outcome: text('outcome'),
    leadId: uuid('lead_id'),
    contactId: uuid('contact_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('lead_ingestions_tenant_key_unique').on(t.tenantId, t.idempotencyKey),
    check('lead_ingestions_key_length', sql`length(${t.idempotencyKey}) between 1 and 300`),
    check('lead_ingestions_outcome', sql`${t.outcome} in ('created', 'reenquiry')`),
    foreignKey({
      name: 'lead_ingestions_source_fk',
      columns: [t.tenantId, t.sourceId],
      foreignColumns: [leadSources.tenantId, leadSources.id],
    }),
    foreignKey({
      name: 'lead_ingestions_lead_fk',
      columns: [t.tenantId, t.leadId],
      foreignColumns: [leads.tenantId, leads.id],
    }),
    foreignKey({
      name: 'lead_ingestions_contact_fk',
      columns: [t.tenantId, t.contactId],
      foreignColumns: [contacts.tenantId, contacts.id],
    }),
    index('lead_ingestions_lead_idx').on(t.tenantId, t.leadId),
  ],
);

/**
 * Round-robin position per tenant (M2-T6): the agent who got the last inbound lead. The intake
 * locks this row FOR UPDATE, so concurrent arrivals take strict turns. Tenant-owned, FORCE RLS.
 */
export const assignmentCursors = pgTable('assignment_cursors', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  lastUserId: uuid('last_user_id'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Raw inbound webhook deliveries (M2-T3; CLAUDE.md rule 5): every delivery to a source's webhook
 * URL is stored before anything else — including ones with a bad signature (`signature_valid`
 * false, status `rejected`) — then processed asynchronously by a job. A valid delivery is unique
 * per (tenant, source, external_event_id): a replay finds the first row instead of a second lead.
 * Purged after 30 days (PII retention); rejected deliveries (unauthenticated) after 7 days, stored
 * at most 16 KB each and capped per source per hour. Tenant-owned, FORCE RLS.
 */
export const inboundWebhooks = pgTable(
  'inbound_webhooks',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    sourceId: uuid('source_id').notNull(),
    provider: text('provider').notNull().default('generic'),
    /** The sender's id for this event; null when the payload couldn't be read. */
    externalEventId: text('external_event_id'),
    signatureValid: boolean('signature_valid').notNull(),
    /** Parsed JSON, or { raw, truncated } (first 16 KB as text) when rejected or not JSON. Never logged. */
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    /** received → processed | failed; rejected = bad signature (never processed). */
    status: text('status').notNull(),
    /** A short machine code (bad_signature, invalid_payload, intake_unusable…), never values. */
    error: text('error'),
    leadId: uuid('lead_id'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => [
    check(
      'inbound_webhooks_status',
      sql`${t.status} in ('received', 'processed', 'failed', 'rejected')`,
    ),
    check('inbound_webhooks_event_id_length', sql`length(${t.externalEventId}) between 1 and 200`),
    uniqueIndex('inbound_webhooks_event_unique')
      .on(t.tenantId, t.sourceId, t.externalEventId)
      .where(sql`${t.signatureValid} and ${t.externalEventId} is not null`),
    foreignKey({
      name: 'inbound_webhooks_source_fk',
      columns: [t.tenantId, t.sourceId],
      foreignColumns: [leadSources.tenantId, leadSources.id],
    }),
    foreignKey({
      name: 'inbound_webhooks_lead_fk',
      columns: [t.tenantId, t.leadId],
      foreignColumns: [leads.tenantId, leads.id],
    }),
    index('inbound_webhooks_received_idx').on(t.receivedAt),
    // Owner/admin view of recent rejected deliveries per source (M2-T3 review).
    index('inbound_webhooks_rejected_idx')
      .on(t.tenantId, t.sourceId, t.receivedAt)
      .where(sql`${t.status} = 'rejected'`),
  ],
);

/**
 * CSV imports (M2-T5): one row per uploaded file. The file itself is in object storage
 * (`storage_key`) until the import finishes. `mapping` (one target or null per column) is set at
 * start; counters advance batch by batch, so `processed_rows` is both the progress and the resume
 * point of a retried job. Tenant-owned, FORCE RLS.
 */
export const csvImports = pgTable(
  'csv_imports',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    sourceId: uuid('source_id').notNull(),
    createdBy: uuid('created_by').notNull(),
    fileName: text('file_name').notNull(),
    /** Null once the file has been deleted (after the import finished). */
    storageKey: text('storage_key'),
    sizeBytes: integer('size_bytes').notNull(),
    fileSha256: text('file_sha256').notNull(),
    headers: jsonb('headers').$type<string[]>().notNull(),
    mapping: jsonb('mapping').$type<(string | null)[]>(),
    status: text('status').notNull().default('uploaded'),
    totalRows: integer('total_rows').notNull(),
    processedRows: integer('processed_rows').notNull().default(0),
    createdCount: integer('created_count').notNull().default(0),
    reenquiryCount: integer('reenquiry_count').notNull().default(0),
    duplicateCount: integer('duplicate_count').notNull().default(0),
    failedCount: integer('failed_count').notNull().default(0),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    check(
      'csv_imports_status',
      sql`${t.status} in ('uploaded', 'queued', 'processing', 'completed', 'failed')`,
    ),
    check('csv_imports_file_name_length', sql`length(${t.fileName}) between 1 and 200`),
    unique('csv_imports_tenant_id_id_unique').on(t.tenantId, t.id),
    foreignKey({
      name: 'csv_imports_source_fk',
      columns: [t.tenantId, t.sourceId],
      foreignColumns: [leadSources.tenantId, leadSources.id],
    }),
    index('csv_imports_source_idx').on(t.tenantId, t.sourceId, t.createdAt),
  ],
);

/**
 * Rows a CSV import could not use (M2-T5): the row number (1 = first data row), a reason code and
 * the row's cells, for the downloadable error report. Unique per (import, row), so a retried
 * batch doesn't report a row twice. Tenant-owned, FORCE RLS.
 */
export const csvImportErrors = pgTable(
  'csv_import_errors',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    importId: uuid('import_id').notNull(),
    rowNumber: integer('row_number').notNull(),
    reason: text('reason').notNull(),
    cells: jsonb('cells').$type<string[]>().notNull(),
  },
  (t) => [
    unique('csv_import_errors_row_unique').on(t.tenantId, t.importId, t.rowNumber),
    foreignKey({
      name: 'csv_import_errors_import_fk',
      columns: [t.tenantId, t.importId],
      foreignColumns: [csvImports.tenantId, csvImports.id],
    }).onDelete('cascade'),
  ],
);
