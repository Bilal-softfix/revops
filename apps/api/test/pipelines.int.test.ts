import type {
  CustomFieldDef,
  CustomFieldDefList,
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

// M1-T3b: pipeline & stage management, the stage-delete AC (bulk move), and pipeline scoping of
// lead custom fields (incl. cross-tenant pipeline ids).
let t: TestApp;
let owner: LoggedIn;
let admin: LoggedIn;
let manager: LoggedIn;
let agent: LoggedIn;
let other: LoggedIn; // owner of another (repair-shop) tenant
let tenantId: string;

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

beforeAll(async () => {
  t = await createTestApp();
  owner = await signupOwner('Fix It', 'repair-shop');
  tenantId = owner.body.tenant?.id ?? '';
  const as = async (role: Role) => login(t, (await addMember(t, tenantId, role)).email);
  admin = await as('admin');
  manager = await as('manager');
  agent = await as('agent');
  other = await signupOwner('Other Shop', 'repair-shop');
});
afterAll(() => t.close());

const api = (s: LoggedIn) => ({
  get: (path: string) => withSession(request(t.server).get(path), s),
  post: (path: string, body: object) => withSession(request(t.server).post(path), s).send(body),
  patch: (path: string, body: object) => withSession(request(t.server).patch(path), s).send(body),
  put: (path: string, body: object) => withSession(request(t.server).put(path), s).send(body),
  del: (path: string) => withSession(request(t.server).delete(path), s),
});
const pipelinesOf = async (s: LoggedIn) =>
  ((await api(s).get('/v1/pipelines').expect(200)).body as PipelineList).items;
const byKey = async (s: LoggedIn, key: string) => {
  const found = (await pipelinesOf(s)).find((p) => p.key === key);
  if (!found) throw new Error(`no pipeline ${key}`);
  return found;
};
const leadFields = async (s: LoggedIn) =>
  ((await api(s).get('/v1/custom-fields?entity=lead').expect(200)).body as CustomFieldDefList)
    .items;
const errorsOf = (res: request.Response) =>
  (res.body as { errors?: { path: string; message: string }[] }).errors ?? [];

/** Leads have no API until M1-T4: insert them directly (as the owner role, in tenant context). */
async function insertLeads(
  tenant: string,
  pipelineId: string,
  stageId: string,
  n: number,
  deleted = false,
): Promise<void> {
  await asTestOwner((sql) =>
    sql.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', ${tenant}, true)`;
      const [contact] = await tx<{ id: string }[]>`
        insert into contacts (tenant_id, name, email)
        values (${tenant}, 'Lead person', ${uniqueEmail('lead')}) returning id`;
      for (let i = 0; i < n; i++) {
        await tx`
          insert into leads (tenant_id, contact_id, pipeline_id, stage_id, deleted_at)
          values (${tenant}, ${contact?.id ?? ''}, ${pipelineId}, ${stageId},
                  ${deleted ? new Date() : null})`;
      }
    }),
  );
}
async function leadStages(tenant: string, pipelineId: string): Promise<string[]> {
  return asTestOwner((sql) =>
    sql.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', ${tenant}, true)`;
      const rows = await tx<{ stage_id: string }[]>`
        select stage_id from leads where pipeline_id = ${pipelineId}`;
      return rows.map((r) => r.stage_id);
    }),
  );
}

describe('permissions', () => {
  it('owners and admins manage pipelines; managers and agents get 403 but can read', async () => {
    for (const s of [manager, agent]) {
      await api(s).post('/v1/pipelines', { name: 'Nope' }).expect(403);
      expect((await pipelinesOf(s)).length).toBe(2);
    }
    const created = await api(admin).post('/v1/pipelines', { name: 'Admin made' }).expect(201);
    await api(admin)
      .del(`/v1/pipelines/${(created.body as Pipeline).id}`)
      .expect(204);
  });
});

describe('pipelines', () => {
  it('creates a pipeline with default stages, appended last; names are unique', async () => {
    const res = await api(owner).post('/v1/pipelines', { name: 'Corporate' }).expect(201);
    const pipeline = res.body as Pipeline;
    expect(pipeline).toMatchObject({ name: 'Corporate', isDefault: false, key: null });
    expect(pipeline.stages.map((s) => [s.name, s.category, s.position])).toEqual([
      ['New', 'open', 0],
      ['In progress', 'open', 1],
      ['Won', 'won', 2],
      ['Lost', 'lost', 3],
    ]);
    expect((await pipelinesOf(owner)).at(-1)?.id).toBe(pipeline.id);
    const dup = await api(owner).post('/v1/pipelines', { name: 'corporate' }).expect(409);
    expect(dup.body).toMatchObject({ code: 'pipeline_name_taken' });
  });

  it('creates with given stages, which need an open one', async () => {
    await api(owner)
      .post('/v1/pipelines', { name: 'Bad', stages: [{ name: 'Done', category: 'won' }] })
      .expect(400);
    const res = await api(owner)
      .post('/v1/pipelines', {
        name: 'AMC',
        stages: [
          { name: 'Due', category: 'open' },
          { name: 'Renewed', category: 'won' },
        ],
        lostReasons: ['Too costly'],
      })
      .expect(201);
    expect((res.body as Pipeline).stages.map((s) => s.probability)).toEqual([50, 100]);
    expect((res.body as Pipeline).lostReasons).toEqual(['Too costly']);
  });

  it('renames, edits lost reasons, and switches the default (exactly one)', async () => {
    const repairs = await byKey(owner, 'repair_jobs');
    const res = await api(owner)
      .patch(`/v1/pipelines/${repairs.id}`, {
        name: 'Repairs',
        lostReasons: ['Not repairable'],
        isDefault: true,
      })
      .expect(200);
    expect(res.body).toMatchObject({ name: 'Repairs', isDefault: true });
    const all = await pipelinesOf(owner);
    expect(all.filter((p) => p.isDefault).map((p) => p.id)).toEqual([repairs.id]);
    await api(owner).patch(`/v1/pipelines/${repairs.id}`, { isDefault: false }).expect(400);
    await api(owner).patch(`/v1/pipelines/${repairs.id}`, { key: 'x' }).expect(400);
    // Restore for the other tests.
    const inquiries = await byKey(owner, 'inquiries');
    await api(owner).patch(`/v1/pipelines/${inquiries.id}`, { isDefault: true }).expect(200);
  });

  it('reorders pipelines (full list only)', async () => {
    const ids = (await pipelinesOf(owner)).map((p) => p.id);
    const reversed = [...ids].reverse();
    const res = await api(owner).put('/v1/pipelines/order', { pipelineIds: reversed }).expect(200);
    expect((res.body as PipelineList).items.map((p) => p.id)).toEqual(reversed);
    await api(owner)
      .put('/v1/pipelines/order', { pipelineIds: reversed.slice(1) })
      .expect(400);
    await api(owner).put('/v1/pipelines/order', { pipelineIds: ids }).expect(200);
  });

  it('the default pipeline and pipelines with leads can’t be deleted', async () => {
    const inquiries = await byKey(owner, 'inquiries');
    const del = await api(owner).del(`/v1/pipelines/${inquiries.id}`).expect(409);
    expect(del.body).toMatchObject({ code: 'pipeline_is_default' });

    const temp = (await api(owner).post('/v1/pipelines', { name: 'Temp' }).expect(201))
      .body as Pipeline;
    await insertLeads(tenantId, temp.id, temp.stages[0]?.id ?? '', 2);
    const busy = await api(owner).del(`/v1/pipelines/${temp.id}`).expect(409);
    expect(busy.body).toMatchObject({ code: 'pipeline_has_leads', leadCount: 2 });

    const empty = (await api(owner).post('/v1/pipelines', { name: 'Empty' }).expect(201))
      .body as Pipeline;
    await api(owner).del(`/v1/pipelines/${empty.id}`).expect(204);
    expect((await pipelinesOf(owner)).map((p) => p.id)).not.toContain(empty.id);
    await api(owner).patch(`/v1/pipelines/${empty.id}`, { name: 'Back?' }).expect(404);
  });

  it('another tenant’s pipeline is a 404 for every write', async () => {
    const theirs = await byKey(other, 'repair_jobs');
    await api(owner).patch(`/v1/pipelines/${theirs.id}`, { name: 'Mine' }).expect(404);
    await api(owner).del(`/v1/pipelines/${theirs.id}`).expect(404);
    await api(owner)
      .post(`/v1/pipelines/${theirs.id}/stages`, { name: 'X', category: 'open' })
      .expect(404);
    const stage = theirs.stages[0]?.id ?? '';
    await api(owner).patch(`/v1/pipelines/${theirs.id}/stages/${stage}`, { name: 'X' }).expect(404);
    await api(owner).del(`/v1/pipelines/${theirs.id}/stages/${stage}`).expect(404);
    expect((await byKey(other, 'repair_jobs')).name).toBe('Repair jobs');
  });
});

describe('stages', () => {
  let pipeline: Pipeline;
  beforeAll(async () => {
    pipeline = (await api(owner).post('/v1/pipelines', { name: 'Stage lab' }).expect(201))
      .body as Pipeline;
  });
  const stage = (name: string) => {
    const found = pipeline.stages.find((s) => s.name === name);
    if (!found) throw new Error(`no stage ${name}`);
    return found;
  };
  const path = (suffix = '') => `/v1/pipelines/${pipeline.id}/stages${suffix}`;

  it('adds (appended, default probability), renames, and rejects duplicate names', async () => {
    const res = await api(owner)
      .post(path(), { name: 'Negotiation', category: 'open' })
      .expect(201);
    pipeline = res.body as Pipeline;
    expect(pipeline.stages.at(-1)).toMatchObject({ name: 'Negotiation', probability: 50 });
    const dup = await api(owner).post(path(), { name: 'won', category: 'won' }).expect(409);
    expect(dup.body).toMatchObject({ code: 'stage_name_taken' });
    pipeline = (
      await api(owner)
        .patch(path(`/${stage('Negotiation').id}`), { name: 'Negotiating', probability: 70 })
        .expect(200)
    ).body as Pipeline;
    expect(stage('Negotiating').probability).toBe(70);
  });

  it('reorders stages (every stage exactly once)', async () => {
    const ids = pipeline.stages.map((s) => s.id);
    const moved = [ids[4] ?? '', ...ids.slice(0, 4)];
    pipeline = (await api(owner).put(path('/order'), { stageIds: moved }).expect(200))
      .body as Pipeline;
    expect(pipeline.stages.map((s) => s.id)).toEqual(moved);
    expect(pipeline.stages.map((s) => s.position)).toEqual([0, 1, 2, 3, 4]);
    await api(owner)
      .put(path('/order'), { stageIds: ids.slice(1) })
      .expect(400);
    const theirs = (await byKey(other, 'inquiries')).stages.map((s) => s.id);
    await api(owner)
      .put(path('/order'), { stageIds: [...ids.slice(1), theirs[0]] })
      .expect(400);
  });

  it('AC: a stage with leads can’t be deleted without a target; with one, leads move', async () => {
    const from = stage('New');
    await insertLeads(tenantId, pipeline.id, from.id, 3);
    await insertLeads(tenantId, pipeline.id, from.id, 1, true); // soft-deleted lead

    const refused = await api(owner)
      .del(path(`/${from.id}`))
      .expect(409);
    expect(refused.body).toMatchObject({ code: 'stage_has_leads', leadCount: 3 });
    // Only the other OPEN stages of this pipeline are offered.
    expect([...(refused.body as { targetStageIds: string[] }).targetStageIds].sort()).toEqual(
      [stage('In progress').id, stage('Negotiating').id].sort(),
    );

    // The target must be another stage of the same pipeline and category.
    await api(owner)
      .del(path(`/${from.id}?moveTo=${stage('Won').id}`))
      .expect(400);
    await api(owner)
      .del(path(`/${from.id}?moveTo=${from.id}`))
      .expect(400);
    const foreign = (await byKey(other, 'inquiries')).stages[0]?.id ?? '';
    await api(owner)
      .del(path(`/${from.id}?moveTo=${foreign}`))
      .expect(400);

    const res = await api(owner)
      .del(path(`/${from.id}?moveTo=${stage('In progress').id}`))
      .expect(200);
    const target = stage('In progress').id;
    pipeline = res.body as Pipeline;
    expect(pipeline.stages.map((s) => s.id)).not.toContain(from.id);
    expect(pipeline.stages.map((s) => s.position)).toEqual([0, 1, 2, 3]);
    expect(await leadStages(tenantId, pipeline.id)).toEqual([target, target, target, target]);

    const [audit] = await asTestOwner((sql) =>
      sql.begin(async (tx) => {
        await tx`select set_config('app.tenant_id', ${tenantId}, true)`;
        return tx<{ after: Record<string, unknown> }[]>`
          select after from audit_logs
          where action = 'pipeline_stage.deleted' and entity_id = ${from.id}`;
      }),
    );
    expect(audit?.after).toMatchObject({ movedLeads: 3, movedTo: target });
  });

  it('an empty stage deletes without a target', async () => {
    const res = await api(owner)
      .del(path(`/${stage('Negotiating').id}`))
      .expect(200);
    pipeline = res.body as Pipeline;
    expect(pipeline.stages.map((s) => s.name)).toEqual(['In progress', 'Won', 'Lost']);
  });

  it('a won/lost stage with leads and no same-category stage can’t be deleted yet', async () => {
    await insertLeads(tenantId, pipeline.id, stage('Won').id, 1);
    const res = await api(owner)
      .del(path(`/${stage('Won').id}`))
      .expect(409);
    expect(res.body).toMatchObject({ code: 'stage_has_leads', leadCount: 1, targetStageIds: [] });
  });

  it('keeps at least one open stage; a stage with leads can’t change category', async () => {
    const open = stage('In progress');
    const last = await api(owner)
      .del(path(`/${open.id}`))
      .expect(409);
    expect(last.body).toMatchObject({ code: 'last_open_stage' });
    await api(owner)
      .patch(path(`/${open.id}`), { category: 'won' })
      .expect(409);
    const locked = await api(owner)
      .patch(path(`/${stage('Won').id}`), { category: 'lost' })
      .expect(409);
    expect(locked.body).toMatchObject({ code: 'stage_category_locked', leadCount: 1 });
    // An empty stage can change category.
    pipeline = (
      await api(owner)
        .patch(path(`/${stage('Lost').id}`), { category: 'open' })
        .expect(200)
    ).body as Pipeline;
    expect(stage('Lost').category).toBe('open');
  });
});

describe('custom fields: pipeline scoping', () => {
  it('repair-shop template: device basics apply to all, job details to Repair jobs only', async () => {
    const repairs = await byKey(owner, 'repair_jobs');
    const scope = Object.fromEntries((await leadFields(agent)).map((f) => [f.key, f.pipelineIds]));
    expect(scope).toMatchObject({
      device_brand: null,
      device_model: null,
      issue: null,
      imei_serial: [repairs.id],
      estimate_inr: [repairs.id],
      advance_paid_inr: [repairs.id],
      promised_date: [repairs.id],
      under_warranty: [repairs.id],
    });
  });

  it('creates a scoped lead field and changes its scope; contact fields can’t be scoped', async () => {
    const inquiries = await byKey(owner, 'inquiries');
    const repairs = await byKey(owner, 'repair_jobs');
    const created = (
      await api(owner)
        .post('/v1/custom-fields', {
          entity: 'lead',
          key: 'pickup_slot',
          label: 'Pickup slot',
          type: 'text',
          pipelineIds: [repairs.id],
        })
        .expect(201)
    ).body as CustomFieldDef;
    expect(created.pipelineIds).toEqual([repairs.id]);

    const both = await api(owner)
      .patch(`/v1/custom-fields/${created.id}`, { pipelineIds: [inquiries.id, repairs.id] })
      .expect(200);
    expect((both.body as CustomFieldDef).pipelineIds).toEqual([inquiries.id, repairs.id]);
    const all = await api(owner)
      .patch(`/v1/custom-fields/${created.id}`, { pipelineIds: null, label: 'Pickup' })
      .expect(200);
    expect(all.body).toMatchObject({ pipelineIds: null, label: 'Pickup' });

    await api(owner)
      .post('/v1/custom-fields', {
        entity: 'contact',
        key: 'scoped_contact',
        label: 'S',
        type: 'text',
        pipelineIds: [repairs.id],
      })
      .expect(400);
    const contactField = (
      await api(owner)
        .post('/v1/custom-fields', { entity: 'contact', key: 'gst_no', label: 'GST', type: 'text' })
        .expect(201)
    ).body as CustomFieldDef;
    expect(contactField.pipelineIds).toBeNull();
    await api(owner)
      .patch(`/v1/custom-fields/${contactField.id}`, { pipelineIds: [repairs.id] })
      .expect(400);
  });

  it('rejects another tenant’s pipeline ids (and unknown/deleted ones); nothing is written', async () => {
    const theirs = await byKey(other, 'repair_jobs');
    const mine = await byKey(owner, 'repair_jobs');
    const create = await api(owner)
      .post('/v1/custom-fields', {
        entity: 'lead',
        key: 'hijack',
        label: 'Hijack',
        type: 'text',
        pipelineIds: [theirs.id],
      })
      .expect(400);
    expect(errorsOf(create)).toEqual([{ path: 'pipelineIds', message: 'unknown pipeline' }]);
    expect((await leadFields(owner)).map((f) => f.key)).not.toContain('hijack');

    const imei = (await leadFields(owner)).find((f) => f.key === 'imei_serial');
    await api(owner)
      .patch(`/v1/custom-fields/${imei?.id ?? ''}`, { pipelineIds: [mine.id, theirs.id] })
      .expect(400);
    expect((await leadFields(owner)).find((f) => f.key === 'imei_serial')?.pipelineIds).toEqual([
      mine.id,
    ]);

    const gone = (await api(owner).post('/v1/pipelines', { name: 'Gone' }).expect(201))
      .body as Pipeline;
    await api(owner).del(`/v1/pipelines/${gone.id}`).expect(204);
    await api(owner)
      .patch(`/v1/custom-fields/${imei?.id ?? ''}`, { pipelineIds: [gone.id] })
      .expect(400);
  });

  it('deleting a pipeline drops it from fields’ scope (field then applies nowhere)', async () => {
    const solo = (await api(owner).post('/v1/pipelines', { name: 'Solo' }).expect(201))
      .body as Pipeline;
    const field = (
      await api(owner)
        .post('/v1/custom-fields', {
          entity: 'lead',
          key: 'solo_only',
          label: 'Solo only',
          type: 'text',
          pipelineIds: [solo.id],
        })
        .expect(201)
    ).body as CustomFieldDef;
    await api(owner).del(`/v1/pipelines/${solo.id}`).expect(204);
    expect((await leadFields(owner)).find((f) => f.id === field.id)?.pipelineIds).toEqual([]);
  });
});
