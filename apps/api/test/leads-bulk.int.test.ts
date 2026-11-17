import type { BulkLeadResult, Lead, Pipeline, PipelineList, Role } from '@revops/shared';
import { randomUUID } from 'node:crypto';
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

// M1-T6: bulk assign + bulk stage move — permissions, all-or-nothing for the leads found,
// unchanged / not-found ids, and per-lead timeline + audit + outbox plus one summary audit row.
let t: TestApp;
let owner: LoggedIn;
let manager: LoggedIn;
let agent: LoggedIn;
let other: LoggedIn; // owner of another tenant
let tenantId: string;
let ownerId: string;
let agentId: string;
let disabledId: string;
let inquiries: Pipeline;
let repairs: Pipeline;

async function signupOwner(tenantName: string): Promise<LoggedIn> {
  const email = uniqueEmail('owner');
  await request(t.server)
    .post('/v1/auth/signup')
    .send({ name: 'Owner', email, password: PASSWORD, tenantName, industry: 'repair-shop' })
    .expect(202);
  await t.drain();
  await verify(t, t.email.lastTokenTo(email)).expect(204);
  return login(t, email);
}

const api = (s: LoggedIn) => ({
  get: (path: string) => withSession(request(t.server).get(path), s),
  post: (path: string, body: object) => withSession(request(t.server).post(path), s).send(body),
  del: (path: string) => withSession(request(t.server).delete(path), s),
});
const stage = (pipeline: Pipeline, key: string) => {
  const found = pipeline.stages.find((s) => s.key === key);
  if (!found) throw new Error(`no stage ${key}`);
  return found.id;
};
const errorsOf = (res: request.Response) =>
  (res.body as { errors?: { path: string; message: string }[] }).errors ?? [];
const repairFields = { imei_serial: '3569', device_brand: 'Apple', estimate_inr: 2500 };
const phone = () => `98${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
const newLead = async (s: LoggedIn, body: Record<string, unknown> = {}) =>
  (
    await api(s)
      .post('/v1/leads', { contact: { name: 'Asha', phone: phone() }, ...body })
      .expect(201)
  ).body as Lead;
const getLead = async (id: string) =>
  (await api(owner).get(`/v1/leads/${id}`).expect(200)).body as Lead;

/** Rows of this tenant, read as the test owner (RLS context set). */
const rows = <T extends object>(text: string, params: string[]) =>
  asTestOwner((sql) =>
    sql.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', ${tenantId}, true)`;
      return tx.unsafe<T[]>(text, params);
    }),
  );
const outbox = (type: string, leadId: string) =>
  rows<{ payload: Record<string, unknown> }>(
    'select payload from outbox_events where type = $1 and aggregate_id = $2',
    [type, leadId],
  );
const timeline = (type: string, leadId: string) =>
  rows<{ data: Record<string, unknown>; actor_id: string }>(
    'select data, actor_id from timeline_events where type = $1 and lead_id = $2',
    [type, leadId],
  );
const audits = (action: string, entityId: string) =>
  rows<{ after: Record<string, unknown>; before: Record<string, unknown> | null }>(
    'select after, before from audit_logs where action = $1 and entity_id = $2',
    [action, entityId],
  );
const summaries = (action: string) =>
  rows<{ after: Record<string, unknown>; entity: string; entity_id: string | null }>(
    'select after, entity, entity_id from audit_logs where action = $1',
    [action],
  );

beforeAll(async () => {
  t = await createTestApp();
  owner = await signupOwner('Fix It');
  tenantId = owner.body.tenant?.id ?? '';
  ownerId = owner.body.user.id;
  const as = async (role: Role) => {
    const member = await addMember(t, tenantId, role);
    return { session: await login(t, member.email), id: member.userId };
  };
  manager = (await as('manager')).session;
  const a = await as('agent');
  agent = a.session;
  agentId = a.id;
  disabledId = (await addMember(t, tenantId, 'agent', 'disabled')).userId;
  other = await signupOwner('Other Shop');
  const items = ((await api(owner).get('/v1/pipelines').expect(200)).body as PipelineList).items;
  inquiries = items.find((p) => p.key === 'inquiries') as Pipeline;
  repairs = items.find((p) => p.key === 'repair_jobs') as Pipeline;
});
afterAll(() => t.close());

describe('permissions and validation', () => {
  it('agents get 403 on both bulk endpoints (no lead.bulk), even for their own leads', async () => {
    const mine = await newLead(agent);
    await api(agent)
      .post('/v1/leads/bulk-assign', { leadIds: [mine.id], ownerUserId: agentId })
      .expect(403);
    await api(agent)
      .post('/v1/leads/bulk-stage', { leadIds: [mine.id], stageId: stage(inquiries, 'quoted') })
      .expect(403);
    expect((await getLead(mine.id)).stageId).toBe(stage(inquiries, 'new'));
  });

  it('rejects an empty selection, unknown fields and unknown stages', async () => {
    await api(owner).post('/v1/leads/bulk-assign', { leadIds: [], ownerUserId: null }).expect(400);
    const lead = await newLead(owner);
    await api(owner)
      .post('/v1/leads/bulk-assign', { leadIds: [lead.id], ownerUserId: null, extra: 1 })
      .expect(400);
    const res = await api(owner)
      .post('/v1/leads/bulk-stage', { leadIds: [lead.id], stageId: randomUUID() })
      .expect(400);
    expect(errorsOf(res)[0]?.path).toBe('stageId');
  });
});

describe('bulk assign', () => {
  it('manager: changed / unchanged / not found (deleted, cross-tenant, unknown); per-lead records + summary', async () => {
    const a = await newLead(owner);
    const b = await newLead(owner);
    const already = await newLead(owner, { ownerUserId: agentId });
    const deleted = await newLead(owner);
    await api(owner).del(`/v1/leads/${deleted.id}`).expect(204);
    const theirs = await newLead(other);
    const unknown = randomUUID();

    const res = await api(manager)
      .post('/v1/leads/bulk-assign', {
        leadIds: [a.id, already.id, deleted.id, b.id, theirs.id, unknown, a.id],
        ownerUserId: agentId,
      })
      .expect(200);
    expect(res.body as BulkLeadResult).toEqual({
      updatedIds: [a.id, b.id],
      unchangedIds: [already.id],
      notFoundIds: [deleted.id, theirs.id, unknown],
    });
    for (const lead of [a, b]) {
      expect((await getLead(lead.id)).owner?.id).toBe(agentId);
      const [entry, ...more] = await timeline('assignment', lead.id);
      expect(more).toHaveLength(0);
      expect(entry?.data).toMatchObject({
        fromOwner: { id: ownerId },
        owner: { id: agentId },
        bulk: true,
      });
      const [audit] = await audits('lead.assigned', lead.id);
      expect(audit?.after).toEqual({ ownerUserId: agentId, bulk: true });
      expect(audit?.before).toEqual({ ownerUserId: ownerId });
      const events = await outbox('lead.assigned.v1', lead.id);
      expect(events).toHaveLength(1);
      expect(events[0]?.payload).toMatchObject({ fromUserId: ownerId, toUserId: agentId });
    }
    // The no-op lead got nothing new (it was created with its owner: no assignment entry).
    expect(await timeline('assignment', already.id)).toHaveLength(0);
    expect(await audits('lead.assigned', already.id)).toHaveLength(0);
    expect(await outbox('lead.assigned.v1', already.id)).toHaveLength(0);
    // The other tenant's lead is untouched.
    expect(
      ((await api(other).get(`/v1/leads/${theirs.id}`).expect(200)).body as Lead).owner?.id,
    ).toBe(other.body.user.id);

    const summary = (await summaries('lead.bulk_assigned')).find((s) =>
      (s.after.leadIds as string[]).includes(a.id),
    );
    expect(summary).toEqual({
      entity: 'lead',
      entity_id: null,
      after: { count: 2, leadIds: [a.id, b.id], ownerUserId: agentId },
    });
  });

  it('null unassigns', async () => {
    const lead = await newLead(owner);
    const res = await api(owner)
      .post('/v1/leads/bulk-assign', { leadIds: [lead.id], ownerUserId: null })
      .expect(200);
    expect((res.body as BulkLeadResult).updatedIds).toEqual([lead.id]);
    expect((await getLead(lead.id)).owner).toBeNull();
    expect((await timeline('assignment', lead.id))[0]?.data).toMatchObject({
      owner: null,
      bulk: true,
    });
  });

  it('the owner must be an active member of this workspace (400, nothing changes)', async () => {
    const lead = await newLead(owner);
    for (const ownerUserId of [other.body.user.id, disabledId, randomUUID()]) {
      const res = await api(owner)
        .post('/v1/leads/bulk-assign', { leadIds: [lead.id], ownerUserId })
        .expect(400);
      expect(errorsOf(res)[0]?.path).toBe('ownerUserId');
    }
    expect((await getLead(lead.id)).owner?.id).toBe(ownerId);
    expect(await audits('lead.assigned', lead.id)).toHaveLength(0);
  });
});

describe('bulk stage move', () => {
  it('owner: moves, unchanged and not found; per-lead records + summary', async () => {
    const quoted = stage(inquiries, 'quoted');
    const a = await newLead(owner);
    const b = await newLead(owner);
    const already = await newLead(owner, { stageId: quoted });
    const theirs = await newLead(other);

    const res = await api(owner)
      .post('/v1/leads/bulk-stage', {
        leadIds: [a.id, b.id, already.id, theirs.id],
        stageId: quoted,
      })
      .expect(200);
    expect(res.body as BulkLeadResult).toEqual({
      updatedIds: [a.id, b.id],
      unchangedIds: [already.id],
      notFoundIds: [theirs.id],
    });
    for (const lead of [a, b]) {
      expect(await getLead(lead.id)).toMatchObject({ stageId: quoted, status: 'open' });
      const entries = await timeline('stage_changed', lead.id);
      expect(entries).toHaveLength(1);
      expect(entries[0]?.data).toMatchObject({
        fromStage: { id: stage(inquiries, 'new') },
        stage: { id: quoted },
        bulk: true,
      });
      expect(entries[0]?.data.pipeline).toBeUndefined();
      const [audit] = await audits('lead.stage_changed', lead.id);
      expect(audit?.after).toEqual({
        pipelineId: inquiries.id,
        stageId: quoted,
        status: 'open',
        bulk: true,
      });
      const events = await outbox('lead.stage_changed.v1', lead.id);
      expect(events).toHaveLength(1);
      expect(events[0]?.payload).toMatchObject({
        fromStageId: stage(inquiries, 'new'),
        toStageId: quoted,
        toPipelineId: inquiries.id,
      });
    }
    expect(await timeline('stage_changed', already.id)).toHaveLength(0);
    expect(await audits('lead.stage_changed', already.id)).toHaveLength(0);
    expect(await outbox('lead.stage_changed.v1', already.id)).toHaveLength(0);
    const summary = (await summaries('lead.bulk_stage_changed')).find((s) =>
      (s.after.leadIds as string[]).includes(a.id),
    );
    expect(summary).toEqual({
      entity: 'lead',
      entity_id: null,
      after: { count: 2, leadIds: [a.id, b.id], pipelineId: inquiries.id, stageId: quoted },
    });
  });

  it('manager may bulk move; lost needs a reason (400, nothing changes) and records it', async () => {
    const lost = stage(inquiries, 'lost');
    const a = await newLead(owner);
    const b = await newLead(agent);
    const res = await api(manager)
      .post('/v1/leads/bulk-stage', { leadIds: [a.id, b.id], stageId: lost })
      .expect(400);
    expect(errorsOf(res)[0]?.path).toBe('lostReason');
    expect((await getLead(a.id)).status).toBe('open');
    expect(await outbox('lead.stage_changed.v1', a.id)).toHaveLength(0);

    await api(manager)
      .post('/v1/leads/bulk-stage', {
        leadIds: [a.id, b.id],
        stageId: lost,
        lostReason: 'Quote too high',
      })
      .expect(200);
    for (const lead of [a, b]) {
      const now = await getLead(lead.id);
      expect(now).toMatchObject({ status: 'lost', lostReason: 'Quote too high' });
      expect(now.lostAt).not.toBeNull();
      expect((await timeline('stage_changed', lead.id))[0]?.data).toMatchObject({
        lostReason: 'Quote too high',
        bulk: true,
      });
    }
  });

  it('won → won keeps wonAt, open → won sets it; reopening clears it', async () => {
    const wonLead = await newLead(owner, {
      pipelineId: repairs.id,
      stageId: stage(repairs, 'delivered'),
      customFields: repairFields,
    });
    const wonAt = (await getLead(wonLead.id)).wonAt;
    expect(wonAt).not.toBeNull();
    const openLead = await newLead(owner);
    t.clock.advance(60_000);
    const target = stage(inquiries, 'device_received');
    await api(owner)
      .post('/v1/leads/bulk-stage', {
        leadIds: [wonLead.id, openLead.id],
        pipelineId: inquiries.id,
        stageId: target,
      })
      .expect(200);
    expect(await getLead(wonLead.id)).toMatchObject({ status: 'won', stageId: target, wonAt });
    const nowWon = await getLead(openLead.id);
    expect(nowWon.status).toBe('won');
    expect(nowWon.wonAt).not.toBeNull();
    expect(nowWon.wonAt).not.toBe(wonAt);
    await api(owner)
      .post('/v1/leads/bulk-stage', { leadIds: [wonLead.id], stageId: stage(inquiries, 'new') })
      .expect(200);
    expect(await getLead(wonLead.id)).toMatchObject({ status: 'open', wonAt: null });
  });

  it('pipeline mismatch: without pipelineId every lead must be in the stage’s pipeline', async () => {
    const inInquiries = await newLead(owner);
    const inRepairs = await newLead(owner, { pipelineId: repairs.id, customFields: repairFields });
    const target = stage(inquiries, 'quoted');
    const res = await api(owner)
      .post('/v1/leads/bulk-stage', { leadIds: [inInquiries.id, inRepairs.id], stageId: target })
      .expect(400);
    expect(errorsOf(res)[0]?.path).toBe('leadIds');
    expect((await getLead(inInquiries.id)).stageId).toBe(stage(inquiries, 'new'));

    // A stage not of the given pipeline is rejected.
    await api(owner)
      .post('/v1/leads/bulk-stage', {
        leadIds: [inInquiries.id],
        pipelineId: repairs.id,
        stageId: target,
      })
      .expect(400);

    // With pipelineId, both move into it (the repairs lead changes pipeline).
    await api(owner)
      .post('/v1/leads/bulk-stage', {
        leadIds: [inInquiries.id, inRepairs.id],
        pipelineId: inquiries.id,
        stageId: target,
      })
      .expect(200);
    expect(await getLead(inRepairs.id)).toMatchObject({
      pipelineId: inquiries.id,
      stageId: target,
    });
    expect((await timeline('stage_changed', inRepairs.id))[0]?.data).toMatchObject({
      fromPipeline: { id: repairs.id, name: repairs.name },
      pipeline: { id: inquiries.id, name: inquiries.name },
      bulk: true,
    });
  });

  it('another tenant’s pipeline / stage is a 400', async () => {
    const lead = await newLead(owner);
    const theirs = ((await api(other).get('/v1/pipelines').expect(200)).body as PipelineList)
      .items[0] as Pipeline;
    await api(owner)
      .post('/v1/leads/bulk-stage', {
        leadIds: [lead.id],
        pipelineId: theirs.id,
        stageId: theirs.stages[0]?.id,
      })
      .expect(400);
    await api(owner)
      .post('/v1/leads/bulk-stage', { leadIds: [lead.id], stageId: theirs.stages[0]?.id })
      .expect(400);
  });
});
