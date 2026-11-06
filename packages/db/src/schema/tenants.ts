import { DEFAULT_TIMEZONE } from '@revops/shared';
import { type AnyPgColumn, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { citext, id, timestamps } from './columns.js';
import { tenantStatus } from './enums.js';

/** RLS: a tenant row is visible only inside its own `withTenant` context (policy on `id`). */
export const tenants = pgTable('tenants', {
  id: id(),
  name: text('name').notNull(),
  slug: citext('slug').notNull().unique(),
  timezone: text('timezone').notNull().default(DEFAULT_TIMEZONE),
  locale: text('locale').notNull().default('en-IN'),
  industryTemplate: text('industry_template'),
  /** Future agency → child tenants. No agency UI in the MVP. */
  parentTenantId: uuid('parent_tenant_id').references((): AnyPgColumn => tenants.id),
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  status: tenantStatus('status').notNull().default('active'),
  ...timestamps(),
});
