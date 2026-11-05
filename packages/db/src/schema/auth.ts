import { index, inet, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id } from './columns.js';
import { tenants } from './tenants.js';
import { users } from './users.js';

// User-scoped (global) auth tables. RLS: a row is visible only in its user's context
// (app.user_id); unauthenticated lookups by token go through SECURITY DEFINER functions.

/** Opaque session: the cookie holds a random token, the DB only its sha256. */
export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    activeTenantId: uuid('active_tenant_id').references(() => tenants.id, {
      onDelete: 'set null',
    }),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    /** Absolute lifetime cap; the idle timeout is enforced against last_seen_at. */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const authTokenPurpose = pgEnum('auth_token_purpose', ['email_verify', 'password_reset']);

/** Single-use emailed tokens (hashed). Consumed atomically by auth_consume_token(). */
export const authTokens = pgTable(
  'auth_tokens',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: authTokenPurpose('purpose').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('auth_tokens_user_idx').on(t.userId)],
);
