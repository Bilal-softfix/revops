import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { citext, id, timestamps } from './columns.js';

/**
 * Global (not tenant-owned): one person can belong to many tenants via `memberships`.
 * No RLS — login looks users up by email before any tenant context exists.
 */
export const users = pgTable('users', {
  id: id(),
  email: citext('email').notNull().unique(),
  name: text('name').notNull(),
  /** E.164, e.g. +919876543210. */
  phoneE164: text('phone_e164'),
  /** argon2id encoded hash; null until the user sets a password. */
  passwordHash: text('password_hash'),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  ...timestamps(),
});
