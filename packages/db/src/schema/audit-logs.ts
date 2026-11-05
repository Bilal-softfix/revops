import { desc } from 'drizzle-orm';
import { index, inet, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id } from './columns.js';
import { actorType } from './enums.js';
import { tenants } from './tenants.js';

/** Append-only: app_user has SELECT + INSERT only (see the RLS migration). */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    actorType: actorType('actor_type').notNull(),
    /** User id for `user`; null for `system`/`ai`. */
    actorId: uuid('actor_id'),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id'),
    before: jsonb('before').$type<Record<string, unknown>>(),
    after: jsonb('after').$type<Record<string, unknown>>(),
    ip: inet('ip'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_logs_tenant_created_idx').on(t.tenantId, desc(t.createdAt))],
);
