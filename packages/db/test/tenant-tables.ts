import { randomUUID } from 'node:crypto';
import type { Db, Tx } from '../src/client.js';
import {
  auditLogs,
  contacts,
  customFieldDefs,
  leadSources,
  pipelineStages,
  pipelines,
  invitations,
  memberships,
  outboxEvents,
  processedEvents,
  tenants,
} from '../src/schema/index.js';
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
  {
    table: 'invitations',
    tenantColumn: 'tenant_id',
    privileges: ['SELECT', 'INSERT', 'UPDATE'],
    insert: async (tx, tenantId) => {
      const [row] = await tx
        .insert(invitations)
        .values({
          tenantId,
          email: `${randomUUID()}@invite.test`,
          role: 'agent',
          tokenHash: randomUUID(),
          expiresAt: new Date(Date.now() + 86_400_000),
        })
        .returning({ id: invitations.id });
      return row?.id ?? '';
    },
  },
  {
    table: 'processed_events',
    tenantColumn: 'tenant_id',
    idColumn: 'event_id',
    privileges: ['SELECT', 'INSERT'],
    insert: async (tx, tenantId) => {
      const eventId = randomUUID();
      await tx.insert(processedEvents).values({ consumer: 'test.consumer', eventId, tenantId });
      return eventId;
    },
  },
  {
    table: 'pipelines',
    tenantColumn: 'tenant_id',
    privileges: ['SELECT', 'INSERT', 'UPDATE'],
    insert: async (tx, tenantId) => (await insertPipeline(tx, tenantId)).id,
  },
  {
    table: 'pipeline_stages',
    tenantColumn: 'tenant_id',
    privileges: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
    insert: async (tx, tenantId) => {
      const pipeline = await insertPipeline(tx, tenantId);
      const [row] = await tx
        .insert(pipelineStages)
        .values({ tenantId, pipelineId: pipeline.id, name: 'S', position: 0, category: 'open' })
        .returning({ id: pipelineStages.id });
      return row?.id ?? '';
    },
  },
  {
    table: 'custom_field_defs',
    tenantColumn: 'tenant_id',
    privileges: ['SELECT', 'INSERT', 'UPDATE'],
    insert: async (tx, tenantId) => {
      const [row] = await tx
        .insert(customFieldDefs)
        .values({
          tenantId,
          entity: 'lead',
          key: `k_${randomUUID().slice(0, 8)}`,
          label: 'K',
          type: 'text',
        })
        .returning({ id: customFieldDefs.id });
      return row?.id ?? '';
    },
  },
  {
    table: 'lead_sources',
    tenantColumn: 'tenant_id',
    privileges: ['SELECT', 'INSERT', 'UPDATE'],
    insert: async (tx, tenantId) => {
      const [row] = await tx
        .insert(leadSources)
        .values({ tenantId, name: 'Walk-in', type: 'walk_in' })
        .returning({ id: leadSources.id });
      return row?.id ?? '';
    },
  },
  {
    table: 'contacts',
    tenantColumn: 'tenant_id',
    privileges: ['SELECT', 'INSERT', 'UPDATE'],
    insert: async (tx, tenantId) => {
      const [row] = await tx
        .insert(contacts)
        .values({
          tenantId,
          name: 'C',
          phoneE164: `+9198${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
        })
        .returning({ id: contacts.id });
      return row?.id ?? '';
    },
  },
];

async function insertPipeline(tx: Tx, tenantId: string): Promise<{ id: string }> {
  const [row] = await tx
    .insert(pipelines)
    .values({ tenantId, name: 'P' })
    .returning({ id: pipelines.id });
  if (!row) throw new Error('no pipeline');
  return row;
}

/** Creates a tenant inside its own context (the tenants policy is on `id`). */
export async function createTenant(db: Db, name = 'Tenant'): Promise<string> {
  const id = randomUUID();
  await withTenant(db, id, (tx) =>
    tx.insert(tenants).values({ id, name, slug: `${name.toLowerCase()}-${id}` }),
  );
  return id;
}
