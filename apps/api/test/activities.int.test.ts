import {
  DEFAULT_TIMEZONE,
  type Lead,
  type Note,
  type Pipeline,
  type PipelineList,
  type Role,
  type Task,
  type TaskCounts,
  type TaskList,
  type TaskPage,
  type TimelineItem,
  type TimelinePage,
  dayBounds,
} from '@revops/shared';
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

// M1-T5: notes, tasks ("My tasks"), and the lead timeline (ordered, paginated, with actor).
let t: TestApp;
let owner: LoggedIn;
let manager: LoggedIn;
let agent: LoggedIn;
let agent2: LoggedIn;
let other: LoggedIn;
let tenantId: string;
let agentId: string;
let agent2Id: string;
let managerId: string;
let inquiries: Pipeline;

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
  get: (path: string, query: Record<string, string> = {}) =>
    withSession(request(t.server).get(path), s).query(query),
  post: (path: string, body: object) => withSession(request(t.server).post(path), s).send(body),
  patch: (path: string, body: object) => withSession(request(t.server).patch(path), s).send(body),
  del: (path: string) => withSession(request(t.server).delete(path), s),
});
const phone = () => `97${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
const createLead = async (s: LoggedIn, body: Record<string, unknown> = {}) =>
  (
    await api(s)
      .post('/v1/leads', { contact: { name: 'Kiran', phone: phone() }, ...body })
      .expect(201)
  ).body as Lead;
const stageId = (key: string) => inquiries.stages.find((s) => s.key === key)?.id ?? '';
const timeline = async (s: LoggedIn, leadId: string, query: Record<string, string> = {}) =>
  (await api(s).get(`/v1/leads/${leadId}/timeline`, query).expect(200)).body as TimelinePage;
const allTimeline = async (s: LoggedIn, leadId: string, limit = '2') => {
  const items: TimelineItem[] = [];
  let cursor: string | null = null;
  do {
    const page: TimelinePage = await timeline(s, leadId, {
      limit,
      ...(cursor ? { cursor } : {}),
    });
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
};
const isoIn = (ms: number) => new Date(t.clock.now().getTime() + ms).toISOString();
const HOUR = 3_600_000;
const outboxCount = (type: string, leadId: string) =>
  asTestOwner((sql) =>
    sql.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', ${tenantId}, true)`;
      const [row] = await tx<{ n: number }[]>`
        select count(*)::int as n from outbox_events where type = ${type} and aggregate_id = ${leadId}`;
      return row?.n ?? 0;
    }),
  );

beforeAll(async () => {
  t = await createTestApp();
  owner = await signupOwner('Notes Co');
  tenantId = owner.body.tenant?.id ?? '';
  const as = async (role: Role) => {
    const member = await addMember(t, tenantId, role);
    return { session: await login(t, member.email), id: member.userId };
  };
  const m = await as('manager');
  manager = m.session;
  managerId = m.id;
  const a1 = await as('agent');
  agent = a1.session;
  agentId = a1.id;
  const a2 = await as('agent');
  agent2 = a2.session;
  agent2Id = a2.id;
  other = await signupOwner('Other Co');
  const items = ((await api(owner).get('/v1/pipelines').expect(200)).body as PipelineList).items;
  inquiries = items.find((p) => p.key === 'inquiries') as Pipeline;
});
afterAll(() => t.close());

describe('timeline', () => {
  it('AC: records create, assignment, stage change, note and task completion — newest first, with actor', async () => {
    const lead = await createLead(manager, { ownerUserId: agentId });
    t.clock.advance(1000);
    await api(manager).patch(`/v1/leads/${lead.id}`, { ownerUserId: agent2Id }).expect(200);
    t.clock.advance(1000);
    await api(agent2)
      .post(`/v1/leads/${lead.id}/stage`, { stageId: stageId('quoted') })
      .expect(200);
    t.clock.advance(1000);
    const note = (
      await api(agent2)
        .post(`/v1/leads/${lead.id}/notes`, { body: 'Wants a quote by Friday' })
        .expect(201)
    ).body as Note;
    t.clock.advance(1000);
    const task = (
      await api(agent2)
        .post(`/v1/leads/${lead.id}/tasks`, { title: 'Send quote', dueAt: isoIn(HOUR) })
        .expect(201)
    ).body as Task;
    await api(agent2).patch(`/v1/tasks/${task.id}`, { status: 'done' }).expect(200);

    const items = await allTimeline(agent2, lead.id);
    expect(items.map((i) => i.type)).toEqual([
      'task',
      'note',
      'stage_changed',
      'assignment',
      'created',
    ]);
    const [done, noted, moved, assigned, created] = items;
    expect(done).toMatchObject({
      actor: { type: 'user', user: { id: agent2Id, name: 'agent user' } },
      data: { action: 'completed', title: 'Send quote', taskType: 'followup' },
    });
    expect(noted?.note).toMatchObject({ id: note.id, body: 'Wants a quote by Friday' });
    expect(moved?.data).toMatchObject({
      fromStage: { id: stageId('new') },
      stage: { id: stageId('quoted') },
    });
    expect(moved?.data.fromStage?.name).toBeTruthy();
    expect(assigned).toMatchObject({
      actor: { type: 'user', user: { id: managerId } },
      data: { fromOwner: { id: agentId }, owner: { id: agent2Id } },
    });
    expect(created?.data).toMatchObject({
      pipeline: { id: inquiries.id, name: inquiries.name },
      stage: { id: stageId('new') },
      owner: { id: agentId },
    });
    // Strictly newest first.
    const times = items.map((i) => Date.parse(i.occurredAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('AC: paginates with a cursor (each entry exactly once, in order; ties keep write order)', async () => {
    const lead = await createLead(agent);
    // Same instant for every note: order falls back to write order.
    for (let i = 1; i <= 5; i += 1) {
      await api(agent)
        .post(`/v1/leads/${lead.id}/notes`, { body: `note ${i}` })
        .expect(201);
    }
    const first = await timeline(agent, lead.id, { limit: '2' });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const all = await allTimeline(agent, lead.id, '2');
    expect(all.map((i) => i.note?.body ?? i.type)).toEqual([
      'note 5',
      'note 4',
      'note 3',
      'note 2',
      'note 1',
      'created',
    ]);
    expect(new Set(all.map((i) => i.id)).size).toBe(6);
    expect((await timeline(agent, lead.id, { limit: '6' })).nextCursor).toBeNull();
  });

  it('AC: shows system / ai actors without a user', async () => {
    const lead = await createLead(agent);
    await asTestOwner((sql) =>
      sql.begin(async (tx) => {
        await tx`select set_config('app.tenant_id', ${tenantId}, true)`;
        const occurred = new Date(t.clock.now().getTime() + 60_000);
        for (const actor of ['system', 'ai']) {
          await tx`insert into timeline_events
            (tenant_id, lead_id, contact_id, type, actor_type, summary, occurred_at)
            values (${tenantId}, ${lead.id}, ${lead.contact.id}, 'qualification', ${actor},
                    ${`by ${actor}`}, ${occurred})`;
        }
      }),
    );
    const [ai, system] = (await timeline(agent, lead.id)).items;
    expect(ai).toMatchObject({ actor: { type: 'ai', user: null }, summary: 'by ai' });
    expect(system).toMatchObject({ actor: { type: 'system', user: null }, summary: 'by system' });
  });

  it('Dev AC: deleting a stage writes "stage changed because <stage> was deleted" per moved lead, no event', async () => {
    const path = `/v1/pipelines/${inquiries.id}/stages`;
    const temp = (
      (await api(owner).post(path, { name: 'Temp stage', category: 'open' }).expect(201))
        .body as Pipeline
    ).stages.find((s) => s.name === 'Temp stage');
    const leads = [
      await createLead(agent, { stageId: temp?.id }),
      await createLead(agent, { stageId: temp?.id }),
    ];
    await api(owner)
      .del(`${path}/${temp?.id}?moveTo=${stageId('new')}`)
      .expect(200);
    for (const lead of leads) {
      const [entry] = (await timeline(agent, lead.id)).items;
      expect(entry).toMatchObject({
        type: 'stage_changed',
        actor: { type: 'user' },
        data: {
          reason: 'stage_deleted',
          fromStage: { id: temp?.id, name: 'Temp stage' },
          stage: { id: stageId('new') },
        },
      });
      expect(await outboxCount('lead.stage_changed.v1', lead.id)).toBe(0);
    }
  });

  it('follows lead visibility and tenant isolation', async () => {
    const lead = await createLead(agent2);
    await api(agent).get(`/v1/leads/${lead.id}/timeline`).expect(404);
    await api(other).get(`/v1/leads/${lead.id}/timeline`).expect(404);
    await api(manager).get(`/v1/leads/${lead.id}/timeline`).expect(200);
  });
});

describe('notes', () => {
  it('the author edits; others can’t; the author or a manager deletes; deleted notes leave the timeline', async () => {
    const lead = await createLead(agent);
    const note = (
      await api(agent).post(`/v1/leads/${lead.id}/notes`, { body: 'first' }).expect(201)
    ).body as Note;
    expect(note).toMatchObject({ author: { id: agentId }, editedAt: null });

    await api(manager).patch(`/v1/notes/${note.id}`, { body: 'hijack' }).expect(403);
    const edited = (await api(agent).patch(`/v1/notes/${note.id}`, { body: 'second' }).expect(200))
      .body as Note;
    expect(edited.body).toBe('second');
    expect(edited.editedAt).not.toBeNull();
    expect((await timeline(agent, lead.id)).items[0]?.note?.body).toBe('second');

    // Another agent can't even see it (not their lead).
    await api(agent2).patch(`/v1/notes/${note.id}`, { body: 'x' }).expect(404);
    await api(agent2).del(`/v1/notes/${note.id}`).expect(404);
    await api(agent2).post(`/v1/leads/${lead.id}/notes`, { body: 'x' }).expect(404);
    await api(other).del(`/v1/notes/${note.id}`).expect(404);

    const managersNote = (
      await api(manager).post(`/v1/leads/${lead.id}/notes`, { body: 'manager' }).expect(201)
    ).body as Note;
    await api(agent).del(`/v1/notes/${managersNote.id}`).expect(403);
    await api(manager).del(`/v1/notes/${note.id}`).expect(204);
    expect((await timeline(agent, lead.id)).items.map((i) => i.note?.body ?? i.type)).toEqual([
      'manager',
      'created',
    ]);
    await api(agent).patch(`/v1/notes/${note.id}`, { body: 'gone' }).expect(404);
  });

  it('validates the body and keeps it out of the audit log', async () => {
    const lead = await createLead(agent);
    await api(agent).post(`/v1/leads/${lead.id}/notes`, { body: '   ' }).expect(400);
    await api(agent)
      .post(`/v1/leads/${lead.id}/notes`, { body: 'x'.repeat(10_001) })
      .expect(400);
    const note = (
      await api(agent).post(`/v1/leads/${lead.id}/notes`, { body: 'secret-ish text' }).expect(201)
    ).body as Note;
    const audits = await asTestOwner((sql) =>
      sql.begin(async (tx) => {
        await tx`select set_config('app.tenant_id', ${tenantId}, true)`;
        return tx<{ after: unknown }[]>`select after from audit_logs where entity_id = ${note.id}`;
      }),
    );
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits)).not.toContain('secret-ish');
  });
});

describe('tasks', () => {
  it('assignee rules: self by default; others need lead.assign and must see the lead', async () => {
    const lead = await createLead(agent);
    const mine = (
      await api(agent)
        .post(`/v1/leads/${lead.id}/tasks`, { title: 'Call', type: 'call', dueAt: isoIn(HOUR) })
        .expect(201)
    ).body as Task;
    expect(mine).toMatchObject({
      assignee: { id: agentId },
      type: 'call',
      status: 'open',
      lead: { id: lead.id, contactName: 'Kiran' },
    });
    await api(agent)
      .post(`/v1/leads/${lead.id}/tasks`, {
        title: 'x',
        dueAt: isoIn(HOUR),
        assigneeUserId: managerId,
      })
      .expect(403);
    await api(agent).patch(`/v1/tasks/${mine.id}`, { assigneeUserId: managerId }).expect(403);
    // agent2 doesn't own the lead → can't be given a task on it.
    const blind = await api(manager)
      .post(`/v1/leads/${lead.id}/tasks`, {
        title: 'x',
        dueAt: isoIn(HOUR),
        assigneeUserId: agent2Id,
      })
      .expect(400);
    expect(blind.body).toMatchObject({ errors: [{ path: 'assigneeUserId' }] });
    await api(manager)
      .post(`/v1/leads/${lead.id}/tasks`, {
        title: 'x',
        dueAt: isoIn(HOUR),
        assigneeUserId: other.body.user.id,
      })
      .expect(400);
    const forAgent = (
      await api(manager)
        .post(`/v1/leads/${lead.id}/tasks`, {
          title: 'Visit',
          dueAt: isoIn(HOUR),
          assigneeUserId: agentId,
        })
        .expect(201)
    ).body as Task;
    expect(forAgent.assignee?.id).toBe(agentId);
    const reassigned = (
      await api(manager)
        .patch(`/v1/tasks/${forAgent.id}`, { assigneeUserId: managerId })
        .expect(200)
    ).body as Task;
    expect(reassigned.assignee?.id).toBe(managerId);
  });

  it('complete / reopen write timeline entries; the lead lists open tasks first by due date', async () => {
    const lead = await createLead(agent);
    const make = async (title: string, ms: number) =>
      (
        (
          await api(agent)
            .post(`/v1/leads/${lead.id}/tasks`, { title, dueAt: isoIn(ms) })
            .expect(201)
        ).body as Task
      ).id;
    const later = await make('later', 3 * HOUR);
    const sooner = await make('sooner', HOUR);
    const done = await make('done', 2 * HOUR);
    const completed = (await api(agent).patch(`/v1/tasks/${done}`, { status: 'done' }).expect(200))
      .body as Task;
    expect(completed.completedAt).not.toBeNull();
    // Completing twice is a no-op (no second entry).
    await api(agent).patch(`/v1/tasks/${done}`, { status: 'done' }).expect(200);
    const list = (await api(agent).get(`/v1/leads/${lead.id}/tasks`).expect(200)).body as TaskList;
    expect(list.items.map((x) => x.id)).toEqual([sooner, later, done]);

    t.clock.advance(1000);
    const reopened = (await api(agent).patch(`/v1/tasks/${done}`, { status: 'open' }).expect(200))
      .body as Task;
    expect(reopened.completedAt).toBeNull();
    const entries = (await timeline(agent, lead.id)).items.filter((i) => i.type === 'task');
    expect(entries.map((e) => e.data.action)).toEqual(['reopened', 'completed']);

    await api(agent).del(`/v1/tasks/${later}`).expect(204);
    await api(agent).patch(`/v1/tasks/${later}`, { status: 'done' }).expect(404);
    await api(agent2).get(`/v1/leads/${lead.id}/tasks`).expect(404);
    await api(agent2).patch(`/v1/tasks/${sooner}`, { title: 'x' }).expect(404);
    await api(other).del(`/v1/tasks/${sooner}`).expect(404);
  });

  it('My tasks: overdue / today / upcoming in IST, only mine, only open, only leads I can see', async () => {
    const me = await signupOwner('Bucket Co'); // fresh tenant: counts start at zero
    const lead = await createLead(me);
    const now = t.clock.now();
    const { startOfTomorrow } = dayBounds(now, DEFAULT_TIMEZONE);
    const untilTomorrow = startOfTomorrow.getTime() - now.getTime();
    const add = async (title: string, dueAt: string) =>
      (
        (await api(me).post(`/v1/leads/${lead.id}/tasks`, { title, dueAt }).expect(201))
          .body as Task
      ).id;
    const overdue = await add('overdue', isoIn(-HOUR));
    const today = await add('today', isoIn(Math.floor(untilTomorrow / 2)));
    const upcoming = await add('upcoming', isoIn(untilTomorrow + HOUR));
    const finished = await add('finished', isoIn(-2 * HOUR));
    await api(me).patch(`/v1/tasks/${finished}`, { status: 'done' }).expect(200);

    const bucket = async (name: string) =>
      ((await api(me).get('/v1/tasks', { bucket: name }).expect(200)).body as TaskPage).items.map(
        (x) => x.id,
      );
    expect(await bucket('overdue')).toEqual([overdue]);
    expect(await bucket('today')).toEqual([today]);
    expect(await bucket('upcoming')).toEqual([upcoming]);
    expect((await api(me).get('/v1/tasks/counts').expect(200)).body as TaskCounts).toEqual({
      overdue: 1,
      today: 1,
      upcoming: 1,
    });
    await api(me).get('/v1/tasks', { bucket: 'someday' }).expect(400);
  });

  it('My tasks pages with a cursor and drops tasks on leads the agent no longer sees', async () => {
    const lead = await createLead(agent2);
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      ids.push(
        (
          (
            await api(agent2)
              .post(`/v1/leads/${lead.id}/tasks`, { title: `t${i}`, dueAt: isoIn(-(3 - i) * HOUR) })
              .expect(201)
          ).body as Task
        ).id,
      );
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: TaskPage = (
        await api(agent2)
          .get('/v1/tasks', { bucket: 'overdue', limit: '2', ...(cursor ? { cursor } : {}) })
          .expect(200)
      ).body as TaskPage;
      seen.push(...page.items.map((x) => x.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen.filter((id) => ids.includes(id))).toEqual(ids);

    await api(manager).patch(`/v1/leads/${lead.id}`, { ownerUserId: agentId }).expect(200);
    const after = (
      await api(agent2).get('/v1/tasks', { bucket: 'overdue', limit: '100' }).expect(200)
    ).body as TaskPage;
    expect(after.items.map((x) => x.id)).not.toContain(ids[0]);
  });
});
