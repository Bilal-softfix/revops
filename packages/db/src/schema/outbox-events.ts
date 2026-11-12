import { isNull } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { id } from './columns.js';
import { tenants } from './tenants.js';

/**
 * Written in the same transaction as the state change it describes; the relay (M0-T6) publishes
 * unpublished rows to pg-boss queues (ADR-011). `id` is the event id consumers dedupe on.
 */
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Versioned event type, e.g. `lead.created.v1`. */
    type: text('type').notNull(),
    aggregateId: uuid('aggregate_id'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (t) => [index('outbox_events_unpublished_idx').on(t.occurredAt).where(isNull(t.publishedAt))],
);
