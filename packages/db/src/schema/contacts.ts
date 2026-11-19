import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { citext, id, timestamps } from './columns.js';
import { tenants } from './tenants.js';
import { users } from './users.js';

/**
 * People a tenant deals with (M1-T1). Tenant-owned, FORCE RLS, soft delete. Phones are E.164
 * (normalised by `normalizePhone` in @revops/shared before they get here) and, like emails, unique
 * per tenant among non-deleted contacts. Which contacts an agent sees is a per-tenant setting
 * (`agentContactVisibility`), enforced in the repository.
 */
export const contacts = pgTable(
  'contacts',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    phoneE164: text('phone_e164'),
    altPhones: text('alt_phones')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    email: citext('email'),
    /**
     * lower(email) as plain text, for exact lookups (dedupe). citext's `=` isn't LEAKPROOF, so
     * under RLS Postgres won't use it as an index condition and every lookup scanned the tenant's
     * contacts; text `=` is leakproof, so `email_key = lower($1)` uses the index below (M2-T5).
     */
    emailKey: text('email_key').generatedAlwaysAs(sql`lower(email::text)`),
    city: text('city'),
    customFields: jsonb('custom_fields').$type<Record<string, unknown>>().notNull().default({}),
    /** Per channel: { granted, at, source } (docs/03-india-compliance.md). */
    consent: jsonb('consent').$type<Record<string, unknown>>().notNull().default({}),
    /** Who created it: an agent always keeps sight of contacts they created. */
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    unique('contacts_tenant_id_id_unique').on(t.tenantId, t.id),
    uniqueIndex('contacts_tenant_phone_unique')
      .on(t.tenantId, t.phoneE164)
      .where(sql`${t.deletedAt} is null and ${t.phoneE164} is not null`),
    uniqueIndex('contacts_tenant_email_unique')
      .on(t.tenantId, t.email)
      .where(sql`${t.deletedAt} is null and ${t.email} is not null`),
    index('contacts_tenant_created_idx').on(t.tenantId, t.createdAt, t.id),
    index('contacts_tenant_email_key_idx')
      .on(t.tenantId, t.emailKey)
      .where(sql`${t.deletedAt} is null and ${t.emailKey} is not null`),
    // Trigram search (pg_trgm) for `?q=` on name, phone and email fragments.
    index('contacts_name_trgm_idx').using('gin', sql`${t.name} gin_trgm_ops`),
    index('contacts_phone_trgm_idx').using('gin', sql`${t.phoneE164} gin_trgm_ops`),
    index('contacts_email_trgm_idx').using('gin', sql`(${t.email}::text) gin_trgm_ops`),
    check('contacts_phone_or_email', sql`${t.phoneE164} is not null or ${t.email} is not null`),
    check('contacts_phone_e164', sql`${t.phoneE164} ~ '^\\+[1-9][0-9]{6,14}$'`),
  ],
);
