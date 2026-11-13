import type { Contact, ContactPage, CrmSettings, Role } from '@revops/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type LoggedIn,
  PASSWORD,
  type TestApp,
  addMember,
  createTestApp,
  login,
  signupVerified,
  uniqueEmail,
  verify,
  withSession,
} from './test-app';

// M1-T1: contacts — E.164 normalisation, duplicate conflicts, trigram search, and the per-tenant
// agentContactVisibility setting ("all" | "assigned") with visibility-aware conflicts.
let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

let phoneSeq = 0;
/** A fresh valid Indian mobile, written the way people type it. */
const newPhone = () => {
  phoneSeq += 1;
  const n = String(70_000_00000 + Math.floor(Math.random() * 9_000_000) * 100 + phoneSeq).slice(
    0,
    10,
  );
  return `0${n.slice(0, 5)} ${n.slice(5)}`;
};
const e164 = (typed: string) => `+91${typed.replace(/\D/g, '').replace(/^0/, '')}`;

interface Team {
  tenantId: string;
  owner: LoggedIn;
  admin: LoggedIn;
  manager: LoggedIn;
  agentA: LoggedIn & { name: string };
  agentB: LoggedIn;
}

async function team(industry?: string): Promise<Team> {
  const email = uniqueEmail('owner');
  if (industry) {
    await request(t.server)
      .post('/v1/auth/signup')
      .send({ name: 'Owner', email, password: PASSWORD, tenantName: 'Shop', industry })
      .expect(202);
    await t.drain();
    await verify(t, t.email.lastTokenTo(email)).expect(204);
  } else {
    await signupVerified(t, email);
  }
  const owner = await login(t, email);
  const tenantId = owner.body.tenant?.id ?? '';
  const as = async (role: Role) => login(t, (await addMember(t, tenantId, role)).email);
  const agentA = await as('agent');
  return {
    tenantId,
    owner,
    admin: await as('admin'),
    manager: await as('manager'),
    agentA: { ...agentA, name: agentA.body.user.name },
    agentB: await as('agent'),
  };
}

const create = (s: LoggedIn, body: Record<string, unknown>) =>
  withSession(request(t.server).post('/v1/contacts'), s).send(body);
const get = (s: LoggedIn, id: string) =>
  withSession(request(t.server).get(`/v1/contacts/${id}`), s);
const list = async (s: LoggedIn, query: Record<string, string | number> = {}) =>
  (await withSession(request(t.server).get('/v1/contacts'), s).query(query).expect(200))
    .body as ContactPage;
const setVisibility = (s: LoggedIn, agentContactVisibility: string) =>
  withSession(request(t.server).patch('/v1/crm/settings'), s).send({ agentContactVisibility });

describe('contacts CRUD + normalisation', () => {
  let tm: Team;
  beforeAll(async () => {
    tm = await team();
  });

  it('stores the phone as E.164 whatever the input format, and returns the contact', async () => {
    const typed = newPhone();
    const res = await create(tm.owner, { name: 'Asha', phone: typed, city: 'Pune' }).expect(201);
    const contact = res.body as Contact;
    expect(contact.phoneE164).toBe(e164(typed));
    expect((await get(tm.owner, contact.id).expect(200)).body).toEqual(contact);
  });

  it('an invalid phone is a 400 with a field error (no value echoed)', async () => {
    const res = await create(tm.owner, { name: 'X', phone: '12' }).expect(400);
    expect(res.body).toMatchObject({ code: 'validation_failed' });
    expect((res.body as { errors: unknown }).errors).toEqual([
      expect.objectContaining({
        path: 'phone',
        message: expect.stringMatching(/valid phone/) as unknown,
      }),
    ]);
  });

  it('AC: a duplicate phone (any format) in the same tenant → 409 pointing at the existing contact', async () => {
    const typed = newPhone();
    const first = (await create(tm.owner, { name: 'First', phone: typed }).expect(201))
      .body as Contact;
    const res = await create(tm.owner, { name: 'Again', phone: e164(typed) }).expect(409);
    expect(res.body).toMatchObject({
      code: 'contact_exists',
      conflict: { field: 'phone', contact: { id: first.id, name: 'First' } },
    });
  });

  it('AC: the same phone is allowed in another tenant', async () => {
    const typed = newPhone();
    await create(tm.owner, { name: 'Here', phone: typed }).expect(201);
    const other = await team();
    await create(other.owner, { name: 'There', phone: typed }).expect(201);
  });

  it('phone OR email: email-only works, neither is a 400 on the phone field', async () => {
    const email = uniqueEmail('linkedin');
    const res = await create(tm.owner, { name: 'LinkedIn lead', email }).expect(201);
    expect(res.body).toMatchObject({ phoneE164: null, email });
    const bad = await create(tm.owner, { name: 'Nobody', city: 'Pune' }).expect(400);
    expect((bad.body as { errors: unknown }).errors).toEqual([
      { path: 'phone', message: 'Enter a phone number or an email (at least one)' },
    ]);
  });

  it('email-only duplicates are caught on the email', async () => {
    const email = uniqueEmail('mailonly');
    await create(tm.owner, { name: 'First', email }).expect(201);
    const res = await create(tm.owner, { name: 'Second', email }).expect(409);
    expect(res.body).toMatchObject({ conflict: { field: 'email' } });
  });

  it('PATCH can clear one identifier but never both', async () => {
    const email = uniqueEmail('both');
    const c = (await create(tm.owner, { name: 'Both', phone: newPhone(), email }).expect(201))
      .body as Contact;
    const patch = (body: Record<string, unknown>) =>
      withSession(request(t.server).patch(`/v1/contacts/${c.id}`), tm.owner).send(body);
    await patch({ phone: null }).expect(200);
    const res = await patch({ email: null }).expect(400);
    expect(res.body).toMatchObject({
      code: 'validation_failed',
      errors: [{ path: 'phone', message: 'Enter a phone number or an email (at least one)' }],
    });
    expect((await get(tm.owner, c.id).expect(200)).body).toMatchObject({ phoneE164: null, email });
  });

  it('a duplicate email is a conflict too (case-insensitive)', async () => {
    const email = uniqueEmail('dup');
    await create(tm.owner, { name: 'E1', phone: newPhone(), email }).expect(201);
    const res = await create(tm.owner, {
      name: 'E2',
      phone: newPhone(),
      email: email.toUpperCase(),
    }).expect(409);
    expect(res.body).toMatchObject({ conflict: { field: 'email' } });
  });

  it('concurrent creates with the same phone: exactly one 201, the rest 409 (never 500)', async () => {
    const typed = newPhone();
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => create(tm.owner, { name: `Race ${i}`, phone: typed })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409]);
  });

  it('update re-normalises; changing to another contact’s phone is a conflict', async () => {
    const a = (await create(tm.owner, { name: 'A', phone: newPhone() }).expect(201))
      .body as Contact;
    const typedB = newPhone();
    await create(tm.owner, { name: 'B', phone: typedB }).expect(201);
    const typedNew = newPhone();
    const updated = await withSession(request(t.server).patch(`/v1/contacts/${a.id}`), tm.owner)
      .send({ phone: typedNew, city: null })
      .expect(200);
    expect(updated.body).toMatchObject({ phoneE164: e164(typedNew), city: null });
    await withSession(request(t.server).patch(`/v1/contacts/${a.id}`), tm.owner)
      .send({ phone: typedB })
      .expect(409);
  });

  it('soft delete hides the contact and frees its phone; agents can’t delete', async () => {
    const typed = newPhone();
    const c = (await create(tm.owner, { name: 'Gone', phone: typed }).expect(201)).body as Contact;
    await withSession(request(t.server).delete(`/v1/contacts/${c.id}`), tm.agentA).expect(403);
    await withSession(request(t.server).delete(`/v1/contacts/${c.id}`), tm.manager).expect(204);
    await get(tm.owner, c.id).expect(404);
    await create(tm.owner, { name: 'Reborn', phone: typed }).expect(201);
  });

  it('search by name, phone digits (any format) or email fragment; wildcards are literal', async () => {
    const typed = newPhone();
    const tag = `zq${Date.now().toString(36)}`;
    const c = (
      await create(tm.owner, {
        name: `Meera ${tag}`,
        phone: typed,
        email: `${tag}@search.test`,
      }).expect(201)
    ).body as Contact;
    const digits = typed.replace(/\D/g, '');
    for (const q of [tag, `MEERA ${tag}`.toLowerCase(), digits.slice(1, 7), `${tag}@search`]) {
      expect((await list(tm.owner, { q })).items.map((i) => i.id)).toContain(c.id);
    }
    expect((await list(tm.owner, { q: '%' })).items).toEqual([]);
  });

  it('pages with a cursor, newest first, each contact exactly once', async () => {
    const other = await team();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(
        ((await create(other.owner, { name: `P${i}`, phone: newPhone() })).body as Contact).id,
      );
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await list(other.owner, cursor ? { limit: 2, cursor } : { limit: 2 });
      seen.push(...page.items.map((c) => c.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual([...ids].reverse());
    await withSession(request(t.server).get('/v1/contacts'), other.owner)
      .query({ cursor: 'nope' })
      .expect(400);
  });
});

describe('agentContactVisibility = "assigned" (software-agency default)', () => {
  let tm: Team;
  let mine: Contact;
  let typed: string;
  beforeAll(async () => {
    tm = await team('software-agency');
    typed = newPhone();
    mine = (
      await create(tm.agentA, {
        name: 'Agent A’s customer',
        phone: typed,
        email: uniqueEmail('a'),
      }).expect(201)
    ).body as Contact;
  });

  it('the template default is "assigned"', async () => {
    const res = await withSession(request(t.server).get('/v1/crm/settings'), tm.agentA).expect(200);
    expect(res.body as CrmSettings).toEqual({ agentContactVisibility: 'assigned' });
  });

  it('an agent sees contacts they created; another agent sees nothing of them (404, not 403)', async () => {
    expect((await list(tm.agentA)).items.map((c) => c.id)).toContain(mine.id);
    expect((await list(tm.agentB)).items.map((c) => c.id)).not.toContain(mine.id);
    expect((await list(tm.agentB, { q: 'Agent A' })).items).toEqual([]);
    await get(tm.agentB, mine.id).expect(404);
    await withSession(request(t.server).patch(`/v1/contacts/${mine.id}`), tm.agentB)
      .send({ city: 'Hijack' })
      .expect(404);
  });

  it('owners, admins and managers always see all', async () => {
    for (const s of [tm.owner, tm.admin, tm.manager]) await get(s, mine.id).expect(200);
  });

  it('duplicate by an agent who can’t see it: only "exists" + who owns it — no contact details', async () => {
    const res = await create(tm.agentB, { name: 'Same person', phone: typed }).expect(409);
    expect((res.body as { conflict: unknown }).conflict).toEqual({
      field: 'phone',
      ownerName: tm.agentA.name,
    });
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(mine.id);
    expect(text).not.toContain('customer');
    expect(text).not.toContain(e164(typed));
  });

  it('the same duplicate for someone who can see it includes the contact', async () => {
    const res = await create(tm.manager, { name: 'Same person', phone: typed }).expect(409);
    expect((res.body as { conflict: unknown }).conflict).toEqual({
      field: 'phone',
      ownerName: tm.agentA.name,
      contact: { id: mine.id, name: 'Agent A’s customer' },
    });
  });
});

describe('agentContactVisibility = "all" (repair-shop default) and switching it', () => {
  let tm: Team;
  let contact: Contact;
  let typed: string;
  beforeAll(async () => {
    tm = await team('repair-shop');
    typed = newPhone();
    contact = (await create(tm.agentA, { name: 'Walk-in Ravi', phone: typed }).expect(201))
      .body as Contact;
  });

  it('the template default is "all": every agent sees and searches every contact', async () => {
    const res = await withSession(request(t.server).get('/v1/crm/settings'), tm.agentB).expect(200);
    expect(res.body).toEqual({ agentContactVisibility: 'all' });
    await get(tm.agentB, contact.id).expect(200);
    expect((await list(tm.agentB, { q: 'Ravi' })).items.map((c) => c.id)).toEqual([contact.id]);
  });

  it('duplicates show the existing contact to any agent', async () => {
    const res = await create(tm.agentB, { name: 'Ravi again', phone: typed }).expect(409);
    expect((res.body as { conflict: unknown }).conflict).toMatchObject({
      contact: { id: contact.id },
    });
  });

  it('only owners/admins change the setting (audited); it applies at once', async () => {
    for (const s of [tm.manager, tm.agentA]) await setVisibility(s, 'assigned').expect(403);
    await setVisibility(tm.admin, 'bogus').expect(400);
    await setVisibility(tm.admin, 'assigned').expect(200);
    await get(tm.agentB, contact.id).expect(404);
    await get(tm.agentA, contact.id).expect(200); // creator keeps sight
    await setVisibility(tm.owner, 'all').expect(200);
    await get(tm.agentB, contact.id).expect(200);
  });
});
