import type { Contact, CustomFieldDef, CustomFieldDefList, Role } from '@revops/shared';
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

// M1-T2: custom field definitions + validation of values (contacts here; leads reuse it in T4).
let t: TestApp;
let owner: LoggedIn;
let manager: LoggedIn;
let agent: LoggedIn;
let tenantId: string;

beforeAll(async () => {
  t = await createTestApp();
  const email = uniqueEmail('owner');
  await request(t.server)
    .post('/v1/auth/signup')
    .send({
      name: 'Owner',
      email,
      password: PASSWORD,
      tenantName: 'Code',
      industry: 'software-agency',
    })
    .expect(202);
  await t.drain();
  await verify(t, t.email.lastTokenTo(email)).expect(204);
  owner = await login(t, email);
  tenantId = owner.body.tenant?.id ?? '';
  const as = async (role: Role) => login(t, (await addMember(t, tenantId, role)).email);
  manager = await as('manager');
  agent = await as('agent');
});
afterAll(() => t.close());

const listDefs = async (s: LoggedIn, entity?: string) =>
  (
    await withSession(request(t.server).get('/v1/custom-fields'), s)
      .query(entity ? { entity } : {})
      .expect(200)
  ).body as CustomFieldDefList;
const createDef = (s: LoggedIn, body: Record<string, unknown>) =>
  withSession(request(t.server).post('/v1/custom-fields'), s).send(body);
const patchDef = (s: LoggedIn, id: string, body: Record<string, unknown>) =>
  withSession(request(t.server).patch(`/v1/custom-fields/${id}`), s).send(body);
const deleteDef = (s: LoggedIn, id: string) =>
  withSession(request(t.server).delete(`/v1/custom-fields/${id}`), s);
const createContact = (body: Record<string, unknown>) =>
  withSession(request(t.server).post('/v1/contacts'), owner).send({
    name: 'C',
    email: uniqueEmail('c'),
    ...body,
  });
const errorsOf = (res: request.Response) =>
  (res.body as { errors?: { path: string; message: string }[] }).errors ?? [];

describe('definitions', () => {
  it('the template’s fields are there, in order, readable by every role', async () => {
    const { items } = await listDefs(agent, 'contact');
    expect(items.map((d) => d.key)).toEqual(['company', 'designation']);
    expect((await listDefs(manager, 'lead')).items.map((d) => d.key)).toContain('tech_stack');
  });

  it('owners/admins create; managers and agents can’t (403)', async () => {
    const body = { entity: 'contact', key: 'linkedin_url', label: 'LinkedIn', type: 'text' };
    for (const s of [manager, agent]) await createDef(s, body).expect(403);
    const res = await createDef(owner, body).expect(201);
    expect(res.body).toMatchObject({ key: 'linkedin_url', type: 'text', required: false });
    expect((await listDefs(agent, 'contact')).items.map((d) => d.key)).toContain('linkedin_url');
  });

  it('a key that exists (or existed) can’t be used again', async () => {
    await createDef(owner, { entity: 'contact', key: 'company', label: 'Co', type: 'text' }).expect(
      409,
    );
  });

  it('key and type are immutable; options can be relabelled or added, not removed', async () => {
    const def = (
      await createDef(owner, {
        entity: 'contact',
        key: 'lead_temperature',
        label: 'Temperature',
        type: 'select',
        options: [
          { value: 'hot', label: 'Hot' },
          { value: 'cold', label: 'Cold' },
        ],
      }).expect(201)
    ).body as CustomFieldDef;
    await patchDef(owner, def.id, { type: 'text' }).expect(400);
    await patchDef(owner, def.id, { key: 'temp' }).expect(400);
    const removed = await patchDef(owner, def.id, {
      options: [{ value: 'hot', label: 'Hot' }],
    }).expect(400);
    expect(errorsOf(removed)[0]?.message).toMatch(/not removed \(cold\)/);
    const updated = await patchDef(owner, def.id, {
      label: 'Lead temperature',
      options: [
        { value: 'hot', label: 'Hot 🔥' },
        { value: 'cold', label: 'Cold' },
        { value: 'warm', label: 'Warm' },
      ],
    }).expect(200);
    expect(updated.body).toMatchObject({ label: 'Lead temperature' });
    expect((updated.body as CustomFieldDef).options?.map((o) => o.value)).toEqual([
      'hot',
      'cold',
      'warm',
    ]);
  });
});

describe('values on contacts', () => {
  let budget: CustomFieldDef;
  let callDate: CustomFieldDef;
  beforeAll(async () => {
    budget = (
      await createDef(owner, {
        entity: 'contact',
        key: 'budget_inr',
        label: 'Budget',
        type: 'number',
      })
    ).body as CustomFieldDef;
    callDate = (
      await createDef(owner, { entity: 'contact', key: 'call_on', label: 'Call on', type: 'date' })
    ).body as CustomFieldDef;
  });

  it('valid values are stored and returned', async () => {
    const res = await createContact({
      customFields: { company: 'Acme', budget_inr: 250000, call_on: '2026-12-01' },
    }).expect(201);
    expect((res.body as Contact).customFields).toEqual({
      company: 'Acme',
      budget_inr: 250000,
      call_on: '2026-12-01',
    });
  });

  it('AC: invalid value types are rejected with field-level errors', async () => {
    const res = await createContact({
      customFields: { budget_inr: '2.5 lakh', call_on: 'next week', nope: 1 },
    }).expect(400);
    expect(res.body).toMatchObject({ code: 'validation_failed' });
    expect(
      errorsOf(res)
        .map((e) => e.path)
        .sort(),
    ).toEqual(['customFields.budget_inr', 'customFields.call_on', 'customFields.nope']);
    expect(errorsOf(res).find((e) => e.path === 'customFields.nope')?.message).toBe(
      'unknown field',
    );
  });

  it('required fields: enforced on create, can’t be cleared on update', async () => {
    const req = (
      await createDef(owner, {
        entity: 'contact',
        key: 'gstin',
        label: 'GSTIN',
        type: 'text',
        required: true,
      }).expect(201)
    ).body as CustomFieldDef;
    try {
      const missing = await createContact({}).expect(400);
      expect(errorsOf(missing).map((e) => e.path)).toEqual(['customFields.gstin']);
      const c = (await createContact({ customFields: { gstin: '27ABCDE1234F1Z5' } }).expect(201))
        .body as Contact;
      await withSession(request(t.server).patch(`/v1/contacts/${c.id}`), owner)
        .send({ customFields: { gstin: null } })
        .expect(400);
    } finally {
      await deleteDef(owner, req.id).expect(204); // keep other tests free of the required field
    }
  });

  it('PATCH merges: only the keys given change; null clears one value', async () => {
    const c = (
      await createContact({ customFields: { company: 'Acme', budget_inr: 100 } }).expect(201)
    ).body as Contact;
    const res = await withSession(request(t.server).patch(`/v1/contacts/${c.id}`), owner)
      .send({ customFields: { budget_inr: null, call_on: '2026-12-24' } })
      .expect(200);
    expect((res.body as Contact).customFields).toEqual({ company: 'Acme', call_on: '2026-12-24' });
  });

  it('AC: deleting a definition hides its values — they are kept, not destroyed', async () => {
    const c = (
      await createContact({ customFields: { budget_inr: 777, company: 'Kept' } }).expect(201)
    ).body as Contact;
    await deleteDef(manager, budget.id).expect(403);
    await deleteDef(owner, budget.id).expect(204);

    const after = (
      await withSession(request(t.server).get(`/v1/contacts/${c.id}`), owner).expect(200)
    ).body as Contact;
    expect(after.customFields).toEqual({ company: 'Kept' });
    expect((await listDefs(owner, 'contact')).items.map((d) => d.key)).not.toContain('budget_inr');

    // Still stored (owner, inside the tenant's RLS context).
    const stored = await asTestOwner((sql) =>
      sql.begin(async (tx) => {
        await tx`select set_config('app.tenant_id', ${tenantId}, true)`;
        return tx<{ custom_fields: Record<string, unknown> }[]>`
          select custom_fields from contacts where id = ${c.id}`;
      }),
    );
    expect(stored[0]?.custom_fields).toMatchObject({ budget_inr: 777 });

    // Writing to the deleted field is now an unknown field, and its key can never come back.
    const res = await createContact({ customFields: { budget_inr: 1 } }).expect(400);
    expect(errorsOf(res)[0]).toEqual({ path: 'customFields.budget_inr', message: 'unknown field' });
    await createDef(owner, {
      entity: 'contact',
      key: 'budget_inr',
      label: 'Budget again',
      type: 'text',
    }).expect(409);
    expect(callDate.key).toBe('call_on');
  });
});
