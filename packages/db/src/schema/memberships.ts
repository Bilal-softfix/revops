import { index, pgTable, unique, uuid } from 'drizzle-orm/pg-core';
import { id, timestamps } from './columns.js';
import { membershipRole, membershipStatus } from './enums.js';
import { tenants } from './tenants.js';
import { users } from './users.js';

export const memberships = pgTable(
  'memberships',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: membershipRole('role').notNull(),
    status: membershipStatus('status').notNull().default('active'),
    ...timestamps(),
  },
  (t) => [
    unique('memberships_tenant_user_unique').on(t.tenantId, t.userId),
    index('memberships_user_idx').on(t.userId),
  ],
);
