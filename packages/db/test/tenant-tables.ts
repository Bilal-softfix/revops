import { randomUUID } from 'node:crypto';
import type { Db } from '../src/client.js';
import { auditLogs, memberships, outboxEvents, tenants } from '../src/schema/index.js';
import { withTenant } from '../src/with-tenant.js';
import type { TenantTableFixture } from './leak-check.js';
import { insertUser } from './users.js';

/**
 * Every tenant-owned table, with how to make a row. The catalog meta-test fails if a table with
 * forced RLS / a tenant_id column is missing here, so new tables can't skip the leak suite.
 */
export const TENANT_TABLES: readonly TenantTableFixture[] = [
  {
    table: 'tenants',
    tenantColumn: 'id',
    privileges: ['SELECT', 'INSERT', 'UPDATE'],
    insert: async (tx, tenantId) => {
      await tx.insert(tenants).values({ id: tenantId, name: 'T', slug: `t-${randomUUID()}` });
      return tenantId;
    },
  },
  {
    table: 'memberships',
    tenantColumn: 'tenant_id',
    privileges: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
    insert: async (tx, tenantId) => {
      const userId = await insertUser(tx);
      const [row] = await tx
        .insert(memberships)
        .values({ tenantId, userId, role: 'agent' })
        .returning({ id: memberships.id });
      return row?.id ?? '';
    },
  },
  {
    table: 'audit_logs',
    tenantColumn: 'tenant_id',
    privileges: ['SELECT', 'INSERT'],
    insert: async (tx, tenantId) => {
      const [row] = await tx
        .insert(auditLogs)
        .values({ tenantId, actorType: 'system', action: 'test.created', entity: 'test' })
        .returning({ id: auditLogs.id });
      return row?.id ?? '';
    },
  },
  {
    table: 'outbox_events',
    tenantColumn: 'tenant_id',
    privileges: ['SELECT', 'INSERT', 'UPDATE'],
    insert: async (tx, tenantId) => {
      const [row] = await tx
        .insert(outboxEvents)
        .values({ tenantId, type: 'test.created.v1', payload: { ok: true } })
        .returning({ id: outboxEvents.id });
      return row?.id ?? '';
    },
  },
];

/** Creates a tenant inside its own context (the tenants policy is on `id`). */
export async function createTenant(db: Db, name = 'Tenant'): Promise<string> {
  const id = randomUUID();
  await withTenant(db, id, (tx) =>
    tx.insert(tenants).values({ id, name, slug: `${name.toLowerCase()}-${id}` }),
  );
  return id;
}
