import { createDb } from '@revops/db';
import { loadTestDatabaseEnv, seedCrmBatch } from '@revops/db/testing';
import type { LeadBoard, LeadPage, PipelineList, Role } from '@revops/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type LoggedIn,
  PASSWORD,
  type TestApp,
  addMember,
  asTestOwner,
  createTestApp,
  login,
  uniqueEmail,
  verify,
  withSession,
} from './test-app';

// M1-T7 volume check: a tenant with 10,000 leads (the seed's generator) — the list, filters,
// cursor pages and the board stay correct and fast, for owners and agents alike.
const VOLUME = 10_000;
/** Per request; generous so a slow CI runner doesn't flake (locally these take ~10–60 ms). */
const BUDGET_MS = 1_500;

let t: TestApp;
let owner: LoggedIn;
let agent: LoggedIn;
let agentId: string;
let managerId: string;
let pipelineIds: string[];

async function timed<T>(fn: () => Promise<T>): Promise<T> {
  const started = performance.now();
  const result = await fn();
  expect(performance.now() - started).toBeLessThan(BUDGET_MS);
  return result;
}
const get = <T>(s: LoggedIn, path: string, query: Record<string, string> = {}) =>
  timed(
    async () =>
      (await withSession(request(t.server).get(path), s).query(query).expect(200)).body as T,
  );

beforeAll(async () => {
  t = await createTestApp();
  const email = uniqueEmail('owner');
  await request(t.server)
    .post('/v1/auth/signup')
    .send({
      name: 'Owner',
      email,
      password: PASSWORD,
      tenantName: 'Big Realty',
      industry: 'real-estate',
    })
    .expect(202);
  await t.drain();
  await verify(t, t.email.lastTokenTo(email)).expect(204);
  owner = await login(t, email);
  const tenantId = owner.body.tenant?.id ?? '';
  const as = (role: Role) => addMember(t, tenantId, role);
  const a = await as('agent');
  agentId = a.userId;
  agent = await login(t, a.email);
  managerId = (await as('manager')).userId;
  pipelineIds = (
    (await withSession(request(t.server).get('/v1/pipelines'), owner).expect(200))
      .body as PipelineList
  ).items.map((p) => p.id);

  const db = createDb(loadTestDatabaseEnv().appUrl, { max: 1 });
  try {
    const added = await seedCrmBatch(db.db, tenantId, {
      name: 'volume',
      leads: VOLUME,
      ownerIds: [agentId, managerId],
      actorId: owner.body.user.id,
      phoneBlock: 90,
      activityEvery: 0,
      now: new Date(),
    });
    expect(added).toBe(VOLUME);
    // Idempotent: a rerun adds nothing.
    expect(
      await seedCrmBatch(db.db, tenantId, {
        name: 'volume',
        leads: VOLUME,
        ownerIds: [agentId, managerId],
        actorId: owner.body.user.id,
        phoneBlock: 90,
        activityEvery: 0,
        now: new Date(),
      }),
    ).toBe(0);
  } finally {
    await db.close();
  }
  await asTestOwner((sql) => sql`analyze leads, contacts`);
}, 120_000);
afterAll(() => t.close());

describe(`leads with ${VOLUME} rows`, () => {
  it('board columns count every lead of each pipeline; counts add up to the tenant total', async () => {
    let total = 0;
    for (const pipelineId of pipelineIds) {
      const board = await get<LeadBoard>(owner, '/v1/leads/board', { pipelineId });
      for (const column of board.columns) {
        total += column.count;
        expect(column.items.length).toBe(Math.min(column.count, 25));
        expect(column.nextCursor !== null).toBe(column.count > 25);
      }
    }
    expect(total).toBe(VOLUME);
  });

  it('list: first page and cursor pages are newest-first with no overlap', async () => {
    const seen = new Set<string>();
    let cursor: string | null = null;
    let previous = Number.POSITIVE_INFINITY;
    for (let page = 0; page < 5; page += 1) {
      const list: LeadPage = await get<LeadPage>(owner, '/v1/leads', {
        limit: '100',
        ...(cursor ? { cursor } : {}),
      });
      expect(list.items).toHaveLength(100);
      for (const lead of list.items) {
        expect(seen.has(lead.id)).toBe(false);
        seen.add(lead.id);
        const at = Date.parse(lead.createdAt);
        expect(at).toBeLessThanOrEqual(previous);
        previous = at;
      }
      cursor = list.nextCursor;
      expect(cursor).not.toBeNull();
    }
  });

  it('filters stay fast: stage, owner, search, custom field, status', async () => {
    const board = await get<LeadBoard>(owner, '/v1/leads/board', {
      pipelineId: pipelineIds[0] ?? '',
    });
    const column = board.columns.find((c) => c.count > 0);
    const byStage = await get<LeadPage>(owner, '/v1/leads', { stageIds: column?.stageId ?? '' });
    expect(byStage.items.every((l) => l.stageId === column?.stageId)).toBe(true);
    const byOwner = await get<LeadPage>(owner, '/v1/leads', { owner: managerId });
    expect(byOwner.items.every((l) => l.owner?.id === managerId)).toBe(true);
    const q = await get<LeadPage>(owner, '/v1/leads', { q: 'sharma' });
    expect(q.items.length).toBeGreaterThan(0);
    expect(q.items.every((l) => /sharma/i.test(l.contact.name))).toBe(true);
    const cf = await get<LeadPage>(owner, '/v1/leads', {
      cf: JSON.stringify({ property_type: 'apartment' }),
    });
    expect(cf.items.length).toBeGreaterThan(0);
    expect(cf.items.every((l) => l.customFields.property_type === 'apartment')).toBe(true);
    const won = await get<LeadPage>(owner, '/v1/leads', { status: 'won' });
    expect(won.items.every((l) => l.status === 'won' && l.wonAt !== null)).toBe(true);
  });

  it('an agent sees only their own leads in the list and on the board', async () => {
    const list = await get<LeadPage>(agent, '/v1/leads', { limit: '100' });
    expect(list.items.length).toBe(100);
    expect(list.items.every((l) => l.owner?.id === agentId)).toBe(true);
    let total = 0;
    for (const pipelineId of pipelineIds) {
      const board = await get<LeadBoard>(agent, '/v1/leads/board', { pipelineId });
      for (const column of board.columns) {
        total += column.count;
        expect(column.items.every((l) => l.owner?.id === agentId)).toBe(true);
      }
    }
    // Leads are spread over agent / manager / unassigned: roughly a third each.
    expect(total).toBeGreaterThan(VOLUME / 4);
    expect(total).toBeLessThan(VOLUME / 2);
  });
});
