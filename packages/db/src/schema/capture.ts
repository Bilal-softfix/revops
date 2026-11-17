import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
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
