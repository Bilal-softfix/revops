import type {
  Lead,
  LeadPage,
  LeadSource,
  LeadSourceWithSecret,
  RejectedDeliveryList,
} from '@revops/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  REJECTED_WEBHOOKS,
  WEBHOOK_LIMITS,
  WebhookProcessJob,
  WebhookPurgeJob,
  signWebhook,
} from '../src/modules/capture';
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

// M2-T3: signed generic webhook — signature, raw persistence, async processing, idempotency.
let t: TestApp;
let owner: LoggedIn;
let tenantId: string;
let source: LeadSource;
let secret: string;

async function signupOwner(tenantName: string): Promise<LoggedIn> {
  const email = uniqueEmail('owner');
  await request(t.server)
    .post('/v1/auth/signup')
    .send({ name: 'Owner', email, password: PASSWORD, tenantName, industry: 'generic' })
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
const phone = () => `93${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
const nowSec = () => Math.floor(t.clock.now().getTime() / 1000);

/** Sends `body` exactly as given (string) or JSON-encoded, signed unless `signature` is set. */
function deliver(
  body: object | string,
  opts: { key?: string; secret?: string; ts?: number; signature?: string | null } = {},
) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const header =
    opts.signature === undefined
      ? signWebhook(opts.secret ?? secret, opts.ts ?? nowSec(), raw)
      : opts.signature;
  let req = request(t.server)
    .post(`/v1/public/webhooks/${opts.key ?? source.publicKey}`)
    .set('Content-Type', 'application/json');
  if (header !== null) req = req.set('X-RevOps-Signature', header);
  return req.send(raw);
}
type Row = {
  id: string;
  external_event_id: string | null;
  signature_valid: boolean;
  status: string;
  error: string | null;
  lead_id: string | null;
  payload: Record<string, unknown>;
};
const rows = () =>
  asTestOwner((sql) =>
    sql.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', ${tenantId}, true)`;
      return tx<Row[]>`select * from inbound_webhooks order by received_at, id`;
    }),
  );
/** Simple-token mode delivery: X-Webhook-Token instead of a signature. */
function deliverWithToken(key: string, body: object | string, token: string | null) {
  let req = request(t.server)
    .post(`/v1/public/webhooks/${key}`)
    .set('Content-Type', 'application/json');
  if (token !== null) req = req.set('X-Webhook-Token', token);
  return req.send(typeof body === 'string' ? body : JSON.stringify(body));
}
async function createApiSource(name: string, config: object = {}) {
  return (
    await api(owner)
      .post('/v1/lead-sources', {
        name,
        type: 'api',
        config: { assignment: { strategy: 'unassigned' }, ...config },
      })
      .expect(201)
  ).body as LeadSourceWithSecret;
}
const rowsFor = async (eventId: string | null, predicate?: (r: Row) => boolean) =>
  (await rows()).filter((r) => r.external_event_id === eventId && (predicate?.(r) ?? true));
const leadByPhone = async (digits: string): Promise<Lead | undefined> =>
  ((await api(owner).get(`/v1/leads?q=${digits}`).expect(200)).body as LeadPage).items[0];

beforeAll(async () => {
  t = await createTestApp();
  owner = await signupOwner('Hook Co');
  tenantId = owner.body.tenant?.id ?? '';
  const created = (
    await api(owner)
      .post('/v1/lead-sources', {
        name: 'Zapier',
        type: 'api',
        config: { assignment: { strategy: 'unassigned' }, fieldMapping: { budget: 'city' } },
      })
      .expect(201)
  ).body as LeadSourceWithSecret;
  source = created.source;
  secret = created.webhookSecret ?? '';
});
afterAll(() => t.close());

describe('POST /v1/public/webhooks/:publicKey', () => {
  it('AC: the same event twice → one lead (202 then 200 duplicate), processed asynchronously', async () => {
    const p = phone();
    const event = {
      id: `evt_${p}`,
      name: 'Kabir Mehta',
      phone: p,
      email: 'kabir@example.com',
      fields: { budget: 'Pune' },
      attribution: { utm_source: 'zapier', landing_url: 'javascript:alert(1)' },
    };
    const first = await deliver(event).expect(202);
    expect(first.body).toEqual({ ok: true, duplicate: false });
    expect(await leadByPhone(p)).toBeUndefined(); // not processed on the request path
    // A replay, even re-signed later with a fresh timestamp, is the same event.
    t.clock.advance(60_000);
    const replay = await deliver(event).expect(200);
    expect(replay.body).toEqual({ ok: true, duplicate: true });
    await t.drain();
    await t.drain();

    const lead = await leadByPhone(p);
    expect(lead).toMatchObject({
      contact: { name: 'Kabir Mehta', email: 'kabir@example.com' },
      source: { id: source.id, name: 'Zapier' },
      attribution: { utm_source: 'zapier' },
    });
    const stored = await rowsFor(event.id);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      signature_valid: true,
      status: 'processed',
      lead_id: lead?.id,
    });
    expect(stored[0]?.payload).toMatchObject({ id: event.id, phone: p });
  });

  it('AC: bad signature → 401 and stored as invalid (rejected); wrong secret, stale, missing too', async () => {
    const before = (await rows()).length;
    const cases: [string, Parameters<typeof deliver>[1]][] = [
      ['signature_mismatch', { secret: 'whsec_wrong' }],
      ['signature_stale', { ts: nowSec() - 3600 }],
      ['signature_missing', { signature: null }],
      ['signature_malformed', { signature: 'v1=abc' }],
    ];
    for (const [code, opts] of cases) {
      const res = await deliver({ id: `bad_${code}`, phone: phone() }, opts).expect(401);
      expect(res.body).toMatchObject({ code: 'invalid_signature' });
    }
    const rejected = (await rows()).slice(before);
    expect(rejected.map((r) => r.error).sort()).toEqual(cases.map(([code]) => code).sort());
    for (const r of rejected) {
      expect(r).toMatchObject({
        signature_valid: false,
        status: 'rejected',
        external_event_id: null,
      });
    }
    await t.drain();
    expect(rejected.every((r) => r.lead_id === null)).toBe(true);
  });

  it('a body changed after signing is rejected', async () => {
    const raw = JSON.stringify({ id: 'evt_tamper', phone: phone() });
    const header = signWebhook(secret, nowSec(), raw);
    await deliver(raw.replace('evt_tamper', 'evt_tampered'), { signature: header }).expect(401);
  });

  it('rotating the secret: the old one stops working at once', async () => {
    const { source: rotatedSource, webhookSecret } = (
      await api(owner).post('/v1/lead-sources', { name: 'Rotating', type: 'api' }).expect(201)
    ).body as LeadSourceWithSecret;
    const fresh = (
      await api(owner).post(`/v1/lead-sources/${rotatedSource.id}/rotate-secret`).expect(200)
    ).body as LeadSourceWithSecret;
    const body = { id: `evt_rot_${phone()}`, phone: phone() };
    await deliver(body, { key: rotatedSource.publicKey, secret: webhookSecret }).expect(401);
    await deliver(body, { key: rotatedSource.publicKey, secret: fresh.webhookSecret }).expect(202);
  });

  it('invalid payload (signed) → 400, stored as failed; non-JSON stored as raw', async () => {
    const res = await deliver({ phone: phone() }).expect(400); // no id
    expect(res.body).toMatchObject({ code: 'validation_failed' });
    await deliver('this is not json').expect(400);
    const failed = (await rows()).filter((r) => r.error === 'invalid_payload');
    expect(failed.length).toBeGreaterThanOrEqual(2);
    expect(failed.every((r) => r.status === 'failed' && r.signature_valid)).toBe(true);
    expect(failed.some((r) => r.payload.raw === 'this is not json')).toBe(true);
  });

  it('a payload without a usable phone/email is accepted, then fails in the job (no lead, no retry)', async () => {
    const id = `evt_unusable_${Date.now()}`;
    await deliver({ id, name: 'No contact', phone: '12' }).expect(202);
    await t.drain();
    const [row] = await rowsFor(id);
    expect(row).toMatchObject({ status: 'failed', error: 'intake_unusable', lead_id: null });
  });

  it('unknown, malformed, form-type and paused keys → 404, nothing stored', async () => {
    const before = (await rows()).length;
    const form = (
      (await api(owner).post('/v1/lead-sources', { name: 'Form', type: 'web_form' }).expect(201))
        .body as LeadSourceWithSecret
    ).source;
    const paused = (
      (await api(owner).post('/v1/lead-sources', { name: 'Paused hook', type: 'api' }).expect(201))
        .body as LeadSourceWithSecret
    ).source;
    await api(owner).patch(`/v1/lead-sources/${paused.id}`, { isActive: false }).expect(200);
    for (const key of ['A'.repeat(43), 'nope', form.publicKey, paused.publicKey]) {
      await deliver({ id: 'x', phone: phone() }, { key }).expect(404);
    }
    expect((await rows()).length).toBe(before);
  });

  it('bodies over 64 kB → 413', async () => {
    await deliver({ id: 'big', phone: phone(), fields: { note: 'x'.repeat(66_000) } }).expect(413);
  });

  it('per-source rate limit covers rejected deliveries too → 429', async () => {
    const { source: limited } = (
      await api(owner).post('/v1/lead-sources', { name: 'Limited hook', type: 'api' }).expect(201)
    ).body as LeadSourceWithSecret;
    const { limit, windowMs } = WEBHOOK_LIMITS.source;
    const limiter = t.app.get(RateLimiter);
    for (let i = 0; i < limit; i += 1) {
      await limiter.consume(`public-webhook-source:${limited.id}`, limit, windowMs);
    }
    const res = await deliver(
      { id: 'x', phone: phone() },
      {
        key: limited.publicKey,
        signature: null,
      },
    ).expect(429);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('re-running the job for a processed delivery does nothing', async () => {
    const p = phone();
    const id = `evt_rerun_${p}`;
    await deliver({ id, phone: p }).expect(202);
    await t.drain();
    const [row] = await rowsFor(id);
    await t.app
      .get(WebhookProcessJob)
      .handle({ tenantId, webhookId: row?.id ?? '' }, { attempt: 1 } as never);
    const [lead] = ((await api(owner).get(`/v1/leads?q=${p}`).expect(200)).body as LeadPage).items;
    expect(lead?.id).toBe(row?.lead_id);
    expect(
      ((await api(owner).get(`/v1/leads?q=${p}`).expect(200)).body as LeadPage).items,
    ).toHaveLength(1);
  });
});

describe('simple token mode (opt-in per source)', () => {
  it('the secret in X-Webhook-Token → lead; same id twice → one lead', async () => {
    const { source: zap, webhookSecret } = await createApiSource('Make token', {
      webhookAuth: 'token',
    });
    expect(zap.config.webhookAuth).toBe('token');
    const p = phone();
    const event = { id: `tok_${p}`, name: 'Token Lead', phone: p };
    expect(
      (await deliverWithToken(zap.publicKey, event, webhookSecret ?? '').expect(202)).body,
    ).toEqual({ ok: true, duplicate: false });
    expect(
      (await deliverWithToken(zap.publicKey, event, webhookSecret ?? '').expect(200)).body,
    ).toEqual({ ok: true, duplicate: true });
    await t.drain();
    expect(await leadByPhone(p)).toMatchObject({ source: { id: zap.id } });
    expect(await rowsFor(event.id)).toHaveLength(1);
  });

  it('wrong or missing token → 401 stored as rejected; a signature does not count in token mode', async () => {
    const { source: zap, webhookSecret } = await createApiSource('Zap token', {
      webhookAuth: 'token',
    });
    const body = { id: `tok_bad_${phone()}`, phone: phone() };
    const wrong = await deliverWithToken(zap.publicKey, body, 'whsec_wrong').expect(401);
    expect(wrong.body).toMatchObject({ code: 'invalid_token' });
    await deliverWithToken(zap.publicKey, body, null).expect(401);
    await deliver(body, { key: zap.publicKey, secret: webhookSecret }).expect(401);
    const list = (
      await api(owner).get(`/v1/lead-sources/${zap.id}/rejected-deliveries`).expect(200)
    ).body as RejectedDeliveryList;
    expect(list.items.map((i) => i.reason).sort()).toEqual([
      'token_mismatch',
      'token_missing',
      'token_missing',
    ]);
  });

  it('an HMAC source ignores X-Webhook-Token (HMAC stays the default)', async () => {
    const res = await deliverWithToken(source.publicKey, { id: 'x', phone: phone() }, secret);
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'invalid_signature' });
    expect(source.config.webhookAuth).toBe('hmac');
  });

  it('per-source rate limit applies in token mode too → 429', async () => {
    const { source: zap, webhookSecret } = await createApiSource('Token limited', {
      webhookAuth: 'token',
    });
    const { limit, windowMs } = WEBHOOK_LIMITS.source;
    const limiter = t.app.get(RateLimiter);
    for (let i = 0; i < limit; i += 1) {
      await limiter.consume(`public-webhook-source:${zap.id}`, limit, windowMs);
    }
    await deliverWithToken(zap.publicKey, { id: 'x', phone: phone() }, webhookSecret ?? '').expect(
      429,
    );
  });
});

describe('rejected deliveries', () => {
  it('store at most the first 16 KB, as text', async () => {
    const { source: hook } = await createApiSource('Big rejected');
    const raw = JSON.stringify({ id: 'big', note: 'é'.repeat(20_000) }); // ~40 kB
    await deliver(raw, { key: hook.publicKey, signature: null }).expect(401);
    const [item] = (
      (await api(owner).get(`/v1/lead-sources/${hook.id}/rejected-deliveries`).expect(200))
        .body as RejectedDeliveryList
    ).items;
    expect(item?.truncated).toBe(true);
    expect(Buffer.byteLength(item?.raw ?? '', 'utf8')).toBeLessThanOrEqual(
      REJECTED_WEBHOOKS.maxBytes + 3, // a split multi-byte char becomes U+FFFD
    );
    expect(item?.raw.startsWith('{"id":"big"')).toBe(true);
  });

  it('are capped per source per hour: still 401, but no longer stored; the cap resets', async () => {
    const { source: hook } = await createApiSource('Noisy');
    const cap = REJECTED_WEBHOOKS.perSourcePerHour;
    for (let i = 0; i < cap + 5; i += 1) {
      await deliver(
        { id: `n${i}`, phone: phone() },
        { key: hook.publicKey, signature: null },
      ).expect(401);
    }
    const listed = async () =>
      (
        (await api(owner).get(`/v1/lead-sources/${hook.id}/rejected-deliveries`).expect(200))
          .body as RejectedDeliveryList
      ).items.length;
    expect(await listed()).toBe(cap);
    t.clock.advance(61 * 60_000);
    await deliver({ id: 'later', phone: phone() }, { key: hook.publicKey, signature: null }).expect(
      401,
    );
    expect(await listed()).toBe(cap + 1);
  });

  it('are visible to owners/admins only', async () => {
    const admin = await addMember(t, tenantId, 'admin');
    const manager = await addMember(t, tenantId, 'manager');
    const agent = await addMember(t, tenantId, 'agent');
    const path = `/v1/lead-sources/${source.id}/rejected-deliveries`;
    const adminList = (
      await api(await login(t, admin.email))
        .get(path)
        .expect(200)
    ).body as RejectedDeliveryList;
    expect(adminList.items.length).toBeGreaterThan(0);
    await api(await login(t, manager.email))
      .get(path)
      .expect(403);
    await api(await login(t, agent.email))
      .get(path)
      .expect(403);
    // Another tenant's owner can't see them (RLS → 404).
    const other = await signupOwner('Other Hook Co');
    await api(other).get(path).expect(404);
  });
});

describe('retention', () => {
  it('rejected deliveries are purged after 7 days; valid ones are kept until 30', async () => {
    const { source: hook, webhookSecret } = await createApiSource('Retention');
    const p = phone();
    await deliver({ id: `bad_${p}`, phone: p }, { key: hook.publicKey, signature: null }).expect(
      401,
    );
    await deliver(
      { id: `valid_${p}`, phone: p },
      { key: hook.publicKey, secret: webhookSecret },
    ).expect(202);
    await t.drain();
    await asTestOwner((sql) =>
      sql.begin(async (tx) => {
        await tx`select set_config('app.tenant_id', ${tenantId}, true)`;
        await tx`update inbound_webhooks set received_at = now() - interval '8 days'
                 where source_id = ${hook.id}`;
      }),
    );
    await t.app.get(WebhookPurgeJob).handle();
    const left = (await rows()).filter((r) => r.external_event_id === `valid_${p}`);
    expect(left).toHaveLength(1);
    const rejected = (
      (await api(owner).get(`/v1/lead-sources/${hook.id}/rejected-deliveries`).expect(200))
        .body as RejectedDeliveryList
    ).items;
    expect(rejected).toHaveLength(0);
  });

  it('the purge job deletes deliveries older than 30 days and keeps recent ones', async () => {
    const id = `evt_old_${Date.now()}`;
    await deliver({ id, phone: phone() }).expect(202);
    await t.drain();
    await asTestOwner((sql) =>
      sql.begin(async (tx) => {
        await tx`select set_config('app.tenant_id', ${tenantId}, true)`;
        await tx`update inbound_webhooks set received_at = now() - interval '31 days'
                 where external_event_id = ${id}`;
      }),
    );
    const recentBefore = (await rows()).length;
    await t.app.get(WebhookPurgeJob).handle();
    const after = await rows();
    expect(after.some((r) => r.external_event_id === id)).toBe(false);
    expect(after.length).toBe(recentBefore - 1);
  });
});
