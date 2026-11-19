import type { Contact, Lead, Pipeline, Role } from '@revops/shared';
import type postgres from 'postgres';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CRM_RATE_LIMITS } from '../src/modules/crm/crm-rate-limits';
import { RateLimiter } from '../src/platform/rate-limit/rate-limiter';
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

// M2-T0: contact delete refuses while leads exist; pipeline/contact deletes vs concurrent lead
// writes (row locks); per-user rate limits on create, bulk and export.
let t: TestApp;
let owner: LoggedIn;
let manager: LoggedIn;
let tenantId: string;

async function signupOwner(tenantName: string): Promise<LoggedIn> {
  const email = uniqueEmail('owner');
  await request(t.server)
    .post('/v1/auth/signup')
    .send({ name: 'Owner', email, password: PASSWORD, tenantName, industry: 'real-estate' })
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
const phone = () => `97${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
const errorsOf = (res: request.Response) =>
  (res.body as { errors?: { path: string; message: string }[] }).errors ?? [];

beforeAll(async () => {
  t = await createTestApp();
  owner = await signupOwner('Guards Realty');
  tenantId = owner.body.tenant?.id ?? '';
  const as = async (role: Role) => login(t, (await addMember(t, tenantId, role)).email);
  manager = await as('manager');
});
afterAll(() => t.close());

/**
 * Runs `hold` in an owner transaction (tenant context set), starts `request` while the rows
 * `hold` locked are still locked, waits until that request is blocked on a lock, then runs
 * `finish` in the same transaction and commits. Returns the request's response.
 */
async function whileLocked(
  hold: (tx: postgres.TransactionSql) => Promise<unknown>,
  start: () => request.Test,
  finish: (tx: postgres.TransactionSql) => Promise<unknown>,
): Promise<request.Response> {
  let pending: Promise<request.Response> | undefined;
  await asTestOwner((probe) =>
    asTestOwner((sql) =>
      sql.begin(async (tx) => {
        await tx`select set_config('app.tenant_id', ${tenantId}, true)`;
        await hold(tx);
        pending = start().then((r) => r);
        // Wait until the app's statement is waiting on our lock (not just slow).
        for (let i = 0; i < 400; i += 1) {
          const [row] = await probe<{ n: number }[]>`
            select count(*)::int as n from pg_stat_activity
            where wait_event_type = 'Lock' and usename = 'app_user'`;
          if ((row?.n ?? 0) > 0) break;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        await finish(tx);
      }),
    ),
  );
  if (!pending) throw new Error('request not started');
  return pending;
}

describe('contact delete with leads (Dev decision M2-T0)', () => {
  it('refuses with 409 contact_has_leads and the live lead count; deletes once they are gone', async () => {
    const contact = (
      await api(owner).post('/v1/contacts', { name: 'Has Leads', phone: phone() }).expect(201)
    ).body as Contact;
    const leads: Lead[] = [];
    for (let i = 0; i < 2; i += 1) {
      leads.push(
        (await api(owner).post('/v1/leads', { contactId: contact.id }).expect(201)).body as Lead,
      );
    }
    const refused = await api(manager).del(`/v1/contacts/${contact.id}`).expect(409);
    expect(refused.body).toMatchObject({ code: 'contact_has_leads', leadCount: 2 });
    expect((refused.body as { title: string }).title).toMatch(/2 leads.*delete them or move/);
    await api(owner).get(`/v1/contacts/${contact.id}`).expect(200);

    await api(owner)
      .del(`/v1/leads/${leads[0]?.id ?? ''}`)
      .expect(204);
    const one = await api(manager).del(`/v1/contacts/${contact.id}`).expect(409);
    expect(one.body).toMatchObject({ leadCount: 1 });
    expect((one.body as { title: string }).title).toMatch(/1 lead /);

    // Soft-deleted leads don't count.
    await api(owner)
      .del(`/v1/leads/${leads[1]?.id ?? ''}`)
      .expect(204);
    await api(manager).del(`/v1/contacts/${contact.id}`).expect(204);
    await api(owner).get(`/v1/contacts/${contact.id}`).expect(404);
  });

  it('a lead create linking a contact that is being deleted waits, then finds it gone', async () => {
    const contact = (
      await api(owner).post('/v1/contacts', { name: 'Racing', phone: phone() }).expect(201)
    ).body as Contact;
    const res = await whileLocked(
      (tx) => tx`select id from contacts where id = ${contact.id} for update`,
      () => api(owner).post('/v1/leads', { contactId: contact.id }),
      (tx) => tx`update contacts set deleted_at = now() where id = ${contact.id}`,
    );
    expect(res.status).toBe(400);
    expect(errorsOf(res)).toEqual([{ path: 'contactId', message: 'unknown contact' }]);
    const [row] = await asTestOwner((sql) =>
      sql.begin(async (tx) => {
        await tx`select set_config('app.tenant_id', ${tenantId}, true)`;
        return tx<
          { n: number }[]
        >`select count(*)::int as n from leads where contact_id = ${contact.id}`;
      }),
    );
    expect(row?.n).toBe(0);
  });
});

describe('pipeline delete vs lead writes (row locks)', () => {
  const newPipeline = async (name: string) =>
    (await api(owner).post('/v1/pipelines', { name }).expect(201)).body as Pipeline;

  it('a lead create into a pipeline being deleted waits, then gets 400 unknown pipeline', async () => {
    const pipeline = await newPipeline(`Doomed ${Date.now()}`);
    const res = await whileLocked(
      (tx) => tx`select id from pipelines where id = ${pipeline.id} for update`,
      () =>
        api(owner).post('/v1/leads', {
          pipelineId: pipeline.id,
          contact: { name: 'Late', phone: phone() },
        }),
      (tx) => tx`update pipelines set deleted_at = now() where id = ${pipeline.id}`,
    );
    expect(res.status).toBe(400);
    expect(errorsOf(res)).toEqual([{ path: 'pipelineId', message: 'unknown pipeline' }]);
  });

  it('a stage move / bulk move into a pipeline being deleted waits, then gets 400', async () => {
    const lead = (
      await api(owner)
        .post('/v1/leads', { contact: { name: 'Mover', phone: phone() } })
        .expect(201)
    ).body as Lead;
    for (const move of [
      (p: Pipeline) =>
        api(owner).post(`/v1/leads/${lead.id}/stage`, {
          pipelineId: p.id,
          stageId: p.stages[0]?.id,
        }),
      (p: Pipeline) =>
        api(owner).post('/v1/leads/bulk-stage', {
          leadIds: [lead.id],
          stageId: p.stages[0]?.id,
          pipelineId: p.id,
        }),
      (p: Pipeline) =>
        api(owner).post('/v1/leads/bulk-stage', { leadIds: [lead.id], stageId: p.stages[0]?.id }),
    ]) {
      const pipeline = await newPipeline(`Doomed move ${Date.now()}-${Math.random()}`);
      const res = await whileLocked(
        (tx) => tx`select id from pipelines where id = ${pipeline.id} for update`,
        () => move(pipeline),
        (tx) => tx`update pipelines set deleted_at = now() where id = ${pipeline.id}`,
      );
      expect(res.status).toBe(400);
    }
    const after = (await api(owner).get(`/v1/leads/${lead.id}`).expect(200)).body as Lead;
    expect(after.pipelineId).toBe(lead.pipelineId);
  }, 180_000);

  it('pipeline delete waits for an in-flight lead write and then refuses (409)', async () => {
    const pipeline = await newPipeline(`Busy ${Date.now()}`);
    const res = await whileLocked(
      // An in-flight lead write: holds the pipeline FOR SHARE and inserts a lead.
      async (tx) => {
        await tx`select id from pipelines where id = ${pipeline.id} for share`;
        const [contact] = await tx<{ id: string }[]>`
          insert into contacts (tenant_id, name, phone_e164)
          values (${tenantId}, 'Inflight', ${`+91${phone()}`}) returning id`;
        await tx`
          insert into leads (tenant_id, contact_id, pipeline_id, stage_id, status)
          values (${tenantId}, ${contact?.id ?? ''}, ${pipeline.id}, ${pipeline.stages[0]?.id ?? ''}, 'open')`;
      },
      () => api(owner).del(`/v1/pipelines/${pipeline.id}`),
      () => Promise.resolve(),
    );
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ leadCount: 1 });
  });

  it('concurrent stage-delete-with-move and lead stage changes never deadlock or 500', async () => {
    for (let round = 0; round < 4; round += 1) {
      const pipeline = await newPipeline(`Churn ${Date.now()}-${round}`);
      const [from, to] = pipeline.stages.filter((s) => s.category === 'open');
      if (!from || !to) throw new Error('need two open stages');
      const leads: Lead[] = [];
      for (let i = 0; i < 3; i += 1) {
        leads.push(
          (
            await api(owner)
              .post('/v1/leads', {
                pipelineId: pipeline.id,
                stageId: from.id,
                contact: { name: `Churn ${i}`, phone: phone() },
              })
              .expect(201)
          ).body as Lead,
        );
      }
      const results = await Promise.all([
        api(owner).del(`/v1/pipelines/${pipeline.id}/stages/${from.id}?moveTo=${to.id}`),
        ...leads.map((l) => api(owner).post(`/v1/leads/${l.id}/stage`, { stageId: from.id })),
        api(owner).post('/v1/leads/bulk-stage', {
          leadIds: leads.map((l) => l.id),
          stageId: from.id,
        }),
      ]);
      for (const r of results) expect(r.status, JSON.stringify(r.body)).toBeLessThan(500);
    }
  }, 180_000);
});

describe('per-user rate limits on create, bulk and export', () => {
  /** Uses up a bucket in-process (the same Postgres limiter the API uses). */
  const exhaust = async (bucket: keyof typeof CRM_RATE_LIMITS, session: LoggedIn) => {
    const { limit, windowMs } = CRM_RATE_LIMITS[bucket];
    const key = `crm-${bucket}:${tenantId}:${session.body.user.id}`;
    const limiter = t.app.get(RateLimiter);
    for (let i = 0; i < limit; i += 1) await limiter.consume(key, limit, windowMs);
  };

  it('contact and lead create share one bucket per user; others are unaffected', async () => {
    const user = await login(t, (await addMember(t, tenantId, 'manager')).email);
    await exhaust('create', user);
    const contact = await api(user).post('/v1/contacts', { name: 'X', phone: phone() });
    expect(contact.status).toBe(429);
    expect(contact.body).toMatchObject({ code: 'rate_limited' });
    expect(Number(contact.headers['retry-after'])).toBeGreaterThan(0);
    await api(user)
      .post('/v1/leads', { contact: { name: 'Y', phone: phone() } })
      .expect(429);
    // Another user of the same tenant still can.
    await api(manager).post('/v1/contacts', { name: 'Z', phone: phone() }).expect(201);
    // The window ends.
    t.clock.advance(CRM_RATE_LIMITS.create.windowMs + 1000);
    await api(user).post('/v1/contacts', { name: 'X', phone: phone() }).expect(201);
  });

  it('bulk assign and bulk stage share the bulk bucket', async () => {
    const user = await login(t, (await addMember(t, tenantId, 'manager')).email);
    const lead = (
      await api(user)
        .post('/v1/leads', { contact: { name: 'B', phone: phone() } })
        .expect(201)
    ).body as Lead;
    await exhaust('bulk', user);
    await api(user)
      .post('/v1/leads/bulk-assign', { leadIds: [lead.id], ownerUserId: null })
      .expect(429);
    await api(user)
      .post('/v1/leads/bulk-stage', { leadIds: [lead.id], stageId: lead.stageId })
      .expect(429);
  });

  it('export is limited per user; a refused (403) export does not use the allowance', async () => {
    const user = await login(t, (await addMember(t, tenantId, 'manager')).email);
    await api(user).get('/v1/exports/leads.csv').expect(200);
    const agent = await login(t, (await addMember(t, tenantId, 'agent')).email);
    for (let i = 0; i < CRM_RATE_LIMITS.export.limit + 1; i += 1) {
      await api(agent).get('/v1/exports/leads.csv').expect(403);
    }
    await exhaust('export', user);
    await api(user).get('/v1/exports/leads.csv').expect(429);
  });
});
