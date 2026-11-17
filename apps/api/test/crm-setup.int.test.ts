import { randomUUID } from 'node:crypto';
import { createDb, tenants, withTenant } from '@revops/db';
import { loadTestDatabaseEnv } from '@revops/db/testing';
import { INDUSTRY_TEMPLATES, type LeadSourceList, type PipelineList, ROLES } from '@revops/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type LoggedIn,
  PASSWORD,
  type TestApp,
  addMember,
  createTestApp,
  login,
  uniqueEmail,
  verify,
  withSession,
} from './test-app';

// M1-T3a: the industry template picked at signup seeds the tenant's CRM setup; tenants created
// before M1 get theirs lazily on first CRM access.
let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

async function signUpAs(industry?: string): Promise<LoggedIn> {
  const email = uniqueEmail('crm');
  await request(t.server)
    .post('/v1/auth/signup')
    .send({ name: 'Owner', email, password: PASSWORD, tenantName: 'Biz', industry })
    .expect(202);
  await t.drain();
  await verify(t, t.email.lastTokenTo(email)).expect(204);
  return login(t, email);
}

const pipelinesOf = async (s: LoggedIn) =>
  (await withSession(request(t.server).get('/v1/pipelines'), s).expect(200)).body as PipelineList;
const sourcesOf = async (s: LoggedIn) =>
  (await withSession(request(t.server).get('/v1/lead-sources'), s).expect(200))
    .body as LeadSourceList;

describe('CRM setup from the industry template (M1-T3a)', () => {
  it('repair-shop at signup: Inquiries (default) + Repair jobs, walk-in source', async () => {
    const owner = await signUpAs('repair-shop');
    const { items } = await pipelinesOf(owner);
    expect(items.map((p) => [p.name, p.isDefault])).toEqual([
      ['Inquiries', true],
      ['Repair jobs', false],
    ]);
    expect(items[1]?.stages.map((s) => s.name)).toEqual(
      INDUSTRY_TEMPLATES['repair-shop'].pipelines[1]?.stages.map((s) => s.name),
    );
    expect(items[1]?.lostReasons).toContain('Not repairable');
    expect((await sourcesOf(owner)).items.map((s) => s.type)).toContain('walk_in');
  });

  it('software-agency at signup: the project inquiries pipeline', async () => {
    const owner = await signUpAs('software-agency');
    const { items } = await pipelinesOf(owner);
    expect(items.map((p) => p.name)).toEqual(['Project inquiries']);
    expect(items[0]?.stages.map((s) => s.category)).toEqual([
      'open',
      'open',
      'open',
      'open',
      'won',
      'lost',
    ]);
  });

  it('no business type → generic', async () => {
    const owner = await signUpAs(undefined);
    expect((await pipelinesOf(owner)).items.map((p) => p.key)).toEqual(['sales']);
  });

  it('an unknown business type is a 400 validation error (nothing queued)', async () => {
    const before = t.jobs.jobs.length;
    const res = await request(t.server)
      .post('/v1/auth/signup')
      .send({
        name: 'X',
        email: uniqueEmail('bad'),
        password: PASSWORD,
        tenantName: 'X',
        industry: 'spaceships',
      })
      .expect(400);
    expect(res.body).toMatchObject({ code: 'validation_failed' });
    expect(t.jobs.jobs.length).toBe(before);
  });

  it('a tenant created before M1 is provisioned lazily from its stored template, once', async () => {
    const tenantId = randomUUID();
    const db = createDb(loadTestDatabaseEnv().appUrl, { max: 1 });
    try {
      await withTenant(db.db, tenantId, (tx) =>
        tx.insert(tenants).values({
          id: tenantId,
          name: 'Old clinic',
          slug: `old-${tenantId}`,
          industryTemplate: 'clinic',
        }),
      );
    } finally {
      await db.close();
    }
    const { email } = await addMember(t, tenantId, 'agent');
    const agent = await login(t, email);
    const [first, second] = await Promise.all([pipelinesOf(agent), pipelinesOf(agent)]);
    expect(first.items.map((p) => p.key)).toEqual(['patient_enquiries']);
    expect(second).toEqual(first);
    expect((await sourcesOf(agent)).items.length).toBe(
      INDUSTRY_TEMPLATES.clinic.leadSources.length,
    );
  });

  it('every role can read the setup; signed-out callers get 401', async () => {
    const owner = await signUpAs('education');
    const tenantId = owner.body.tenant?.id ?? '';
    for (const role of ROLES) {
      const session =
        role === 'owner' ? owner : await login(t, (await addMember(t, tenantId, role)).email);
      const { items } = await pipelinesOf(session);
      expect(items[0]?.key).toBe('admissions');
    }
    await request(t.server).get('/v1/pipelines').expect(401);
    await request(t.server).get('/v1/lead-sources').expect(401);
  });

  it('a tenant only ever sees its own setup', async () => {
    const a = await signUpAs('repair-shop');
    const b = await signUpAs('software-agency');
    const aIds = new Set((await pipelinesOf(a)).items.map((p) => p.id));
    for (const p of (await pipelinesOf(b)).items) expect(aIds.has(p.id)).toBe(false);
  });
});
