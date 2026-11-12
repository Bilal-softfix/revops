import { index, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

/**
 * Consumer idempotency (CLAUDE.md rule 4): one row per (consumer, event) the consumer has applied.
 * The idempotency helper inserts it in the SAME transaction as the consumer's side effects, so a
 * redelivered event (relay retry, pg-boss retry, duplicate job) is skipped. Tenant-owned: FORCE RLS.
 */
export const processedEvents = pgTable(
  'processed_events',
  {
    consumer: text('consumer').notNull(),
    eventId: uuid('event_id').notNull(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.consumer, t.eventId] }),
    index('processed_events_tenant_id_idx').on(t.tenantId),
  ],
);
