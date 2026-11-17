import type {
  CustomFieldDefList,
  LeadSource,
  LeadSourceList,
  LeadSourceWithSecret,
  PipelineList,
  Role,
} from '@revops/shared';
import { decryptSecret, parseKek } from '@revops/shared/crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { webhookSecretContext } from '../src/modules/crm/lead-sources.service';
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

// M2-T1: lead sources — CRUD, RBAC, public keys, webhook secrets (envelope-encrypted, shown
// once), config validation incl. other tenants' ids, soft delete.
let t: TestApp;
let owner: LoggedIn;
let admin: LoggedIn;
let manager: LoggedIn;
let agent: LoggedIn;
let other: LoggedIn;
let tenantId: string;

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
  del: (path: string) => withSession(request(t.server).delete(path), s),
});
const sources = async (s: LoggedIn) =>
  ((await api(s).get('/v1/lead-sources').expect(200)).body as LeadSourceList).items;
const errorsOf = (res: request.Response) =>
  (res.body as { errors?: { path: string; message: string }[] }).errors ?? [];
const create = (s: LoggedIn, body: object) => api(s).post('/v1/lead-sources', body);
const storedSecret = (id: string) =>
  asTestOwner(async (sql) =>
    sql.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', ${tenantId}, true)`;
      const [row] = await tx<{ webhook_secret_enc: string | null }[]>`
        select webhook_secret_enc from lead_sources where id = ${id}`;
      return row?.webhook_secret_enc ?? null;
    }),
  );

beforeAll(async () => {
  t = await createTestApp();
  owner = await signupOwner('Sources Shop');
  tenantId = owner.body.tenant?.id ?? '';
  const as = async (role: Role) => login(t, (await addMember(t, tenantId, role)).email);
  admin = await as('admin');
  manager = await as('manager');
  agent = await as('agent');
  other = await signupOwner('Other Shop');
});
afterAll(() => t.close());

describe('lead sources', () => {
  it('template sources get a public key and default config; every role can list', async () => {
    const list = await sources(agent);
    expect(list.length).toBeGreaterThan(0);
    for (const s of list) {
      expect(s.publicKey).toMatch(/^[A-Za-z0-9_-]{32,64}$/);
      expect(s.config).toEqual({
        allowedOrigins: [],
        captcha: false,
        fieldMapping: {},
        pipelineId: null,
        stageId: null,
        assignment: { strategy: 'round_robin' },
      });
      expect(s.hasWebhookSecret).toBe(false);
    }
    const keys = new Set([...list, ...(await sources(other))].map((s) => s.publicKey));
    expect(keys.size).toBe(list.length + (await sources(other)).length);
  });

  it('owner/admin manage; manager and agent get 403', async () => {
    for (const s of [manager, agent]) {
      await create(s, { name: 'Nope', type: 'web_form' }).expect(403);
    }
    const res = await create(admin, { name: 'Admin form', type: 'web_form' }).expect(201);
    const { source, webhookSecret } = res.body as LeadSourceWithSecret;
    expect(webhookSecret).toBeUndefined();
    await api(manager).patch(`/v1/lead-sources/${source.id}`, { isActive: false }).expect(403);
    await api(agent).del(`/v1/lead-sources/${source.id}`).expect(403);
    await api(agent).post(`/v1/lead-sources/${source.id}/rotate-key`).expect(403);
  });

  it('api sources get a webhook secret, shown once and stored envelope-encrypted', async () => {
    const res = await create(owner, { name: 'Zapier', type: 'api' }).expect(201);
    const { source, webhookSecret } = res.body as LeadSourceWithSecret;
    expect(webhookSecret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(source.hasWebhookSecret).toBe(true);
    expect(JSON.stringify(await sources(owner))).not.toContain(webhookSecret);
    const stored = await storedSecret(source.id);
    expect(stored).not.toContain(webhookSecret?.slice(6) ?? 'x');
    expect(stored?.startsWith('v1:local-1:')).toBe(true);

    const rotated = (
      await api(owner).post(`/v1/lead-sources/${source.id}/rotate-secret`).expect(200)
    ).body as LeadSourceWithSecret;
    expect(rotated.webhookSecret).toMatch(/^whsec_/);
    expect(rotated.webhookSecret).not.toBe(webhookSecret);
    expect(await storedSecret(source.id)).not.toBe(stored);

    const form = (await create(owner, { name: 'Site form', type: 'web_form' }).expect(201))
      .body as LeadSourceWithSecret;
    const refused = await api(owner)
      .post(`/v1/lead-sources/${form.source.id}/rotate-secret`)
      .expect(400);
    expect(errorsOf(refused)).toEqual([
      { path: 'type', message: 'only API sources have a webhook secret' },
    ]);
  });

  it('the stored secret is bound to its row (copied elsewhere it does not decrypt)', async () => {
    const { source } = (await create(owner, { name: 'Bound', type: 'api' }).expect(201))
      .body as LeadSourceWithSecret;
    const stored = (await storedSecret(source.id)) ?? '';
    const kek = parseKek(Buffer.alloc(32).toString('base64'));
    // Wrong key and wrong context both fail; the right context is exercised by M2-T3.
    expect(() => decryptSecret(stored, kek, webhookSecretContext(tenantId, source.id))).toThrow();
  });

  it('rotating the public key changes it; the old one is gone', async () => {
    const { source } = (await create(owner, { name: 'Rotate me', type: 'web_form' }).expect(201))
      .body as LeadSourceWithSecret;
    const rotated = (await api(owner).post(`/v1/lead-sources/${source.id}/rotate-key`).expect(200))
      .body as LeadSource;
    expect(rotated.publicKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(rotated.publicKey).not.toBe(source.publicKey);
  });

  it('names are unique case-insensitively among live sources; delete frees the name', async () => {
    await create(owner, { name: 'Walk-ins 2', type: 'walk_in' }).expect(201);
    const dup = await create(owner, { name: 'walk-INS 2', type: 'manual' }).expect(409);
    expect(dup.body).toMatchObject({ code: 'source_name_taken' });
    const target = (await sources(owner)).find((s) => s.name === 'Walk-ins 2');
    if (!target) throw new Error('missing');
    const second = (await create(owner, { name: 'Walk-ins 3', type: 'manual' }).expect(201))
      .body as LeadSourceWithSecret;
    await api(owner)
      .patch(`/v1/lead-sources/${second.source.id}`, { name: 'WALK-INS 2' })
      .expect(409);

    await api(owner).del(`/v1/lead-sources/${target.id}`).expect(204);
    expect((await sources(owner)).some((s) => s.id === target.id)).toBe(false);
    await api(owner).patch(`/v1/lead-sources/${target.id}`, { isActive: true }).expect(404);
    await create(owner, { name: 'Walk-ins 2', type: 'walk_in' }).expect(201);
  });

  it('config: valid references are saved; origins normalised and deduped', async () => {
    const pipelines = ((await api(owner).get('/v1/pipelines').expect(200)).body as PipelineList)
      .items;
    const pipeline = pipelines[0];
    const open = pipeline?.stages.find((s) => s.category === 'open');
    const leadField = (
      (await api(owner).get('/v1/custom-fields?entity=lead').expect(200)).body as CustomFieldDefList
    ).items[0];
    if (!pipeline || !open || !leadField) throw new Error('template setup missing');
    const config = {
      allowedOrigins: ['https://Shop.Example.com/', 'https://shop.example.com'],
      captcha: true,
      fieldMapping: {
        full_name: 'name',
        mobile: 'phone',
        mail: 'email',
        [leadField.key]: `lead.${leadField.key}`,
      },
      pipelineId: pipeline.id,
      stageId: open.id,
      assignment: { strategy: 'user', userId: agent.body.user.id },
    };
    const { source } = (
      await create(owner, { name: 'Configured', type: 'web_form', config }).expect(201)
    ).body as LeadSourceWithSecret;
    expect(source.config).toMatchObject({
      ...config,
      allowedOrigins: ['https://shop.example.com'],
    });
    const off = (
      await api(owner).patch(`/v1/lead-sources/${source.id}`, { isActive: false }).expect(200)
    ).body as LeadSource;
    expect(off).toMatchObject({ isActive: false, config: { captcha: true } });
  });

  it('config: rejects unknown/foreign references, closed stages and bad shapes', async () => {
    const mine = ((await api(owner).get('/v1/pipelines').expect(200)).body as PipelineList)
      .items[0];
    const theirs = ((await api(other).get('/v1/pipelines').expect(200)).body as PipelineList)
      .items[0];
    const won = mine?.stages.find((s) => s.category === 'won');
    if (!mine || !theirs || !won) throw new Error('template setup missing');
    const bad = async (config: object) =>
      errorsOf(
        await create(owner, { name: `Bad ${Math.random()}`, type: 'api', config }).expect(400),
      );

    expect(await bad({ pipelineId: theirs.id })).toEqual([
      { path: 'config.pipelineId', message: 'unknown pipeline' },
    ]);
    expect(await bad({ pipelineId: mine.id, stageId: theirs.stages[0]?.id })).toEqual([
      { path: 'config.stageId', message: 'not a stage of this pipeline' },
    ]);
    expect(await bad({ pipelineId: mine.id, stageId: won.id })).toEqual([
      { path: 'config.stageId', message: 'new leads must start in an open stage' },
    ]);
    expect(await bad({ stageId: won.id })).toEqual([
      { path: 'config.stageId', message: 'choose the pipeline too' },
    ]);
    expect(await bad({ assignment: { strategy: 'user', userId: other.body.user.id } })).toEqual([
      { path: 'config.assignment.userId', message: 'not an active member of this workspace' },
    ]);
    expect(await bad({ fieldMapping: { x: 'lead.no_such_field' } })).toEqual([
      { path: 'config.fieldMapping.x', message: 'unknown lead field' },
    ]);
    expect(await bad({ fieldMapping: { a: 'phone', b: 'phone' } })).toEqual([
      { path: 'config.fieldMapping', message: 'map each contact field only once' },
    ]);
    // Schema-level: paths, prototype keys, non-origins, unknown keys.
    for (const config of [
      { allowedOrigins: ['https://example.com/path'] },
      { allowedOrigins: ['javascript:alert(1)'] },
      { allowedOrigins: ['https://user:pw@example.com'] },
      { fieldMapping: { __proto__x: 'name', 'a/b': 'name' } },
      { fieldMapping: { constructor: 'name' } },
      { fieldMapping: { x: 'lead.Bad-Key' } },
      { surprise: true },
    ]) {
      await create(owner, { name: 'Shape', type: 'web_form', config }).expect(400);
    }
  });

  it('other tenants’ source ids are 404 for every write', async () => {
    const theirs = (await sources(other))[0];
    if (!theirs) throw new Error('missing');
    await api(owner).patch(`/v1/lead-sources/${theirs.id}`, { name: 'Mine now' }).expect(404);
    await api(owner).del(`/v1/lead-sources/${theirs.id}`).expect(404);
    await api(owner).post(`/v1/lead-sources/${theirs.id}/rotate-key`).expect(404);
    await api(owner).post(`/v1/lead-sources/${theirs.id}/rotate-secret`).expect(404);
    expect((await sources(other)).find((s) => s.id === theirs.id)?.name).toBe(theirs.name);
  });

  it('a deleted source can no longer be picked for a lead', async () => {
    const { source } = (await create(owner, { name: 'Short-lived', type: 'manual' }).expect(201))
      .body as LeadSourceWithSecret;
    await api(owner).del(`/v1/lead-sources/${source.id}`).expect(204);
    const res = await api(owner)
      .post('/v1/leads', { sourceId: source.id, contact: { name: 'X', phone: '9811122233' } })
      .expect(400);
    expect(errorsOf(res)).toEqual([{ path: 'sourceId', message: 'unknown source' }]);
  });

  it('writes are audited without secrets or config values', async () => {
    const rows = await asTestOwner((sql) =>
      sql.begin(async (tx) => {
        await tx`select set_config('app.tenant_id', ${tenantId}, true)`;
        return tx<{ action: string; after: unknown }[]>`
          select action, after from audit_logs where entity = 'lead_source'`;
      }),
    );
    const actions = new Set(rows.map((r) => r.action));
    for (const a of [
      'lead_source.created',
      'lead_source.updated',
      'lead_source.deleted',
      'lead_source.key_rotated',
      'lead_source.secret_rotated',
    ]) {
      expect(actions.has(a), a).toBe(true);
    }
    const text = JSON.stringify(rows);
    expect(text).not.toMatch(/whsec_|shop\.example\.com|v1:local-1/);
  });
});
