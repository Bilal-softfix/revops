import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { id } from './columns.js';
import { tenants } from './tenants.js';

/**
 * Written in the same transaction as the state change it describes, through `recordEvent`
 * (validated against the shared event registry). The relay publishes unpublished rows to pg-boss
 * queues (ADR-011). `id` is the event id consumers dedupe on. A row the relay can't validate is
 * dead-lettered (dead_lettered_at + reason) instead of blocking delivery for everyone else.
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
    deadLetteredAt: timestamp('dead_lettered_at', { withTimezone: true }),
    /** Why the relay refused it (schema paths/codes only — never payload values). */
    deadLetterReason: text('dead_letter_reason'),
  },
  (t) => [
    index('outbox_events_pending_idx')
      .on(t.occurredAt)
      .where(sql`${t.publishedAt} is null and ${t.deadLetteredAt} is null`),
    // Defence in depth behind recordEvent: no unversioned types, payload always a JSON object.
    check(
      'outbox_events_type_format',
      // `\\.` in this template literal = `\.` in SQL (a literal dot).
      sql`${t.type} ~ '^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+\\.v[1-9][0-9]*$'`,
    ),
    check('outbox_events_payload_object', sql`jsonb_typeof(${t.payload}) = 'object'`),
  ],
);
