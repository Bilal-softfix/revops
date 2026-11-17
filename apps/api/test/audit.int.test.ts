import type { BulkLeadResult, Contact, Lead, Pipeline, PipelineList, Role } from '@revops/shared';
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

// M1-T6 AC: assignment, stage change, delete and bulk actions are all audited — one row per
// change with actor + before/after, nothing for no-ops or refused requests, and no PII.
let t: TestApp;
let owner: LoggedIn;
let manager: LoggedIn;
let agent: LoggedIn;
let tenantId: string;
let ownerId: string;
let managerId: string;
let agentId: string;
let inquiries: Pipeline;
let repairs: Pipeline;

interface AuditRow {
  actor_type: string;
  actor_id: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ip: string | null;
}

const api = (s: LoggedIn) => ({
  get: (path: string) => withSession(request(t.server).get(path), s),
  post: (path: string, body: object) => withSession(request(t.server).post(path), s).send(body),
  patch: (path: string, body: object) => withSession(request(t.server).patch(path), s).send(body),
  del: (path: string) => withSession(request(t.server).delete(path), s),
});
const stage = (pipeline: Pipeline, key: string) => {
  const found = pipeline.stages.find((s) => s.key === key);
  if (!found) throw new Error(`no stage ${key}`);
  return found.id;
};
const phone = () => `98${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
const createLead = async (s: LoggedIn, body: Record<string, unknown> = {}) =>
  (
    await api(s)
      .post('/v1/leads', { contact: { name: 'Asha Verma', phone: phone() }, ...body })
      .expect(201)
  ).body as Lead;

/** Audit rows of this tenant, oldest first, optionally narrowed. */
const audits = (where: { action?: string; entityId?: string } = {}) =>
  asTestOwner((sql) =>
    sql.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', ${tenantId}, true)`;
      return tx<AuditRow[]>`
        select actor_type, actor_id, action, entity, entity_id, before, after, host(ip) as ip
        from audit_logs
        where (${where.action ?? null}::text is null or action = ${where.action ?? null})
          and (${where.entityId ?? null}::text is null or entity_id = ${where.entityId ?? null})
        order by created_at, id`;
    }),
  );

beforeAll(async () => {
  t = await createTestApp();
  const email = uniqueEmail('owner');
  await request(t.server)
    .post('/v1/auth/signup')
    .send({ name: 'Owner', email, password: PASSWORD, tenantName: 'Audit Shop', industry: 'repair-shop' })
    .expect(202);
  await t.drain();
  await verify(t, t.email.lastTokenTo(email)).expect(204);
  owner = await login(t, email);
  tenantId = owner.body.tenant?.id ?? '';
  ownerId = owner.body.user?.id ?? '';
  const as = async (role: Role) => {
    const member = await addMember(t, tenantId, role);
    return { session: await login(t, member.email), id: member.userId };
  };
  ({ session: manager, id: managerId } = await as('manager'));
  ({ session: agent, id: agentId } = await as('agent'));
  const items = ((await api(owner).get('/v1/pipelines').expect(200)).body as PipelineList).items;
  inquiries = items.find((p) => p.key === 'inquiries') as Pipeline;
  repairs = items.find((p) => p.key === 'repair_jobs') as Pipeline;
});
afterAll(() => t.close());

describe('single-lead actions', () => {
  it('assignment: lead.assigned with before/after owner and the acting user', async () => {
    const lead = await createLead(owner);
    await api(manager).patch(`/v1/leads/${lead.id}`, { ownerUserId: agentId }).expect(200);

    const rows = await audits({ action: 'lead.assigned', entityId: lead.id });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor_type: 'user',
      actor_id: managerId,
      entity: 'lead',
      before: { ownerUserId: ownerId },
      after: { ownerUserId: agentId },
    });
    expect(rows[0]?.ip).toBeTruthy();
  });

  it('assigning to the current owner is not an assignment (no lead.assigned row)', async () => {
    const lead = await createLead(owner);
    await api(owner).patch(`/v1/leads/${lead.id}`, { ownerUserId: ownerId }).expect(200);
    expect(await audits({ action: 'lead.assigned', entityId: lead.id })).toHaveLength(0);
  });

  it('a refused assignment (agent) writes nothing', async () => {
    const lead = await createLead(agent);
    const before = await audits({ entityId: lead.id });
    await api(agent).patch(`/v1/leads/${lead.id}`, { ownerUserId: managerId }).expect(403);
    expect(await audits({ entityId: lead.id })).toEqual(before);
  });

  it('stage change: lead.stage_changed with from/to stage, pipeline and status', async () => {
    const lead = await createLead(agent);
    await api(agent)
      .post(`/v1/leads/${lead.id}/stage`, { stageId: stage(inquiries, 'quoted') })
      .expect(200);
    await api(agent)
      .post(`/v1/leads/${lead.id}/stage`, {
        pipelineId: repairs.id,
        stageId: stage(repairs, 'cancelled'),
        lostReason: 'Too expensive',
      })
      .expect(200);

    const rows = await audits({ action: 'lead.stage_changed', entityId: lead.id });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      actor_id: agentId,
      before: { pipelineId: inquiries.id, stageId: stage(inquiries, 'new'), status: 'open' },
      after: { pipelineId: inquiries.id, stageId: stage(inquiries, 'quoted'), status: 'open' },
    });
    expect(rows[1]).toMatchObject({
      before: { pipelineId: inquiries.id, stageId: stage(inquiries, 'quoted') },
      after: {
        pipelineId: repairs.id,
        stageId: stage(repairs, 'cancelled'),
        status: 'lost',
        lostReason: 'Too expensive',
      },
    });
  });

  it('a no-op stage change writes nothing', async () => {
    const lead = await createLead(agent);
    await api(agent).post(`/v1/leads/${lead.id}/stage`, { stageId: lead.stageId }).expect(200);
    expect(await audits({ action: 'lead.stage_changed', entityId: lead.id })).toHaveLength(0);
  });

  it('delete: lead.deleted by the deleting user; agents are refused with no row', async () => {
    const lead = await createLead(agent);
    await api(agent).del(`/v1/leads/${lead.id}`).expect(403);
    expect(await audits({ action: 'lead.deleted', entityId: lead.id })).toHaveLength(0);

    await api(manager).del(`/v1/leads/${lead.id}`).expect(204);
    const rows = await audits({ action: 'lead.deleted', entityId: lead.id });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor_id: managerId, entity: 'lead' });
  });

  it('contact delete is audited', async () => {
    const contact = (
      await api(owner).post('/v1/contacts', { name: 'Ravi', phone: phone() }).expect(201)
    ).body as Contact;
    await api(owner).del(`/v1/contacts/${contact.id}`).expect(204);
    expect(await audits({ action: 'contact.deleted', entityId: contact.id })).toHaveLength(1);
  });

  it('a stage delete that moves leads: one structural audit row, no per-lead stage rows', async () => {
    const created = (
      await api(owner)
        .post(`/v1/pipelines/${inquiries.id}/stages`, { name: 'Temp', category: 'open' })
        .expect(201)
    ).body as Pipeline;
    const temp = created.stages.find((s) => s.name === 'Temp')?.id ?? '';
    const leads = [
      await createLead(owner, { stageId: temp }),
      await createLead(owner, { stageId: temp }),
    ];
    const target = stage(inquiries, 'new');
    await api(owner).del(`/v1/pipelines/${inquiries.id}/stages/${temp}?moveTo=${target}`).expect(200);

    const structural = await audits({ action: 'pipeline_stage.deleted', entityId: temp });
    expect(structural).toHaveLength(1);
    expect(structural[0]?.after).toMatchObject({ movedLeads: 2, movedTo: target });
    for (const lead of leads) {
      expect(await audits({ action: 'lead.stage_changed', entityId: lead.id })).toHaveLength(0);
    }
  });
});

describe('bulk actions', () => {
  it('bulk assign: one lead.assigned per changed lead (bulk) + one summary row', async () => {
    const changed = [await createLead(owner), await createLead(owner)];
    const already = await createLead(owner, { ownerUserId: agentId });
    const res = await api(manager)
      .post('/v1/leads/bulk-assign', {
        leadIds: [...changed.map((l) => l.id), already.id],
        ownerUserId: agentId,
      })
      .expect(200);
    const result = res.body as BulkLeadResult;
    expect(new Set(result.updatedIds)).toEqual(new Set(changed.map((l) => l.id)));
    expect(result.unchangedIds).toEqual([already.id]);

    for (const lead of changed) {
      const rows = await audits({ action: 'lead.assigned', entityId: lead.id });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        actor_id: managerId,
        before: { ownerUserId: ownerId },
        after: { ownerUserId: agentId, bulk: true },
      });
    }
    expect(await audits({ action: 'lead.assigned', entityId: already.id })).toHaveLength(0);

    const summary = (await audits({ action: 'lead.bulk_assigned' })).filter(
      (r) => r.actor_id === managerId,
    );
    expect(summary).toHaveLength(1);
    expect(summary[0]?.after).toMatchObject({ count: 2, ownerUserId: agentId });
    expect(new Set(summary[0]?.after?.leadIds as string[])).toEqual(
      new Set(changed.map((l) => l.id)),
    );
  });

  it('bulk stage move: one lead.stage_changed per changed lead (bulk) + one summary row', async () => {
    const leads = [await createLead(owner), await createLead(owner)];
    const before = (await audits({ action: 'lead.bulk_stage_changed' })).length;
    await api(owner)
      .post('/v1/leads/bulk-stage', {
        leadIds: leads.map((l) => l.id),
        stageId: stage(inquiries, 'quoted'),
      })
      .expect(200);

    for (const lead of leads) {
      const rows = await audits({ action: 'lead.stage_changed', entityId: lead.id });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        actor_id: ownerId,
        before: { stageId: stage(inquiries, 'new') },
        after: { stageId: stage(inquiries, 'quoted'), bulk: true },
      });
    }
    const summary = await audits({ action: 'lead.bulk_stage_changed' });
    expect(summary).toHaveLength(before + 1);
    expect(summary.at(-1)?.after).toMatchObject({ count: 2, stageId: stage(inquiries, 'quoted') });
  });

  it('agents can’t run bulk actions, and a refused bulk request writes nothing', async () => {
    const lead = await createLead(agent);
    const count = (await audits()).length;
    await api(agent)
      .post('/v1/leads/bulk-assign', { leadIds: [lead.id], ownerUserId: agentId })
      .expect(403);
    await api(agent)
      .post('/v1/leads/bulk-stage', { leadIds: [lead.id], stageId: stage(inquiries, 'quoted') })
      .expect(403);
    expect(await audits()).toHaveLength(count);
  });
});

describe('audit rows hold no PII', () => {
  it('no contact name, phone or email in any lead/contact audit row', async () => {
    const number = phone();
    const lead = await createLead(owner, {
      contact: { name: 'Zeenat Qureshi', phone: number, email: 'zeenat@example.com' },
    });
    await api(owner).patch(`/v1/leads/${lead.id}`, { ownerUserId: agentId }).expect(200);
    await api(owner).del(`/v1/leads/${lead.id}`).expect(204);
    const dump = JSON.stringify(await audits());
    expect(dump).not.toContain('Zeenat');
    expect(dump).not.toContain(number);
    expect(dump).not.toContain('zeenat@example.com');
  });
});
