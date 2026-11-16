import type {
  Contact,
  Lead,
  LeadBoard,
  LeadPage,
  LeadSourceList,
  LeadView,
  LeadViewList,
  Pipeline,
  PipelineList,
  Role,
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

// M1-T4: leads — create/edit, ownership + agent visibility, stage changes (won/lost, events),
// pipeline moves with scoped custom fields, filters, board, saved views, cross-tenant ids.
let t: TestApp;
let owner: LoggedIn;
let manager: LoggedIn;
let agent: LoggedIn;
let agent2: LoggedIn;
let other: LoggedIn; // owner of another tenant
let tenantId: string;
let agentId: string;
let agent2Id: string;
let inquiries: Pipeline;
let repairs: Pipeline;

async function signupOwner(tenantName: string, industry: string): Promise<LoggedIn> {
  const email = uniqueEmail('owner');
  await request(t.server)
    .post('/v1/auth/signup')
    .send({ name: 'Owner', email, password: PASSWORD, tenantName, industry })
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
const stage = (pipeline: Pipeline, key: string) => {
  const found = pipeline.stages.find((s) => s.key === key);
  if (!found) throw new Error(`no stage ${key}`);
  return found.id;
};
const errorsOf = (res: request.Response) =>
  (res.body as { errors?: { path: string; message: string }[] }).errors ?? [];
const phone = () => `98${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
const createLead = (s: LoggedIn, body: Record<string, unknown> = {}) =>
  api(s).post('/v1/leads', { contact: { name: 'Asha', phone: phone() }, ...body });
const listLeads = async (s: LoggedIn, query: Record<string, string> = {}) =>
  (await api(s).get('/v1/leads', query).expect(200)).body as LeadPage;
const outbox = (type: string, leadId: string) =>
  asTestOwner((sql) =>
    sql.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', ${tenantId}, true)`;
      return tx<{ payload: Record<string, unknown> }[]>`
        select payload from outbox_events where type = ${type} and aggregate_id = ${leadId}`;
    }),
  );

beforeAll(async () => {
  t = await createTestApp();
  owner = await signupOwner('Fix It', 'repair-shop');
  tenantId = owner.body.tenant?.id ?? '';
  const as = async (role: Role) => {
    const member = await addMember(t, tenantId, role);
    return { session: await login(t, member.email), id: member.userId };
  };
  manager = (await as('manager')).session;
  const a1 = await as('agent');
  agent = a1.session;
  agentId = a1.id;
  const a2 = await as('agent');
  agent2 = a2.session;
  agent2Id = a2.id;
  other = await signupOwner('Other Shop', 'repair-shop');
  const items = ((await api(owner).get('/v1/pipelines').expect(200)).body as PipelineList).items;
  inquiries = items.find((p) => p.key === 'inquiries') as Pipeline;
  repairs = items.find((p) => p.key === 'repair_jobs') as Pipeline;
});
afterAll(() => t.close());

describe('create', () => {
  it('defaults: default pipeline, first open stage, owner = creator; new contact created', async () => {
    const res = await createLead(agent, { valuePaise: 249_950 }).expect(201);
    const lead = res.body as Lead;
    expect(lead).toMatchObject({
      pipelineId: inquiries.id,
      stageId: stage(inquiries, 'new'),
      status: 'open',
      owner: { id: agentId },
      valuePaise: 249_950,
      currency: 'INR',
      wonAt: null,
    });
    expect(lead.contact.name).toBe('Asha');
    expect((await outbox('lead.created.v1', lead.id))[0]?.payload).toMatchObject({
      leadId: lead.id,
      contactId: lead.contact.id,
      ownerUserId: agentId,
    });
  });

  it('an existing phone links to that contact (one person, one contact)', async () => {
    const number = phone();
    const first = (
      await createLead(manager, { contact: { name: 'Ravi', phone: number } }).expect(201)
    ).body as Lead;
    const second = (
      await createLead(agent, { contact: { name: 'R.', phone: `+91 ${number}` } }).expect(201)
    ).body as Lead;
    expect(second.contact.id).toBe(first.contact.id);
    expect(second.contact.name).toBe('Ravi');
  });

  it('needs exactly one of contactId / contact; contactId must be visible', async () => {
    await api(owner).post('/v1/leads', {}).expect(400);
    const contact = (
      await api(agent2)
        .post('/v1/contacts', { name: 'Private', email: uniqueEmail('p') })
        .expect(201)
    ).body as Contact;
    // Repair shops default to agentContactVisibility = all: switch to assigned for this check.
    await api(owner).patch('/v1/crm/settings', { agentContactVisibility: 'assigned' }).expect(200);
    const hidden = await createLead(agent, { contact: undefined, contactId: contact.id }).expect(
      400,
    );
    expect(errorsOf(hidden)[0]?.path).toBe('contactId');
    await createLead(agent2, { contact: undefined, contactId: contact.id }).expect(201);
    await api(owner).patch('/v1/crm/settings', { agentContactVisibility: 'all' }).expect(200);
  });

  it('custom fields: only those of the lead’s pipeline, required where they apply', async () => {
    const bad = await createLead(owner, { customFields: { imei_serial: '3569' } }).expect(400);
    expect(errorsOf(bad)).toEqual([
      { path: 'customFields.imei_serial', message: 'doesn’t apply to this pipeline' },
    ]);
    const ok = await createLead(owner, {
      pipelineId: repairs.id,
      customFields: { imei_serial: '3569', device_brand: 'Apple', estimate_inr: 2500 },
    }).expect(201);
    expect((ok.body as Lead).customFields).toEqual({
      imei_serial: '3569',
      device_brand: 'Apple',
      estimate_inr: 2500,
    });
  });

  it('a lead created in a lost stage needs a reason; in a won stage gets wonAt', async () => {
    await createLead(owner, { stageId: stage(inquiries, 'lost') }).expect(400);
    const lost = (
      await createLead(owner, {
        stageId: stage(inquiries, 'lost'),
        lostReason: 'Quote too high',
      }).expect(201)
    ).body as Lead;
    expect(lost).toMatchObject({ status: 'lost', lostReason: 'Quote too high' });
    const won = (
      await createLead(owner, { stageId: stage(inquiries, 'device_received') }).expect(201)
    ).body as Lead;
    expect(won.status).toBe('won');
    expect(won.wonAt).not.toBeNull();
  });
});

// Dev decision (M1-T4 review): in `assigned` mode an agent's new lead never links to — or
// reveals — a contact they can't see; they get the contact-create 409 and nothing is created.
describe('matching an existing contact on create', () => {
  const counts = () =>
    asTestOwner((sql) =>
      sql.begin(async (tx) => {
        await tx`select set_config('app.tenant_id', ${tenantId}, true)`;
        const [row] = await tx<{ leads: number; contacts: number }[]>`
          select (select count(*)::int from leads) as leads,
                 (select count(*)::int from contacts) as contacts`;
        return row;
      }),
    );
  const inMode = async (mode: 'all' | 'assigned', fn: () => Promise<void>) => {
    await api(owner).patch('/v1/crm/settings', { agentContactVisibility: mode }).expect(200);
    try {
      await fn();
    } finally {
      await api(owner).patch('/v1/crm/settings', { agentContactVisibility: 'all' }).expect(200);
    }
  };
  /** agent2's lead → a contact `agent` can't see in `assigned` mode. */
  const hiddenContact = async () => {
    const email = uniqueEmail('hidden');
    const lead = (
      await createLead(agent2, { contact: { name: 'Meera Hidden', phone: phone(), email } }).expect(
        201,
      )
    ).body as Lead;
    return { ...lead.contact, email };
  };
  const expectNoLeak = (
    res: request.Response,
    field: 'phone' | 'email',
    contact: Awaited<ReturnType<typeof hiddenContact>>,
  ) => {
    expect(res.body).toMatchObject({
      code: 'contact_exists',
      conflict: { field, ownerName: 'agent user' },
    });
    expect((res.body as { conflict: object }).conflict).not.toHaveProperty('contact');
    const raw = JSON.stringify(res.body);
    for (const secret of [contact.id, contact.name, contact.email, contact.phoneE164 ?? '']) {
      expect(raw).not.toContain(secret);
    }
    expect(raw).not.toContain((contact.phoneE164 ?? '').slice(-8));
  };

  it('"assigned": an agent matching a hidden contact gets the 409 (no details); nothing created', async () => {
    await inMode('assigned', async () => {
      const contact = await hiddenContact();
      const before = await counts();
      const byPhone = await createLead(agent, {
        contact: { name: 'Someone', phone: contact.phoneE164 },
      }).expect(409);
      expectNoLeak(byPhone, 'phone', contact);
      const byEmail = await createLead(agent, {
        contact: { name: 'Someone', email: contact.email.toUpperCase() },
      }).expect(409);
      expectNoLeak(byEmail, 'email', contact);
      expect(await counts()).toEqual(before);
      await api(agent).get(`/v1/contacts/${contact.id}`).expect(404);
    });
  });

  it('"assigned": editing a visible contact to a hidden one’s phone/email is the same 409', async () => {
    await inMode('assigned', async () => {
      const contact = await hiddenContact();
      const mine = (await createLead(agent).expect(201)).body as Lead;
      const res = await api(agent)
        .patch(`/v1/contacts/${mine.contact.id}`, { email: contact.email })
        .expect(409);
      expectNoLeak(res, 'email', contact);
      const after = (await api(agent).get(`/v1/contacts/${mine.contact.id}`).expect(200))
        .body as Contact;
      expect(after.email).toBeNull();
    });
  });

  it('"assigned": an agent still links to a contact they can see; assign roles link to any', async () => {
    await inMode('assigned', async () => {
      const own = (await createLead(agent).expect(201)).body as Lead;
      const again = (
        await createLead(agent, { contact: { name: 'x', phone: own.contact.phoneE164 } }).expect(
          201,
        )
      ).body as Lead;
      expect(again.contact.id).toBe(own.contact.id);
      for (const s of [owner, manager]) {
        const contact = await hiddenContact();
        const linked = (
          await createLead(s, { contact: { name: 'x', email: contact.email } }).expect(201)
        ).body as Lead;
        expect(linked.contact).toMatchObject({ id: contact.id, name: 'Meera Hidden' });
      }
    });
  });

  it('"all": an agent links to another agent’s contact', async () => {
    await inMode('all', async () => {
      const contact = await hiddenContact();
      const linked = (
        await createLead(agent, { contact: { name: 'x', phone: contact.phoneE164 } }).expect(201)
      ).body as Lead;
      expect(linked.contact.id).toBe(contact.id);
    });
  });
});

describe('ownership and agent visibility', () => {
  let agentLead: Lead;
  let agent2Lead: Lead;
  let unassigned: Lead;
  beforeAll(async () => {
    agentLead = (await createLead(agent).expect(201)).body as Lead;
    agent2Lead = (await createLead(agent2).expect(201)).body as Lead;
    unassigned = (await createLead(manager, { ownerUserId: null }).expect(201)).body as Lead;
  });

  it('AC: an agent can’t fetch, edit, move or delete a lead that isn’t theirs (404)', async () => {
    await api(agent).get(`/v1/leads/${agent2Lead.id}`).expect(404);
    await api(agent).get(`/v1/leads/${unassigned.id}`).expect(404);
    await api(agent).patch(`/v1/leads/${agent2Lead.id}`, { valuePaise: 1 }).expect(404);
    await api(agent)
      .post(`/v1/leads/${agent2Lead.id}/stage`, { stageId: stage(inquiries, 'quoted') })
      .expect(404);
    await api(agent).get(`/v1/leads/${agentLead.id}`).expect(200);
    const ids = (await listLeads(agent, { limit: '100' })).items.map((l) => l.id);
    expect(ids).toContain(agentLead.id);
    expect(ids).not.toContain(agent2Lead.id);
    expect(ids).not.toContain(unassigned.id);
    // Managers see everything.
    await api(manager).get(`/v1/leads/${agent2Lead.id}`).expect(200);
  });

  it('agents can’t assign; assign roles can, to active members only (audited + event)', async () => {
    await createLead(agent, { ownerUserId: agent2Id }).expect(403);
    await api(agent).patch(`/v1/leads/${agentLead.id}`, { ownerUserId: agent2Id }).expect(403);
    await api(agent).del(`/v1/leads/${agentLead.id}`).expect(403);
    await api(manager)
      .patch(`/v1/leads/${agentLead.id}`, { ownerUserId: other.body.user.id })
      .expect(400);
    const res = await api(manager)
      .patch(`/v1/leads/${agentLead.id}`, { ownerUserId: agent2Id })
      .expect(200);
    expect((res.body as Lead).owner?.id).toBe(agent2Id);
    expect((await outbox('lead.assigned.v1', agentLead.id))[0]?.payload).toMatchObject({
      fromUserId: agentId,
      toUserId: agent2Id,
    });
    await api(agent).get(`/v1/leads/${agentLead.id}`).expect(404);
    await api(agent2).get(`/v1/leads/${agentLead.id}`).expect(200);
  });

  it('agents in "assigned" mode see contacts of leads they own', async () => {
    await api(owner).patch('/v1/crm/settings', { agentContactVisibility: 'assigned' }).expect(200);
    const lead = (await createLead(manager, { ownerUserId: agentId }).expect(201)).body as Lead;
    await api(agent).get(`/v1/contacts/${lead.contact.id}`).expect(200);
    await api(agent2).get(`/v1/contacts/${lead.contact.id}`).expect(404);
    await api(owner).patch('/v1/crm/settings', { agentContactVisibility: 'all' }).expect(200);
  });

  it('delete is soft and needs lead.delete', async () => {
    const lead = (await createLead(manager).expect(201)).body as Lead;
    await api(manager).del(`/v1/leads/${lead.id}`).expect(204);
    await api(manager).get(`/v1/leads/${lead.id}`).expect(404);
  });
});

describe('stage changes', () => {
  it('AC: a stage change emits lead.stage_changed.v1 via the outbox; no-op emits nothing', async () => {
    const lead = (await createLead(agent).expect(201)).body as Lead;
    const quoted = stage(inquiries, 'quoted');
    const res = await api(agent)
      .post(`/v1/leads/${lead.id}/stage`, { stageId: quoted })
      .expect(200);
    expect(res.body).toMatchObject({ stageId: quoted, status: 'open' });
    await api(agent).post(`/v1/leads/${lead.id}/stage`, { stageId: quoted }).expect(200);
    const events = await outbox('lead.stage_changed.v1', lead.id);
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toEqual({
      tenantId,
      leadId: lead.id,
      fromPipelineId: inquiries.id,
      fromStageId: stage(inquiries, 'new'),
      toPipelineId: inquiries.id,
      toStageId: quoted,
      toStatus: 'open',
      actorUserId: agentId,
    });
  });

  it('won records wonAt; lost needs a reason; reopening clears both', async () => {
    const lead = (await createLead(agent).expect(201)).body as Lead;
    const won = (
      await api(agent)
        .post(`/v1/leads/${lead.id}/stage`, { stageId: stage(inquiries, 'device_received') })
        .expect(200)
    ).body as Lead;
    expect(won.status).toBe('won');
    expect(won.wonAt).not.toBeNull();
    const noReason = await api(agent)
      .post(`/v1/leads/${lead.id}/stage`, { stageId: stage(inquiries, 'lost') })
      .expect(400);
    expect(errorsOf(noReason)[0]?.path).toBe('lostReason');
    const lost = (
      await api(agent)
        .post(`/v1/leads/${lead.id}/stage`, {
          stageId: stage(inquiries, 'lost'),
          lostReason: 'Went to another shop',
        })
        .expect(200)
    ).body as Lead;
    expect(lost).toMatchObject({ status: 'lost', wonAt: null, lostReason: 'Went to another shop' });
    const reopened = (
      await api(agent)
        .post(`/v1/leads/${lead.id}/stage`, { stageId: stage(inquiries, 'new') })
        .expect(200)
    ).body as Lead;
    expect(reopened).toMatchObject({ status: 'open', wonAt: null, lostAt: null, lostReason: null });
  });

  it('a stage of another pipeline needs pipelineId; moving keeps hidden field values', async () => {
    const lead = (
      await createLead(owner, {
        pipelineId: repairs.id,
        customFields: { imei_serial: '3569', device_brand: 'Apple' },
      }).expect(201)
    ).body as Lead;
    await api(owner)
      .post(`/v1/leads/${lead.id}/stage`, { stageId: stage(inquiries, 'new') })
      .expect(400);
    const moved = (
      await api(owner)
        .post(`/v1/leads/${lead.id}/stage`, {
          pipelineId: inquiries.id,
          stageId: stage(inquiries, 'new'),
        })
        .expect(200)
    ).body as Lead;
    expect(moved.pipelineId).toBe(inquiries.id);
    expect(moved.customFields).toEqual({ device_brand: 'Apple' });
    // Fields of the old pipeline can't be edited here…
    await api(owner)
      .patch(`/v1/leads/${lead.id}`, { customFields: { imei_serial: 'x' } })
      .expect(400);
    // …and come back when the lead does.
    const back = (
      await api(owner)
        .post(`/v1/leads/${lead.id}/stage`, {
          pipelineId: repairs.id,
          stageId: stage(repairs, 'received'),
        })
        .expect(200)
    ).body as Lead;
    expect(back.customFields).toEqual({ imei_serial: '3569', device_brand: 'Apple' });
  });

  it('rejects another tenant’s pipeline / stage / owner / source / contact ids', async () => {
    const theirPipelines = (
      (await api(other).get('/v1/pipelines').expect(200)).body as PipelineList
    ).items;
    const theirs = theirPipelines[0] as Pipeline;
    const theirSource = (
      (await api(other).get('/v1/lead-sources').expect(200)).body as LeadSourceList
    ).items[0];
    const theirContact = (
      await api(other)
        .post('/v1/contacts', { name: 'X', email: uniqueEmail('x') })
        .expect(201)
    ).body as Contact;
    const lead = (await createLead(owner).expect(201)).body as Lead;
    await createLead(owner, { pipelineId: theirs.id }).expect(400);
    await createLead(owner, { stageId: theirs.stages[0]?.id }).expect(400);
    await createLead(owner, { sourceId: theirSource?.id }).expect(400);
    await createLead(owner, { contact: undefined, contactId: theirContact.id }).expect(400);
    await createLead(owner, { ownerUserId: other.body.user.id }).expect(400);
    await api(owner)
      .post(`/v1/leads/${lead.id}/stage`, { pipelineId: theirs.id, stageId: theirs.stages[0]?.id })
      .expect(400);
    // And their leads are invisible.
    const theirLead = (await createLead(other).expect(201)).body as Lead;
    await api(owner).get(`/v1/leads/${theirLead.id}`).expect(404);
    await api(owner).patch(`/v1/leads/${theirLead.id}`, { valuePaise: 1 }).expect(404);
  });
});

describe('list filters, paging and the board', () => {
  let walkIn: string;
  const tag = `F${Date.now()}`;
  beforeAll(async () => {
    walkIn =
      ((await api(owner).get('/v1/lead-sources').expect(200)).body as LeadSourceList).items.find(
        (s) => s.key === 'walk_in',
      )?.id ?? '';
    const make = (name: string, body: Record<string, unknown>) =>
      createLead(owner, { contact: { name: `${tag} ${name}`, phone: phone() }, ...body }).expect(
        201,
      );
    await make('screen', {
      pipelineId: repairs.id,
      sourceId: walkIn,
      customFields: {
        issue: 'screen',
        estimate_inr: 1500,
        under_warranty: true,
        promised_date: '2026-12-01',
      },
    });
    await make('battery', {
      pipelineId: repairs.id,
      customFields: { issue: 'battery', estimate_inr: 900, device_brand: 'Samsung Galaxy' },
    });
    await make('water', {
      pipelineId: repairs.id,
      ownerUserId: agentId,
      customFields: { issue: 'water_damage', estimate_inr: 4000, promised_date: '2026-11-20' },
    });
  });
  const names = (page: LeadPage) =>
    page.items.map((l) => l.contact.name.replace(`${tag} `, '')).sort();
  const q = { q: tag };

  it('filters by pipeline, stage, owner, source and search', async () => {
    expect(names(await listLeads(owner, { ...q, pipelineId: repairs.id }))).toEqual([
      'battery',
      'screen',
      'water',
    ]);
    expect(names(await listLeads(owner, { ...q, sourceId: walkIn }))).toEqual(['screen']);
    expect(names(await listLeads(owner, { ...q, owner: agentId }))).toEqual(['water']);
    expect(names(await listLeads(owner, { ...q, owner: 'me' }))).toEqual(['battery', 'screen']);
    expect(
      names(await listLeads(owner, { ...q, stageIds: stage(repairs, 'received'), status: 'open' })),
    ).toEqual(['battery', 'screen', 'water']);
    expect(names(await listLeads(owner, { q: `${tag} batt` }))).toEqual(['battery']);
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect((await listLeads(owner, { ...q, createdFrom: future })).items).toEqual([]);
  });

  it('filters by custom fields: select, number range, bool, text, date range', async () => {
    const cf = (filter: object) => listLeads(owner, { ...q, cf: JSON.stringify(filter) });
    expect(names(await cf({ issue: 'screen' }))).toEqual(['screen']);
    expect(names(await cf({ issue: ['screen', 'battery'] }))).toEqual(['battery', 'screen']);
    expect(names(await cf({ estimate_inr: { min: 1000, max: 4000 } }))).toEqual([
      'screen',
      'water',
    ]);
    expect(names(await cf({ under_warranty: true }))).toEqual(['screen']);
    expect(names(await cf({ device_brand: 'galaxy' }))).toEqual(['battery']);
    expect(names(await cf({ promised_date: { max: '2026-11-30' } }))).toEqual(['water']);
    const unknown = await api(owner)
      .get('/v1/leads', { cf: JSON.stringify({ nope: 'x' }) })
      .expect(400);
    expect(errorsOf(unknown)[0]?.path).toBe('cf.nope');
    await api(owner)
      .get('/v1/leads', { cf: JSON.stringify({ estimate_inr: 'x' }) })
      .expect(400);
    await api(owner).get('/v1/leads', { cf: '{bad json' }).expect(400);
  });

  it('cursor pagination walks every lead exactly once', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: LeadPage = await listLeads(owner, {
        ...q,
        limit: '2',
        ...(cursor ? { cursor } : {}),
      });
      seen.push(...page.items.map((l) => l.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toHaveLength(3);
    expect(new Set(seen).size).toBe(3);
  });

  it('the board has a column per stage with counts, scoped to what the caller sees', async () => {
    const board = (
      await api(owner)
        .get('/v1/leads/board', { ...q, pipelineId: repairs.id, perStage: '2' })
        .expect(200)
    ).body as LeadBoard;
    expect(board.columns.map((c) => c.stageId)).toEqual(repairs.stages.map((s) => s.id));
    const received = board.columns.find((c) => c.stageId === stage(repairs, 'received'));
    expect(received?.count).toBe(3);
    expect(received?.items).toHaveLength(2);
    expect(received?.nextCursor).not.toBeNull();
    const agentBoard = (
      await api(agent)
        .get('/v1/leads/board', { ...q, pipelineId: repairs.id })
        .expect(200)
    ).body as LeadBoard;
    expect(agentBoard.columns.reduce((n, c) => n + c.count, 0)).toBe(1);
    await api(owner)
      .get('/v1/leads/board', { pipelineId: other.body.tenant?.id ?? '' })
      .expect(404);
  });
});

describe('saved views', () => {
  it('are private to their user', async () => {
    const view = (
      await api(agent)
        .post('/v1/lead-views', {
          name: 'My repairs',
          layout: 'board',
          filters: { pipelineId: repairs.id, customFields: { issue: ['screen'] } },
        })
        .expect(201)
    ).body as LeadView;
    expect(view).toMatchObject({ name: 'My repairs', layout: 'board' });
    await api(agent).post('/v1/lead-views', { name: 'My repairs', filters: {} }).expect(409);
    expect(
      ((await api(agent).get('/v1/lead-views').expect(200)).body as LeadViewList).items,
    ).toHaveLength(1);
    expect(
      ((await api(agent2).get('/v1/lead-views').expect(200)).body as LeadViewList).items,
    ).toHaveLength(0);
    await api(agent2).del(`/v1/lead-views/${view.id}`).expect(404);
    await api(agent).del(`/v1/lead-views/${view.id}`).expect(204);
  });
});
