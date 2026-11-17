import type { Lead, LeadSourceList, PipelineList } from '@revops/shared';
import { leadSourceConfigSchema } from '@revops/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type IntakeSource, LeadIntakeService } from '../src/modules/crm';
import { Database } from '../src/platform/database/database';
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

// M2-T6: owner on arrival (round-robin among active agents / fixed user / unassigned) and
// first_response_at (first human stage change; never the system).
let t: TestApp;

async function signupOwner(tenantName: string): Promise<{ owner: LoggedIn; tenantId: string }> {
  const email = uniqueEmail('owner');
  await request(t.server)
    .post('/v1/auth/signup')
    .send({ name: 'Owner', email, password: PASSWORD, tenantName, industry: 'generic' })
    .expect(202);
  await t.drain();
  await verify(t, t.email.lastTokenTo(email)).expect(204);
  const owner = await login(t, email);
  return { owner, tenantId: owner.body.tenant?.id ?? '' };
}

const api = (s: LoggedIn) => ({
  get: (path: string) => withSession(request(t.server).get(path), s),
  post: (path: string, body: object = {}) =>
    withSession(request(t.server).post(path), s).send(body),
  patch: (path: string, body: object) => withSession(request(t.server).patch(path), s).send(body),
});
const phone = () => `95${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
let seq = 0;

async function sourceOf(owner: LoggedIn, assignment: object = { strategy: 'round_robin' }) {
  const first = ((await api(owner).get('/v1/lead-sources').expect(200)).body as LeadSourceList)
    .items[0];
  if (!first) throw new Error('no source');
  return {
    id: first.id,
    name: first.name,
    config: leadSourceConfigSchema.parse({ assignment }),
  } satisfies IntakeSource;
}

const ingest = (tenantId: string, source: IntakeSource | null) =>
  t.app.get(Database).withContext({ tenantId }, (tx) =>
    t.app.get(LeadIntakeService).ingest(tx, {
      tenantId,
      source,
      idempotencyKey: `t6:${Date.now()}:${(seq += 1)}`,
      input: { phone: phone() },
    }),
  );
const ownerOf = async (tenantId: string, leadId: string) => {
  const [row] = await asTestOwner((sql) =>
    sql.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', ${tenantId}, true)`;
      return tx<{ owner_user_id: string | null }[]>`
        select owner_user_id from leads where id = ${leadId}`;
    }),
  );
  return row?.owner_user_id ?? null;
};
const countBy = (ids: (string | null)[]) => {
  const counts = new Map<string | null, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
};
const setMemberStatus = (tenantId: string, userId: string, status: 'active' | 'disabled') =>
  asTestOwner((sql) =>
    sql.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', ${tenantId}, true)`;
      await tx`update memberships set status = ${status} where user_id = ${userId}`;
    }),
  );

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

describe('round-robin on arrival', () => {
  it('AC: 30 leads across 3 agents → 10 each, in strict rotation; managers/owners never get one', async () => {
    const { owner, tenantId } = await signupOwner('Rotation Realty');
    const agents = await Promise.all([1, 2, 3].map(() => addMember(t, tenantId, 'agent')));
    await addMember(t, tenantId, 'manager');
    const source = await sourceOf(owner);
    const owners: (string | null)[] = [];
    for (let i = 0; i < 30; i += 1) {
      owners.push(await ownerOf(tenantId, (await ingest(tenantId, source)).leadId));
    }
    const counts = countBy(owners);
    expect(counts.size).toBe(3);
    for (const a of agents) expect(counts.get(a.userId)).toBe(10);
    // Strict rotation: every window of 3 has all three agents.
    for (let i = 0; i + 3 <= owners.length; i += 3) {
      expect(new Set(owners.slice(i, i + 3)).size).toBe(3);
    }
    // lead.created.v1 carries the owner.
    const lastLead = (await ingest(tenantId, source)).leadId;
    const [event] = await asTestOwner((sql) =>
      sql.begin(async (tx) => {
        await tx`select set_config('app.tenant_id', ${tenantId}, true)`;
        return tx<{ payload: { ownerUserId: string } }[]>`
          select payload from outbox_events where type = 'lead.created.v1' and aggregate_id = ${lastLead}`;
      }),
    );
    expect(agents.map((a) => a.userId)).toContain(event?.payload.ownerUserId);
  });

  it('is fair under concurrent arrivals (cursor row lock)', async () => {
    const { owner, tenantId } = await signupOwner('Busy Realty');
    const agents = await Promise.all([1, 2, 3].map(() => addMember(t, tenantId, 'agent')));
    const source = await sourceOf(owner);
    const results = await Promise.all(Array.from({ length: 30 }, () => ingest(tenantId, source)));
    const counts = countBy(await Promise.all(results.map((r) => ownerOf(tenantId, r.leadId))));
    for (const a of agents) expect(counts.get(a.userId)).toBe(10);
  });

  it('disabled agents drop out and come back; a new agent joins the rotation', async () => {
    const { owner, tenantId } = await signupOwner('Changing Realty');
    const [a, b] = await Promise.all([1, 2].map(() => addMember(t, tenantId, 'agent')));
    if (!a || !b) throw new Error('agents');
    const source = await sourceOf(owner);
    await setMemberStatus(tenantId, b.userId, 'disabled');
    const whileDisabled = await Promise.all(
      [1, 2, 3].map(async () => ownerOf(tenantId, (await ingest(tenantId, source)).leadId)),
    );
    expect(new Set(whileDisabled)).toEqual(new Set([a.userId]));
    await setMemberStatus(tenantId, b.userId, 'active');
    const c = await addMember(t, tenantId, 'agent');
    const after: (string | null)[] = [];
    for (let i = 0; i < 6; i += 1)
      after.push(await ownerOf(tenantId, (await ingest(tenantId, source)).leadId));
    const counts = countBy(after);
    for (const id of [a.userId, b.userId, c.userId]) expect(counts.get(id)).toBe(2);
  });

  it('no active agents → unassigned; no source → round-robin too', async () => {
    const { owner, tenantId } = await signupOwner('Solo Realty');
    const source = await sourceOf(owner);
    expect(await ownerOf(tenantId, (await ingest(tenantId, source)).leadId)).toBeNull();
    const agent = await addMember(t, tenantId, 'agent');
    expect(await ownerOf(tenantId, (await ingest(tenantId, null)).leadId)).toBe(agent.userId);
  });

  it('fixed user and unassigned strategies; a disabled fixed user leaves it unassigned', async () => {
    const { owner, tenantId } = await signupOwner('Fixed Realty');
    const manager = await addMember(t, tenantId, 'manager');
    await addMember(t, tenantId, 'agent');
    const fixed = await sourceOf(owner, { strategy: 'user', userId: manager.userId });
    expect(await ownerOf(tenantId, (await ingest(tenantId, fixed)).leadId)).toBe(manager.userId);
    const none = await sourceOf(owner, { strategy: 'unassigned' });
    expect(await ownerOf(tenantId, (await ingest(tenantId, none)).leadId)).toBeNull();
    await setMemberStatus(tenantId, manager.userId, 'disabled');
    expect(await ownerOf(tenantId, (await ingest(tenantId, fixed)).leadId)).toBeNull();
  });

  it('a re-enquiry keeps the existing owner and does not advance the rotation', async () => {
    const { owner, tenantId } = await signupOwner('Repeat Realty');
    const [a, b] = await Promise.all([1, 2].map(() => addMember(t, tenantId, 'agent')));
    if (!a || !b) throw new Error('agents');
    const source = await sourceOf(owner);
    const p = phone();
    const run = (input: { phone: string }) =>
      t.app.get(Database).withContext({ tenantId }, (tx) =>
        t.app.get(LeadIntakeService).ingest(tx, {
          tenantId,
          source,
          idempotencyKey: `t6r:${(seq += 1)}`,
          input,
        }),
      );
    const first = await run({ phone: p });
    const firstOwner = await ownerOf(tenantId, first.leadId);
    const again = await run({ phone: p });
    expect(again.outcome).toBe('reenquiry');
    expect(await ownerOf(tenantId, first.leadId)).toBe(firstOwner);
    const next = await run({ phone: phone() });
    expect(await ownerOf(tenantId, next.leadId)).not.toBe(firstOwner);
  });
});

describe('first_response_at', () => {
  let owner: LoggedIn;
  let tenantId: string;
  let stages: { open: string[]; won: string };

  beforeAll(async () => {
    ({ owner, tenantId } = await signupOwner('Response Realty'));
    const pipeline = (
      (await api(owner).get('/v1/pipelines').expect(200)).body as PipelineList
    ).items.find((p) => p.isDefault);
    if (!pipeline) throw new Error('no default pipeline');
    stages = {
      open: pipeline.stages.filter((s) => s.category === 'open').map((s) => s.id),
      won: pipeline.stages.find((s) => s.category === 'won')?.id ?? '',
    };
  });
  const lead = async (id: string) =>
    (await api(owner).get(`/v1/leads/${id}`).expect(200)).body as Lead;

  it('null on arrival; set by the first human stage change at that instant; never changed after', async () => {
    const { leadId } = await ingest(tenantId, await sourceOf(owner, { strategy: 'unassigned' }));
    expect((await lead(leadId)).firstResponseAt).toBeNull();
    t.clock.advance(7 * 60 * 1000);
    const at = t.clock.now().toISOString();
    await api(owner).post(`/v1/leads/${leadId}/stage`, { stageId: stages.open[1] }).expect(200);
    expect((await lead(leadId)).firstResponseAt).toBe(at);
    t.clock.advance(60 * 60 * 1000);
    await api(owner).post(`/v1/leads/${leadId}/stage`, { stageId: stages.won }).expect(200);
    expect((await lead(leadId)).firstResponseAt).toBe(at);
  });

  it('a no-op stage change does not count', async () => {
    const { leadId } = await ingest(tenantId, await sourceOf(owner, { strategy: 'unassigned' }));
    const current = (await lead(leadId)).stageId;
    await api(owner).post(`/v1/leads/${leadId}/stage`, { stageId: current }).expect(200);
    expect((await lead(leadId)).firstResponseAt).toBeNull();
  });

  it('bulk stage moves count for every moved lead', async () => {
    const source = await sourceOf(owner, { strategy: 'unassigned' });
    const ids = [(await ingest(tenantId, source)).leadId, (await ingest(tenantId, source)).leadId];
    await api(owner)
      .post('/v1/leads/bulk-stage', { leadIds: ids, stageId: stages.open[1] })
      .expect(200);
    for (const id of ids) expect((await lead(id)).firstResponseAt).not.toBeNull();
  });

  it('system moves (stage deleted with ?moveTo=) do not count', async () => {
    const created = (
      await api(owner)
        .post('/v1/pipelines', { name: `Resp ${Date.now()}` })
        .expect(201)
    ).body as { id: string; stages: { id: string; category: string }[] };
    const [from, to] = created.stages.filter((s) => s.category === 'open');
    if (!from || !to) throw new Error('stages');
    const l = (
      await api(owner)
        .post('/v1/leads', {
          pipelineId: created.id,
          stageId: from.id,
          contact: { name: 'Sys', phone: phone() },
        })
        .expect(201)
    ).body as Lead;
    await withSession(
      request(t.server).delete(`/v1/pipelines/${created.id}/stages/${from.id}?moveTo=${to.id}`),
      owner,
    ).expect(200);
    const after = await lead(l.id);
    expect(after.stageId).toBe(to.id);
    expect(after.firstResponseAt).toBeNull();
  });
});
