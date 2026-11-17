import { randomUUID } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Db, Tx } from './client.js';
import {
  contacts,
  customFieldDefs,
  customFieldPipelines,
  leadSources,
  leads,
  notes,
  pipelineStages,
  pipelines,
  tasks,
  timelineEvents,
} from './schema/index.js';
import { withContext } from './with-tenant.js';

/**
 * Demo CRM data for the seed (M1-T7): contacts, leads spread over every pipeline and stage, owners,
 * sources, values, custom-field values, won/lost outcomes, a `created` timeline entry per lead, and
 * a few notes and tasks. Deterministic (seeded PRNG), written in batches through RLS as app_user.
 *
 * Seeded rows carry `attribution.seed` = the batch name, so reruns are idempotent: a batch only
 * tops up to its target count. The 10k volume batch (`volume`) is the same generator at scale.
 */

const FIRST = [
  'Aarav',
  'Vivaan',
  'Aditya',
  'Vihaan',
  'Arjun',
  'Sai',
  'Reyansh',
  'Krishna',
  'Ishaan',
  'Rohan',
  'Ananya',
  'Diya',
  'Saanvi',
  'Aadhya',
  'Pari',
  'Anika',
  'Navya',
  'Meera',
  'Priya',
  'Kavya',
  'Rahul',
  'Sneha',
  'Imran',
  'Fatima',
  'Gurpreet',
  'Harleen',
  'Joseph',
  'Mary',
  'Suresh',
  'Lakshmi',
];
const LAST = [
  'Sharma',
  'Verma',
  'Patel',
  'Reddy',
  'Iyer',
  'Nair',
  'Gupta',
  'Singh',
  'Khan',
  'Das',
  'Mehta',
  'Joshi',
  'Kulkarni',
  'Banerjee',
  'Pillai',
  'Rao',
  'Chopra',
  'Ahmed',
  'Fernandes',
  'Bose',
];
const CITIES = ['Mumbai', 'Pune', 'Bengaluru', 'Hyderabad', 'Chennai', 'Delhi', 'Kochi', 'Jaipur'];
const NOTES = [
  'Called, asked to follow up next week.',
  'Interested — wants a detailed quote on WhatsApp.',
  'Comparing with two other options; price sensitive.',
  'Prefers calls after 6 pm.',
];
const TASKS = ['Call back', 'Send quote', 'Follow up on WhatsApp', 'Confirm visit'];
const DAY_MS = 86_400_000;

/** mulberry32: small deterministic PRNG so every seed run produces the same data. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export interface CrmSeedBatch {
  /** Stored in `attribution.seed`; reruns top up to `leads` rows with this name. */
  name: string;
  leads: number;
  /** Members leads are spread over (null = unassigned leads too). */
  ownerIds: readonly string[];
  /** Author of notes/tasks and the timeline actor. */
  actorId: string;
  /** Distinct phone block per batch, so batches never collide: +91 9<block 2 digits><7 digits>. */
  phoneBlock: number;
  /** Notes + tasks on every n-th lead (0 = none; the volume batch skips them). */
  activityEvery: number;
  now: Date;
}

interface Setup {
  stages: { id: string; pipelineId: string; name: string; category: string; position: number }[];
  pipelines: Map<string, { name: string; lostReasons: string[] }>;
  sourceIds: string[];
  fields: {
    key: string;
    type: string;
    options: { value: string }[] | null;
    pipelineIds: Set<string> | null; // null = all pipelines
  }[];
}

async function loadSetup(tx: Tx): Promise<Setup> {
  const ps = await tx
    .select({ id: pipelines.id, name: pipelines.name, lostReasons: pipelines.lostReasons })
    .from(pipelines)
    .where(isNull(pipelines.deletedAt));
  const stages = await tx
    .select({
      id: pipelineStages.id,
      pipelineId: pipelineStages.pipelineId,
      name: pipelineStages.name,
      category: pipelineStages.category,
      position: pipelineStages.position,
    })
    .from(pipelineStages);
  const sources = await tx
    .select({ id: leadSources.id })
    .from(leadSources)
    .where(eq(leadSources.isActive, true));
  const defs = await tx
    .select({
      id: customFieldDefs.id,
      key: customFieldDefs.key,
      type: customFieldDefs.type,
      options: customFieldDefs.options,
    })
    .from(customFieldDefs)
    .where(and(eq(customFieldDefs.entity, 'lead'), isNull(customFieldDefs.deletedAt)));
  const links = await tx
    .select({ fieldId: customFieldPipelines.fieldId, pipelineId: customFieldPipelines.pipelineId })
    .from(customFieldPipelines);
  const pipelineMap = new Map(ps.map((p) => [p.id, { name: p.name, lostReasons: p.lostReasons }]));
  return {
    stages: stages.filter((s) => pipelineMap.has(s.pipelineId)),
    pipelines: pipelineMap,
    sourceIds: sources.map((s) => s.id),
    fields: defs.map((d) => {
      const own = links.filter((l) => l.fieldId === d.id).map((l) => l.pipelineId);
      return { ...d, pipelineIds: own.length > 0 ? new Set(own) : null };
    }),
  };
}

function fieldValue(field: Setup['fields'][number], rand: () => number): unknown {
  const pick = <T>(xs: readonly T[]): T | undefined => xs[Math.floor(rand() * xs.length)];
  switch (field.type) {
    case 'select':
      return pick(field.options ?? [])?.value;
    case 'multiselect': {
      const v = pick(field.options ?? [])?.value;
      return v === undefined ? undefined : [v];
    }
    case 'bool':
      return rand() < 0.5;
    case 'number':
      return Math.floor(rand() * 100);
    case 'date':
      return `2026-${String(1 + Math.floor(rand() * 12)).padStart(2, '0')}-15`;
    default:
      return `Demo ${field.key.replace(/_/g, ' ')}`;
  }
}

/** Number of leads already seeded by `batch` in this tenant. */
export async function seededLeadCount(tx: Tx, batch: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(leads)
    .where(sql`${leads.attribution} ->> 'seed' = ${batch}`);
  return row?.n ?? 0;
}

const CHUNK = 1000;

/**
 * Tops the tenant up to `batch.leads` seeded leads of this batch. Returns how many were added.
 * Each chunk is its own transaction, so a 10k batch never holds one huge transaction.
 */
export async function seedCrmBatch(db: Db, tenantId: string, batch: CrmSeedBatch): Promise<number> {
  const { existing, setup } = await withContext(db, { tenantId }, async (tx) => ({
    existing: await seededLeadCount(tx, batch.name),
    setup: await loadSetup(tx),
  }));
  if (existing >= batch.leads || setup.stages.length === 0) return 0;
  const owners: (string | null)[] = [...batch.ownerIds, null];

  for (let start = existing; start < batch.leads; start += CHUNK) {
    const end = Math.min(start + CHUNK, batch.leads);
    await withContext(db, { tenantId, userId: batch.actorId }, async (tx) => {
      const contactRows: (typeof contacts.$inferInsert)[] = [];
      const leadRows: (typeof leads.$inferInsert)[] = [];
      for (let i = start; i < end; i += 1) {
        // Seeded per row (not per run), so a top-up produces the same rows a full run would.
        const rand = prng(batch.phoneBlock * 1_000_003 + i);
        const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
        const name = `${pick(FIRST)} ${pick(LAST)}`;
        const createdAt = new Date(batch.now.getTime() - Math.floor(rand() * 120 * DAY_MS));
        const stage = pick(setup.stages);
        const pipeline = setup.pipelines.get(stage.pipelineId);
        const contactId = randomUUID();
        contactRows.push({
          id: contactId,
          tenantId,
          name,
          phoneE164: `+919${String(batch.phoneBlock).padStart(2, '0')}${String(i).padStart(7, '0')}`,
          email:
            rand() < 0.4
              ? `${name.toLowerCase().replace(' ', '.')}.${batch.phoneBlock}-${i}@example.test`
              : null,
          city: pick(CITIES),
          createdBy: batch.actorId,
          createdAt,
          updatedAt: createdAt,
        });
        const customFields: Record<string, unknown> = {};
        for (const field of setup.fields) {
          if (field.pipelineIds && !field.pipelineIds.has(stage.pipelineId)) continue;
          if (rand() < 0.3) continue; // not every lead has every field
          const value = fieldValue(field, rand);
          if (value !== undefined) customFields[field.key] = value;
        }
        const closedAt = new Date(createdAt.getTime() + Math.floor(rand() * 10 * DAY_MS));
        leadRows.push({
          tenantId,
          contactId,
          pipelineId: stage.pipelineId,
          stageId: stage.id,
          status: stage.category as 'open' | 'won' | 'lost',
          ownerUserId: pick(owners),
          sourceId: setup.sourceIds.length > 0 ? pick(setup.sourceIds) : null,
          valuePaise: rand() < 0.7 ? BigInt(Math.floor(rand() * 5_000) * 100_00) : null,
          attribution: { seed: batch.name },
          customFields,
          wonAt: stage.category === 'won' ? closedAt : null,
          lostAt: stage.category === 'lost' ? closedAt : null,
          lostReason:
            stage.category === 'lost' ? (pick(pipeline?.lostReasons ?? []) ?? 'Other') : null,
          createdBy: batch.actorId,
          createdAt,
          updatedAt: createdAt,
        });
      }
      await tx.insert(contacts).values(contactRows);
      const inserted = await tx.insert(leads).values(leadRows).returning({
        id: leads.id,
        contactId: leads.contactId,
        pipelineId: leads.pipelineId,
        stageId: leads.stageId,
        ownerUserId: leads.ownerUserId,
        createdAt: leads.createdAt,
      });
      const stageName = new Map(setup.stages.map((s) => [s.id, s.name]));
      await tx.insert(timelineEvents).values(
        inserted.map((l) => ({
          tenantId,
          leadId: l.id,
          contactId: l.contactId,
          type: 'created' as const,
          actorType: 'system' as const,
          actorId: null,
          summary: 'Demo data',
          data: {
            pipeline: { id: l.pipelineId, name: setup.pipelines.get(l.pipelineId)?.name ?? '' },
            stage: { id: l.stageId, name: stageName.get(l.stageId) ?? '' },
            owner: null,
          },
          occurredAt: l.createdAt,
        })),
      );
      if (batch.activityEvery > 0) await seedActivities(tx, tenantId, batch, inserted, start);
    });
  }
  return batch.leads - existing;
}

async function seedActivities(
  tx: Tx,
  tenantId: string,
  batch: CrmSeedBatch,
  inserted: { id: string; contactId: string; ownerUserId: string | null; createdAt: Date }[],
  offset: number,
): Promise<void> {
  const picked = inserted.filter((_, i) => (offset + i) % batch.activityEvery === 0);
  if (picked.length === 0) return;
  const noteRows = await tx
    .insert(notes)
    .values(
      picked.map((l, i) => ({
        tenantId,
        leadId: l.id,
        authorId: batch.actorId,
        body: NOTES[(offset + i) % NOTES.length] ?? 'Demo note',
        createdAt: new Date(l.createdAt.getTime() + 3_600_000),
      })),
    )
    .returning({ id: notes.id, leadId: notes.leadId, createdAt: notes.createdAt });
  const contactOf = new Map(picked.map((l) => [l.id, l.contactId]));
  await tx.insert(timelineEvents).values(
    noteRows.map((n) => ({
      tenantId,
      leadId: n.leadId,
      contactId: contactOf.get(n.leadId) ?? '',
      type: 'note' as const,
      actorType: 'user' as const,
      actorId: batch.actorId,
      refTable: 'notes',
      refId: n.id,
      occurredAt: n.createdAt,
    })),
  );
  // Tasks spread over overdue / today / upcoming for the lead's owner (or the actor).
  await tx.insert(tasks).values(
    picked.map((l, i) => ({
      tenantId,
      leadId: l.id,
      assigneeId: l.ownerUserId ?? batch.actorId,
      title: TASKS[(offset + i) % TASKS.length] ?? 'Follow up',
      type: 'call' as const,
      dueAt: new Date(batch.now.getTime() + (((offset + i) % 5) - 2) * DAY_MS),
      createdBy: batch.actorId,
    })),
  );
}
