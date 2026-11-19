import { randomUUID } from 'node:crypto';
import type { Db, Tx } from '../src/client.js';
import {
  auditLogs,
  contacts,
  customFieldDefs,
  customFieldPipelines,
  leadSources,
  assignmentCursors,
  csvImportErrors,
  csvImports,
  inboundWebhooks,
  leadIngestions,
  leads,
  savedViews,
  pipelineStages,
  pipelines,
  invitations,
  memberships,
  notes,
  tasks,
  timelineEvents,
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
  {
    table: 'custom_field_pipelines',
    tenantColumn: 'tenant_id',
    privileges: ['SELECT', 'INSERT', 'DELETE'],
    insert: async (tx, tenantId) => {
      const pipeline = await insertPipeline(tx, tenantId);
      const [field] = await tx
        .insert(customFieldDefs)
        .values({
          tenantId,
          entity: 'lead',
          key: `k_${randomUUID().slice(0, 8)}`,
          label: 'K',
          type: 'text',
        })
        .returning({ id: customFieldDefs.id });
      const [row] = await tx
        .insert(customFieldPipelines)
        .values({ tenantId, fieldId: field?.id ?? '', pipelineId: pipeline.id })
        .returning({ id: customFieldPipelines.id });
      return row?.id ?? '';
    },
  },
  {
    table: 'leads',
    tenantColumn: 'tenant_id',
    privileges: ['SELECT', 'INSERT', 'UPDATE'],
    insert: async (tx, tenantId) => (await insertLead(tx, tenantId)).id,
  },
  {
    table: 'saved_views',
    tenantColumn: 'tenant_id',
    privileges: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
    insert: async (tx, tenantId) => {
      const userId = await insertUser(tx);
      const [row] = await tx
        .insert(savedViews)
        .values({ tenantId, userId, name: `V ${randomUUID()}` })
        .returning({ id: savedViews.id });
      return row?.id ?? '';
    },
  },
  {
    table: 'notes',
    tenantColumn: 'tenant_id',
    privileges: ['SELECT', 'INSERT', 'UPDATE'],
    insert: async (tx, tenantId) => {
      const lead = await insertLead(tx, tenantId);
      const [row] = await tx
        .insert(notes)
        .values({ tenantId, leadId: lead.id, body: 'N' })
        .returning({ id: notes.id });
      return row?.id ?? '';
    },
  },
  {
    table: 'tasks',
    tenantColumn: 'tenant_id',
    privileges: ['SELECT', 'INSERT', 'UPDATE'],
    insert: async (tx, tenantId) => {
      const lead = await insertLead(tx, tenantId);
      const [row] = await tx
        .insert(tasks)
        .values({ tenantId, leadId: lead.id, title: 'T', dueAt: new Date() })
        .returning({ id: tasks.id });
      return row?.id ?? '';
    },
  },
  {
    table: 'timeline_events',
    tenantColumn: 'tenant_id',
    privileges: ['SELECT', 'INSERT'],
    insert: async (tx, tenantId) => {
      const lead = await insertLead(tx, tenantId);
      const [row] = await tx
        .insert(timelineEvents)
        .values({
          tenantId,
          leadId: lead.id,
          contactId: lead.contactId,
          type: 'created',
          actorType: 'system',
          occurredAt: new Date(),
        })
        .returning({ id: timelineEvents.id });
      return row?.id ?? '';
    },
  },
  {
    table: 'lead_ingestions',
    tenantColumn: 'tenant_id',
    privileges: ['SELECT', 'INSERT', 'UPDATE'],
    insert: async (tx, tenantId) => {
      const lead = await insertLead(tx, tenantId);
      const [row] = await tx
        .insert(leadIngestions)
        .values({
          tenantId,
          idempotencyKey: `test:${randomUUID()}`,
          outcome: 'created',
          leadId: lead.id,
          contactId: lead.contactId,
        })
        .returning({ id: leadIngestions.id });
      return row?.id ?? '';
    },
  },
  {
    table: 'assignment_cursors',
    tenantColumn: 'tenant_id',
    idColumn: 'tenant_id',
    privileges: ['SELECT', 'INSERT', 'UPDATE'],
    insert: async (tx, tenantId) => {
      const [row] = await tx
        .insert(assignmentCursors)
        .values({ tenantId })
        .returning({ id: assignmentCursors.tenantId });
      return row?.id ?? '';
    },
  },
  {
    table: 'inbound_webhooks',
    tenantColumn: 'tenant_id',
    privileges: ['SELECT', 'INSERT', 'UPDATE'],
    insert: async (tx, tenantId) => {
      const [source] = await tx
        .insert(leadSources)
        .values({ tenantId, name: `W ${randomUUID()}`, type: 'api' })
        .returning({ id: leadSources.id });
      const [row] = await tx
        .insert(inboundWebhooks)
        .values({
          tenantId,
          sourceId: source?.id ?? '',
          externalEventId: randomUUID(),
          signatureValid: true,
          payload: {},
          status: 'received',
        })
        .returning({ id: inboundWebhooks.id });
      return row?.id ?? '';
    },
  },
  {
    table: 'csv_imports',
    tenantColumn: 'tenant_id',
    privileges: ['SELECT', 'INSERT', 'UPDATE'],
    insert: async (tx, tenantId) => (await insertCsvImport(tx, tenantId)).id,
  },
  {
    table: 'csv_import_errors',
    tenantColumn: 'tenant_id',
    privileges: ['SELECT', 'INSERT'],
    insert: async (tx, tenantId) => {
      const csv = await insertCsvImport(tx, tenantId);
      const [row] = await tx
        .insert(csvImportErrors)
        .values({ tenantId, importId: csv.id, rowNumber: 1, reason: 'unusable', cells: ['x'] })
        .returning({ id: csvImportErrors.id });
      return row?.id ?? '';
    },
  },
];

async function insertCsvImport(tx: Tx, tenantId: string): Promise<{ id: string }> {
  const [source] = await tx
    .insert(leadSources)
    .values({ tenantId, name: `C ${randomUUID()}`, type: 'csv' })
    .returning({ id: leadSources.id });
  const [row] = await tx
    .insert(csvImports)
    .values({
      tenantId,
      sourceId: source?.id ?? '',
      createdBy: randomUUID(),
      fileName: 'leads.csv',
      sizeBytes: 3,
      fileSha256: 'x',
      headers: ['phone'],
      totalRows: 1,
    })
    .returning({ id: csvImports.id });
  return { id: row?.id ?? '' };
}

async function insertLead(tx: Tx, tenantId: string): Promise<{ id: string; contactId: string }> {
  const pipeline = await insertPipeline(tx, tenantId);
  const [stage] = await tx
    .insert(pipelineStages)
    .values({ tenantId, pipelineId: pipeline.id, name: 'S', position: 0, category: 'open' })
    .returning({ id: pipelineStages.id });
  const [contact] = await tx
    .insert(contacts)
    .values({ tenantId, name: 'L', email: `${randomUUID()}@lead.test` })
    .returning({ id: contacts.id });
  const [row] = await tx
    .insert(leads)
    .values({
      tenantId,
      contactId: contact?.id ?? '',
      pipelineId: pipeline.id,
      stageId: stage?.id ?? '',
    })
    .returning({ id: leads.id, contactId: leads.contactId });
  if (!row) throw new Error('no lead');
  return row;
}

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
