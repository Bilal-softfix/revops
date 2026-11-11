import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { citext, createdAt, id } from './columns.js';
import { membershipRole } from './enums.js';
import { tenants } from './tenants.js';
import { users } from './users.js';

/**
 * Pending invitations to join a tenant (tenant-owned, FORCE RLS). The emailed token is
 * `<tenant_id>.<random>`; only its sha256 is stored. Accept looks it up inside that tenant's context.
 */
export const invitations = pgTable(
  'invitations',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    email: citext('email').notNull(),
    role: membershipRole('role').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    // One open invitation per email per tenant (expired ones still count until revoked/re-sent).
    uniqueIndex('invitations_open_email_unique')
      .on(t.tenantId, t.email)
      .where(sql`${t.acceptedAt} is null and ${t.revokedAt} is null`),
    index('invitations_tenant_idx').on(t.tenantId, t.createdAt),
  ],
);
