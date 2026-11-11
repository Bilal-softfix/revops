import { index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Fixed-window rate-limit counters (ADR-011: Postgres instead of Redis). System table: no tenant,
 * and app_user has NO table privileges. It is reached only through the SECURITY DEFINER functions
 * `rate_limit_consume` / `rate_limit_reset` / `rate_limit_purge` (migration 0010). Keys are
 * sha256 hex of the logical key, so no IPs or emails are stored.
 */
export const rateLimitBuckets = pgTable(
  'rate_limit_buckets',
  {
    keyHash: text('key_hash').primaryKey(),
    count: integer('count').notNull(),
    resetAt: timestamp('reset_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('rate_limit_buckets_reset_at_idx').on(t.resetAt)],
);
