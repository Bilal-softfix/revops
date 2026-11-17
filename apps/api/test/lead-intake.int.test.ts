import type {
  Contact,
  CrmSettings,
  Lead,
  LeadSourceList,
  Pipeline,
  PipelineList,
  Role,
} from '@revops/shared';
import { leadSourceConfigSchema } from '@revops/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type IntakeRequest, type IntakeSource, LeadIntakeService } from '../src/modules/crm';
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

// M2-T4: the inbound intake (dedupe matrix, policies, idempotency, concurrency, hostile values)
// and manual contact merge.
let t: TestApp;
let owner: LoggedIn;
let manager: LoggedIn;
let agent: LoggedIn;
let other: LoggedIn;
let tenantId: string;
let source: IntakeSource;
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
  post: (path: string, body: object = {}) =>
    withSession(request(t.server).post(path), s).send(body),
  patch: (path: string, body: object) => withSession(request(t.server).patch(path), s).send(body),
});
let seq = 0;
const phone = () => `96${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
const key = () => `test:${Date.now()}:${(seq += 1)}`;
const ingest = (
  input: IntakeRequest['input'],
  extra: Partial<IntakeRequest> = {},
  tenant = tenantId,
) =>
  t.app.get(Database).withContext({ tenantId: tenant }, (tx) =>
    t.app.get(LeadIntakeService).ingest(tx, {
      tenantId: tenant,
      source,
      idempotencyKey: key(),
      input,
      ...extra,
    }),
  );
const leadsOf = (contactId: string) =>
  asTestOwner((sql) =>
    sql.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', ${tenantId}, true)`;
      return tx<{ id: string; status: string }[]>`
        select id, status from leads where contact_id = ${contactId} and deleted_at is null
        order by created_at, id`;
    }),
  );
const timelineOf = (leadId: string) =>
  asTestOwner((sql) =>
    sql.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', ${tenantId}, true)`;
      return tx<
        { type: string; actor_type: string; contact_id: string; data: Record<string, unknown> }[]
      >`
        select type, actor_type, contact_id, data from timeline_events where lead_id = ${leadId}
        order by seq`;
    }),
  );
const outbox = (type: string, aggregateId: string) =>
  asTestOwner((sql) =>
    sql.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', ${tenantId}, true)`;
      return tx<{ payload: Record<string, unknown> }[]>`
        select payload from outbox_events where type = ${type} and aggregate_id = ${aggregateId}`;
    }),
  );
const setPolicy = (dedupePolicy: CrmSettings['dedupePolicy']) =>
  api(owner).patch('/v1/crm/settings', { dedupePolicy }).expect(200);
const closeLead = async (leadId: string) => {
  const won = repairs.stages.find((s) => s.category === 'won');
  const lead = (await api(owner).get(`/v1/leads/${leadId}`).expect(200)).body as Lead;
  const pipeline = (
    (await api(owner).get('/v1/pipelines').expect(200)).body as PipelineList
  ).items.find((p) => p.id === lead.pipelineId);
  const target = pipeline?.stages.find((s) => s.category === 'won') ?? won;
  await api(owner).post(`/v1/leads/${leadId}/stage`, { stageId: target?.id }).expect(200);
};

beforeAll(async () => {
  t = await createTestApp();
  owner = await signupOwner('Intake Shop');
  tenantId = owner.body.tenant?.id ?? '';
  const as = async (role: Role) => login(t, (await addMember(t, tenantId, role)).email);
  manager = await as('manager');
  agent = await as('agent');
  other = await signupOwner('Other Intake Shop');
  const sources = ((await api(owner).get('/v1/lead-sources').expect(200)).body as LeadSourceList)
    .items;
  const first = sources[0];
  if (!first) throw new Error('no template source');
  source = { id: first.id, name: first.name, config: leadSourceConfigSchema.parse({}) };
  const pipelines = ((await api(owner).get('/v1/pipelines').expect(200)).body as PipelineList)
    .items;
  const found = pipelines.find((p) => p.key === 'repairs') ?? pipelines[1] ?? pipelines[0];
  if (!found) throw new Error('no pipeline');
  repairs = found;
});
afterAll(() => t.close());

describe('dedupe matrix (policy reenquiry, the default)', () => {
  it('settings expose dedupePolicy, default reenquiry; owner can change it, manager cannot', async () => {
    const settings = (await api(owner).get('/v1/crm/settings').expect(200)).body as CrmSettings;
    expect(settings.dedupePolicy).toBe('reenquiry');
    await api(manager).patch('/v1/crm/settings', { dedupePolicy: 'always_new' }).expect(403);
    await api(owner).patch('/v1/crm/settings', { dedupePolicy: 'nope' }).expect(400);
  });

  it('no match → new contact + new lead in the default pipeline, system actor, event', async () => {
    const p = phone();
    const r = await ingest({
      name: '  Meera  ',
      phone: `+91 ${p}`,
      attribution: { utm_source: 'google' },
    });
    expect(r.outcome).toBe('created');
    const lead = (await api(owner).get(`/v1/leads/${r.leadId}`).expect(200)).body as Lead;
    expect(lead).toMatchObject({
      contact: { name: 'Meera', phoneE164: `+91${p}` },
      source: { id: source.id },
      attribution: { utm_source: 'google' },
      owner: null,
    });
    const [created] = await timelineOf(r.leadId);
    expect(created).toMatchObject({ type: 'created', actor_type: 'system' });
    const [event] = await outbox('lead.created.v1', r.leadId);
    expect(event?.payload).toMatchObject({
      leadId: r.leadId,
      actorUserId: null,
      ownerUserId: null,
    });
  });

  it('phone match with an open lead → re-enquiry on that lead (no new lead)', async () => {
    const p = phone();
    const first = await ingest({ name: 'Ravi', phone: p });
    const again = await ingest({
      name: 'Ravi K',
      phone: `0${p}`,
      attribution: { utm_campaign: 'diwali' },
    });
    expect(again).toMatchObject({
      outcome: 'reenquiry',
      leadId: first.leadId,
      contactId: first.contactId,
    });
    expect(await leadsOf(first.contactId)).toHaveLength(1);
    const timeline = await timelineOf(first.leadId);
    expect(timeline.map((e) => e.type)).toEqual(['created', 're_enquiry']);
    expect(timeline[1]?.data).toMatchObject({
      source: { id: source.id },
      attribution: { utm_campaign: 'diwali' },
    });
    expect(await outbox('lead.reenquired.v1', first.leadId)).toHaveLength(1);
  });

  it('email match (case-insensitive) when the phone is new → same contact', async () => {
    const mail = `Person.${Date.now()}@Example.com`;
    const first = await ingest({ email: mail });
    const again = await ingest({ email: mail.toLowerCase(), phone: phone() });
    expect(again).toMatchObject({ outcome: 'reenquiry', contactId: first.contactId });
  });

  it('phone wins over email when they point at different contacts', async () => {
    const p = phone();
    const mail = `split.${Date.now()}@example.com`;
    const byPhone = await ingest({ phone: p });
    const byEmail = await ingest({ email: mail });
    const both = await ingest({ phone: p, email: mail });
    expect(both.contactId).toBe(byPhone.contactId);
    expect(both.contactId).not.toBe(byEmail.contactId);
  });

  it('match whose leads are all closed → new lead for the same contact', async () => {
    const p = phone();
    const first = await ingest({ phone: p });
    await closeLead(first.leadId);
    const again = await ingest({ phone: p });
    expect(again.outcome).toBe('created');
    expect(again.contactId).toBe(first.contactId);
    expect(again.leadId).not.toBe(first.leadId);
    expect((await leadsOf(first.contactId)).map((l) => l.status)).toEqual(['won', 'open']);
  });

  it('existing contact without leads (created manually) → new lead for it', async () => {
    const p = phone();
    const contact = (
      await api(owner).post('/v1/contacts', { name: 'Walk-in', phone: p }).expect(201)
    ).body as Contact;
    const r = await ingest({ phone: p, name: 'Someone else' });
    expect(r).toMatchObject({ outcome: 'created', contactId: contact.id });
    // The existing contact's name is not overwritten by inbound data.
    expect(
      ((await api(owner).get(`/v1/contacts/${contact.id}`).expect(200)).body as Contact).name,
    ).toBe('Walk-in');
  });

  it('re-enquiry goes to the most recent open lead when there are several', async () => {
    const p = phone();
    const first = await ingest({ phone: p });
    await setPolicy('always_new');
    const second = await ingest({ phone: p });
    await setPolicy('reenquiry');
    const third = await ingest({ phone: p });
    expect(third).toMatchObject({ outcome: 'reenquiry', leadId: second.leadId });
    expect(first.leadId).not.toBe(second.leadId);
  });
});

describe('policy always_new', () => {
  it('always creates a new lead for the matched contact', async () => {
    await setPolicy('always_new');
    try {
      const p = phone();
      const a = await ingest({ phone: p });
      const b = await ingest({ phone: p });
      expect(b).toMatchObject({ outcome: 'created', contactId: a.contactId });
      expect(await leadsOf(a.contactId)).toHaveLength(2);
    } finally {
      await setPolicy('reenquiry');
    }
  });
});

describe('idempotency and concurrency', () => {
  it('the same idempotency key twice → one lead; the replay reports duplicate', async () => {
    const k = key();
    const p = phone();
    const a = await ingest({ phone: p }, { idempotencyKey: k });
    const b = await ingest({ phone: p, name: 'Changed' }, { idempotencyKey: k });
    expect(b).toEqual({
      outcome: 'duplicate',
      leadId: a.leadId,
      contactId: a.contactId,
      droppedFields: [],
    });
    expect(await leadsOf(a.contactId)).toHaveLength(1);
    expect((await timelineOf(a.leadId)).map((e) => e.type)).toEqual(['created']);
  });

  it('concurrent same key → exactly one lead', async () => {
    const k = key();
    const p = phone();
    const results = await Promise.all(
      [1, 2, 3].map(() => ingest({ phone: p }, { idempotencyKey: k })),
    );
    expect(new Set(results.map((r) => r.leadId)).size).toBe(1);
    expect(results.filter((r) => r.outcome === 'created')).toHaveLength(1);
  });

  it('concurrent different keys, same new phone → one contact, one lead, the rest re-enquiries', async () => {
    const p = phone();
    const results = await Promise.all([1, 2, 3, 4].map(() => ingest({ phone: p })));
    expect(new Set(results.map((r) => r.contactId)).size).toBe(1);
    expect(results.filter((r) => r.outcome === 'created')).toHaveLength(1);
    expect(results.filter((r) => r.outcome === 'reenquiry')).toHaveLength(3);
    expect(await leadsOf(results[0]?.contactId ?? '')).toHaveLength(1);
  });

  it('keys are per tenant: the same key in another tenant is a separate lead', async () => {
    const k = key();
    const otherTenant = other.body.tenant?.id ?? '';
    const otherSource = (
      (await api(other).get('/v1/lead-sources').expect(200)).body as LeadSourceList
    ).items[0];
    const a = await ingest({ phone: phone() }, { idempotencyKey: k });
    const b = await ingest(
      { phone: phone() },
      {
        idempotencyKey: k,
        tenantId: otherTenant,
        source: otherSource
          ? { id: otherSource.id, name: otherSource.name, config: otherSource.config }
          : null,
      },
      otherTenant,
    );
    expect(b.outcome).toBe('created');
    expect(b.leadId).not.toBe(a.leadId);
    await api(owner).get(`/v1/leads/${b.leadId}`).expect(404);
  });
});

describe('hostile and partial input', () => {
  it('needs a valid phone or email (422); nothing is stored', async () => {
    const k = key();
    for (const input of [
      {},
      { phone: '123' },
      { email: 'not-an-email' },
      { name: 'Only a name' },
    ]) {
      await expect(ingest(input, { idempotencyKey: k })).rejects.toMatchObject({
        code: 'intake_unusable',
      });
    }
    const [row] = await asTestOwner((sql) =>
      sql.begin(async (tx) => {
        await tx`select set_config('app.tenant_id', ${tenantId}, true)`;
        return tx<
          { n: number }[]
        >`select count(*)::int as n from lead_ingestions where idempotency_key = ${k}`;
      }),
    );
    expect(row?.n).toBe(0);
  });

  it('a bad phone with a good email still works (email only)', async () => {
    const mail = `only.${Date.now()}@example.com`;
    const r = await ingest({ phone: 'abc', email: mail });
    const lead = (await api(owner).get(`/v1/leads/${r.leadId}`).expect(200)).body as Lead;
    expect(lead.contact).toMatchObject({ phoneE164: null, email: mail });
  });

  it('no name → falls back to the email/phone; invalid lead fields are dropped, valid kept', async () => {
    const fields = (
      (await api(owner).get('/v1/custom-fields?entity=lead').expect(200)).body as {
        items: { key: string; type: string; pipelineIds: string[] | null }[];
      }
    ).items;
    const text = fields.find((f) => f.type === 'text' && f.pipelineIds === null);
    const number = fields.find((f) => f.type === 'number' && f.pipelineIds === null);
    if (!text) throw new Error('need an all-pipeline text field');
    const p = phone();
    const r = await ingest({
      phone: p,
      leadFields: {
        [text.key]: 'iPhone 13',
        ...(number ? { [number.key]: 'not a number' } : {}),
        no_such_field: 'x',
      },
    });
    expect(r.droppedFields).toEqual([...(number ? [number.key] : []), 'no_such_field'].sort());
    const lead = (await api(owner).get(`/v1/leads/${r.leadId}`).expect(200)).body as Lead;
    expect(lead.contact.name).toBe(`+91${p}`);
    expect(lead.customFields).toEqual({ [text.key]: 'iPhone 13' });
  });

  it('source config: pipeline/open stage and a fixed owner are applied; a stale pipeline falls back', async () => {
    const open = repairs.stages.filter((s) => s.category === 'open').at(-1);
    const agentId = agent.body.user.id;
    const configured: IntakeSource = {
      ...source,
      config: leadSourceConfigSchema.parse({
        pipelineId: repairs.id,
        stageId: open?.id,
        assignment: { strategy: 'user', userId: agentId },
      }),
    };
    const r = await ingest({ phone: phone() }, { source: configured });
    const lead = (await api(owner).get(`/v1/leads/${r.leadId}`).expect(200)).body as Lead;
    expect(lead).toMatchObject({
      pipelineId: repairs.id,
      stageId: open?.id,
      owner: { id: agentId },
    });

    const stale: IntakeSource = {
      ...source,
      config: leadSourceConfigSchema.parse({ pipelineId: '00000000-0000-4000-8000-000000000000' }),
    };
    const s = await ingest({ phone: phone() }, { source: stale });
    expect(s.outcome).toBe('created');
  });
});

describe('manual contact merge', () => {
  const merge = (s: LoggedIn, id: string, body: object) =>
    api(s).post(`/v1/contacts/${id}/merge`, body);

  it('moves leads (with notes/tasks), timeline and ingestions; picks per field; audited; event', async () => {
    const keepPhone = phone();
    const dropPhone = phone();
    const keep = (
      await api(owner)
        .post('/v1/contacts', { name: 'Asha', phone: keepPhone, city: 'Pune' })
        .expect(201)
    ).body as Contact;
    const gone = await ingest({
      name: 'Asha Kulkarni',
      phone: dropPhone,
      email: `asha.${Date.now()}@example.com`,
    });
    await api(owner).post(`/v1/leads/${gone.leadId}/notes`, { body: 'Called back' }).expect(201);

    const res = await merge(manager, keep.id, {
      otherContactId: gone.contactId,
      pick: { name: 'other' },
    }).expect(200);
    const merged = res.body as Contact;
    expect(merged).toMatchObject({
      id: keep.id,
      name: 'Asha Kulkarni',
      phoneE164: `+91${keepPhone}`,
      city: 'Pune',
      altPhones: [`+91${dropPhone}`],
    });
    expect(merged.email).toMatch(/^asha\./);
    await api(owner).get(`/v1/contacts/${gone.contactId}`).expect(404);
    const lead = (await api(owner).get(`/v1/leads/${gone.leadId}`).expect(200)).body as Lead;
    expect(lead.contact.id).toBe(keep.id);
    expect((await timelineOf(gone.leadId)).every((e) => e.contact_id === keep.id)).toBe(true);

    // The freed phone dedupes to the survivor now.
    const again = await ingest({ phone: dropPhone });
    expect(again.contactId).not.toBe(gone.contactId);

    const [event] = await outbox('contact.merged.v1', keep.id);
    expect(event?.payload).toMatchObject({
      mergedContactId: gone.contactId,
      movedLeadIds: [gone.leadId],
    });
    const audits = await asTestOwner((sql) =>
      sql.begin(async (tx) => {
        await tx`select set_config('app.tenant_id', ${tenantId}, true)`;
        return tx<{ after: Record<string, unknown> }[]>`
          select after from audit_logs where action = 'contact.merged' and entity_id = ${keep.id}`;
      }),
    );
    expect(audits[0]?.after).toMatchObject({ mergedContactId: gone.contactId, movedLeads: 1 });
    expect(JSON.stringify(audits)).not.toContain(dropPhone);
  });

  it('can take the other phone; the old one becomes an alternate', async () => {
    const a = (await api(owner).post('/v1/contacts', { name: 'A', phone: phone() }).expect(201))
      .body as Contact;
    const b = (await api(owner).post('/v1/contacts', { name: 'B', phone: phone() }).expect(201))
      .body as Contact;
    const merged = (
      await merge(owner, a.id, { otherContactId: b.id, pick: { phone: 'other' } }).expect(200)
    ).body as Contact;
    expect(merged.phoneE164).toBe(b.phoneE164);
    expect(merged.altPhones).toEqual([a.phoneE164]);
  });

  it('refuses: self, unknown/foreign/deleted ids, no phone or email left, agents', async () => {
    const a = (await api(owner).post('/v1/contacts', { name: 'A', phone: phone() }).expect(201))
      .body as Contact;
    const b = (
      await api(owner)
        .post('/v1/contacts', { name: 'B', email: `b.${Date.now()}@example.com` })
        .expect(201)
    ).body as Contact;
    await merge(owner, a.id, { otherContactId: a.id }).expect(400);
    const theirs = (
      await api(other).post('/v1/contacts', { name: 'T', phone: phone() }).expect(201)
    ).body as Contact;
    await merge(owner, a.id, { otherContactId: theirs.id }).expect(400);
    await merge(owner, theirs.id, { otherContactId: a.id }).expect(404);
    await merge(owner, a.id, {
      otherContactId: b.id,
      pick: { phone: 'other', email: 'this' },
    }).expect(400);
    await merge(agent, a.id, { otherContactId: b.id }).expect(403);
    await merge(owner, a.id, { otherContactId: b.id, surprise: 1 }).expect(400);
    // Nothing changed after the refusals.
    await api(owner).get(`/v1/contacts/${b.id}`).expect(200);
  });
});
