import type { DashboardSummary, Lead, LeadSourceList } from '@revops/shared';
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

// UI refresh: GET /v1/dashboard/summary — role-aware counts, by source, recent leads, my tasks.
let t: TestApp;
let owner: LoggedIn;
let agent: LoggedIn;
let agentId: string;
let tenantId: string;
let sources: LeadSourceList['items'];

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
});
const phone = () => `96${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
const summary = async (s: LoggedIn) =>
  (await api(s).get('/v1/dashboard/summary').expect(200)).body as DashboardSummary;
const createLead = async (s: LoggedIn, body: Record<string, unknown> = {}) =>
  (
    await api(s)
      .post('/v1/leads', { contact: { name: `Lead ${phone()}`, phone: phone() }, ...body })
      .expect(201)
  ).body as Lead;
/** Moves a lead's creation (and optionally its won date) into the past, as the owner. */
const backdate = (leadId: string, days: number, won = false) =>
  asTestOwner((sql) =>
    sql.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', ${tenantId}, true)`;
      await tx`update leads set created_at = now() - make_interval(days => ${days}),
        status = case when ${won} then 'won'::stage_category else status end,
        won_at = case when ${won} then now() - make_interval(days => ${days}) else won_at end
        where id = ${leadId}`;
    }),
  );

beforeAll(async () => {
  t = await createTestApp();
  owner = await signupOwner('Dash Co');
  tenantId = owner.body.tenant?.id ?? '';
  const member = await addMember(t, tenantId, 'agent');
  agentId = member.userId;
  agent = await login(t, member.email);
  sources = ((await api(owner).get('/v1/lead-sources').expect(200)).body as LeadSourceList).items;
});
afterAll(() => t.close());

describe('GET /v1/dashboard/summary', () => {
  it('an empty workspace: all zeros, nothing listed', async () => {
    expect(await summary(owner)).toEqual({
      scope: 'all',
      newLeads: { today: 0, last7Days: 0 },
      openLeads: 0,
      wonLast30Days: 0,
      totalLeads: 0,
      tasks: { overdue: 0, today: 0 },
      bySource: [],
      recentLeads: [],
    });
  });

  it('counts by window, by source and status; agents see only their own leads', async () => {
    const [a, b] = sources;
    const today1 = await createLead(owner, { sourceId: a?.id });
    await createLead(owner, { sourceId: a?.id });
    const threeDays = await createLead(owner, { sourceId: b?.id });
    const tenDays = await createLead(owner, { sourceId: null });
    const old = await createLead(owner, { sourceId: a?.id });
    const wonRecently = await createLead(owner, { sourceId: b?.id });
    const agentsLead = await createLead(owner, { sourceId: b?.id, ownerUserId: agentId });
    await backdate(threeDays.id, 3);
    await backdate(tenDays.id, 10);
    await backdate(old.id, 45);
    await backdate(wonRecently.id, 5, true);

    const all = await summary(owner);
    expect(all).toMatchObject({
      scope: 'all',
      totalLeads: 7,
      newLeads: { today: 3, last7Days: 5 }, // today1, +1, agentsLead | +threeDays, wonRecently
      openLeads: 6,
      wonLast30Days: 1,
    });
    // Last 30 days: a ×2, b ×3, no source ×1 (the 45-day-old lead is outside).
    expect(all.bySource.map((r) => [r.name, r.count])).toEqual([
      [b?.name, 3],
      [a?.name, 2],
      [null, 1],
    ]);
    expect(all.recentLeads).toHaveLength(5);
    expect(all.recentLeads[0]).toMatchObject({ status: 'open' });
    expect(all.recentLeads.map((r) => r.id)).toContain(today1.id);
    expect(all.recentLeads.map((r) => r.id)).not.toContain(old.id);

    const mine = await summary(agent);
    expect(mine).toMatchObject({
      scope: 'mine',
      totalLeads: 1,
      newLeads: { today: 1, last7Days: 1 },
      openLeads: 1,
      wonLast30Days: 0,
    });
    expect(mine.recentLeads.map((r) => r.id)).toEqual([agentsLead.id]);
    expect(mine.bySource).toEqual([{ sourceId: b?.id, name: b?.name, count: 1, other: false }]);
  });

  it('task counts are the caller’s own open tasks: overdue and due today', async () => {
    const lead = await createLead(owner);
    const at = (ms: number) => new Date(t.clock.now().getTime() + ms).toISOString();
    await api(owner)
      .post(`/v1/leads/${lead.id}/tasks`, { title: 'Late', dueAt: at(3600_000) })
      .expect(201);
    t.clock.advance(2 * 3600_000); // now overdue
    await api(owner)
      .post(`/v1/leads/${lead.id}/tasks`, { title: 'Soon', dueAt: at(60_000) })
      .expect(201);
    const s = await summary(owner);
    expect(s.tasks.overdue).toBe(1);
    expect(s.tasks.today).toBeLessThanOrEqual(1); // 0 only if the test runs within 1 min of midnight
    expect((await summary(agent)).tasks).toEqual({ overdue: 0, today: 0 });
  });

  it('never counts another workspace’s leads', async () => {
    const other = await signupOwner('Other Dash Co');
    await createLead(other);
    expect((await summary(other)).totalLeads).toBe(1);
    expect((await summary(owner)).totalLeads).toBe(8);
  });

  it('needs a session', async () => {
    await request(t.server).get('/v1/dashboard/summary').expect(401);
  });
});
