import type {
  CustomFieldDefList,
  Lead,
  LeadPage,
  LeadSource,
  LeadSourceWithSecret,
} from '@revops/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PUBLIC_FORM_LIMITS } from '../src/modules/capture';
import { RateLimiter } from '../src/platform/rate-limit/rate-limiter';
import { FakeCaptchaVerifier } from '../src/providers/captcha';
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

// M2-T2: public form endpoint + embed snippet. Hostile input: keys, origins, payloads, spam.
const ORIGIN = 'https://shop.example.com';
let t: TestApp;
let owner: LoggedIn;
let tenantId: string;
let form: LeadSource;
let agentId: string;

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
const phone = () => `94${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
const newSource = async (name: string, config: object = {}, type = 'web_form') =>
  (
    (
      await api(owner)
        .post('/v1/lead-sources', {
          name: `${name} ${Math.random()}`,
          type,
          config: { allowedOrigins: [ORIGIN], ...config },
        })
        .expect(201)
    ).body as LeadSourceWithSecret
  ).source;

/** A browser-like post: text/plain JSON with an Origin. */
const post = (key: string, body: object | string, origin: string | null = ORIGIN) => {
  let req = request(t.server).post(`/v1/public/forms/${key}`).set('Content-Type', 'text/plain');
  if (origin) req = req.set('Origin', origin);
  return req.send(typeof body === 'string' ? body : JSON.stringify(body));
};
const submission = (fields: Record<string, unknown>, extra: object = {}) => ({
  fields,
  submissionId: crypto.randomUUID(),
  _hp: '',
  _ts: 5000,
  ...extra,
});
const leadByPhone = async (digits: string): Promise<Lead | undefined> =>
  ((await api(owner).get(`/v1/leads?q=${digits}`).expect(200)).body as LeadPage).items[0];
const leadCount = async () => {
  const [row] = await asTestOwner((sql) =>
    sql.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', ${tenantId}, true)`;
      return tx<{ n: number }[]>`select count(*)::int as n from leads`;
    }),
  );
  return row?.n ?? 0;
};

beforeAll(async () => {
  t = await createTestApp();
  owner = await signupOwner('Form Shop');
  tenantId = owner.body.tenant?.id ?? '';
  agentId = (await addMember(t, tenantId, 'agent')).userId;
  form = await newSource('Website');
});
afterAll(() => t.close());

describe('embed snippet', () => {
  it('is served as cacheable JavaScript that posts to the forms endpoint', async () => {
    const res = await request(t.server).get('/v1/public/embed.js').expect(200);
    expect(res.headers['content-type']).toMatch(/^application\/javascript/);
    expect(res.headers['cache-control']).toBe('public, max-age=3600');
    expect(res.text).toContain("new URL('forms/' + encodeURIComponent(key), script.src)");
    expect(res.text).toContain("'_hp'");
    expect(res.text).not.toContain('${');
  });
});

describe('POST /v1/public/forms/:publicKey', () => {
  it('AC: accepts a browser post, maps fields, stores attribution, assigns round-robin', async () => {
    const p = phone();
    const res = await post(
      form.publicKey,
      submission(
        { full_name: 'Neha Shah', mobile: p, email: 'Neha@Example.com', message: 'ignored' },
        {
          attribution: {
            utm_source: 'google',
            utm_campaign: 'diwali',
            gclid: 'abc123',
            landing_url: `${ORIGIN}/repair?utm_source=google`,
            referrer: 'https://www.google.com/',
            evil_key: 'dropped',
          },
        },
      ),
    ).expect(201);
    expect(res.body).toEqual({ ok: true });
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
    const lead = await leadByPhone(p);
    expect(lead).toMatchObject({
      contact: { name: 'Neha Shah', phoneE164: `+91${p}`, email: 'neha@example.com' },
      source: { id: form.id },
      owner: { id: agentId },
      attribution: {
        utm_source: 'google',
        utm_campaign: 'diwali',
        gclid: 'abc123',
        landing_url: `${ORIGIN}/repair?utm_source=google`,
        referrer: 'https://www.google.com/',
      },
    });
    expect(lead?.attribution).not.toHaveProperty('evil_key');
  });

  it('also takes application/json; unknown/bad attribution values are dropped, not fatal', async () => {
    const p = phone();
    await request(t.server)
      .post(`/v1/public/forms/${form.publicKey}`)
      .set('Origin', ORIGIN)
      .send(
        submission(
          { phone: p },
          { attribution: { landing_url: 'javascript:alert(1)', referrer: 42, utm_medium: 'cpc' } },
        ),
      )
      .expect(201);
    expect((await leadByPhone(p))?.attribution).toEqual({ utm_medium: 'cpc' });
  });

  it('custom field mapping, incl. lead custom fields; invalid values dropped', async () => {
    const defs = (
      (await api(owner).get('/v1/custom-fields?entity=lead').expect(200)).body as CustomFieldDefList
    ).items;
    const text = defs.find((d) => d.type === 'text' && d.pipelineIds === null);
    if (!text) throw new Error('need a text lead field');
    const mapped = await newSource('Mapped', {
      fieldMapping: { your_name: 'name', whatsapp: 'phone', device: `lead.${text.key}` },
    });
    const p = phone();
    await post(
      mapped.publicKey,
      submission({ your_name: 'Arjun', whatsapp: p, device: 'Pixel 7' }),
    ).expect(201);
    const lead = await leadByPhone(p);
    expect(lead).toMatchObject({
      contact: { name: 'Arjun' },
      customFields: { [text.key]: 'Pixel 7' },
    });
  });

  it('same submissionId twice (double click) → one lead, same answer', async () => {
    const p = phone();
    const body = submission({ phone: p });
    const before = await leadCount();
    const a = await post(form.publicKey, body).expect(201);
    const b = await post(form.publicKey, body).expect(201);
    expect(a.body).toEqual(b.body);
    expect(await leadCount()).toBe(before + 1);
  });

  it('a known person gets the same answer as a new one (no existence oracle)', async () => {
    const p = phone();
    const first = await post(form.publicKey, submission({ phone: p })).expect(201);
    const again = await post(form.publicKey, submission({ phone: p })).expect(201);
    expect(again.body).toEqual(first.body);
  });

  it('spam: honeypot filled or too fast → 201 ok, nothing stored', async () => {
    const before = await leadCount();
    for (const extra of [{ _hp: 'http://spam.example' }, { _ts: 300 }]) {
      const res = await post(form.publicKey, submission({ phone: phone() }, extra)).expect(201);
      expect(res.body).toEqual({ ok: true });
    }
    expect(await leadCount()).toBe(before);
  });

  it('unknown, malformed, paused, deleted and non-form keys → the same 404', async () => {
    const paused = await newSource('Paused');
    await api(owner).patch(`/v1/lead-sources/${paused.id}`, { isActive: false }).expect(200);
    const deleted = await newSource('Deleted');
    await withSession(request(t.server).delete(`/v1/lead-sources/${deleted.id}`), owner).expect(
      204,
    );
    const apiSource = await newSource('Api', {}, 'api');
    for (const key of [
      'A'.repeat(43),
      'short',
      "x'; drop table leads;--",
      paused.publicKey,
      deleted.publicKey,
      apiSource.publicKey,
    ]) {
      const res = await post(encodeURIComponent(key), submission({ phone: phone() }));
      expect(res.status, key).toBe(404);
      expect(res.body).toMatchObject({ code: 'not_found' });
    }
  });

  it('origin must be on the allow-list (no Origin, other site, empty list) → 403 without CORS', async () => {
    const empty = await newSource('No origins', { allowedOrigins: [] });
    for (const [key, origin] of [
      [form.publicKey, null],
      [form.publicKey, 'https://evil.example'],
      [form.publicKey, 'https://shop.example.com.evil.example'],
      [empty.publicKey, ORIGIN],
    ] as const) {
      const res = await post(key, submission({ phone: phone() }), origin);
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: 'origin_not_allowed' });
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    }
  });

  it('needs a valid phone or email → 422 (readable by the allowed origin)', async () => {
    const res = await post(form.publicKey, submission({ name: 'Only name', phone: '123' })).expect(
      422,
    );
    expect(res.body).toMatchObject({ code: 'intake_unusable' });
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
  });

  it('payload limits and shape: >16 kB → 413, bad JSON → 400, urlencoded/other shapes → 400', async () => {
    await post(form.publicKey, submission({ phone: phone(), note: 'x'.repeat(17_000) })).expect(
      413,
    );
    await post(form.publicKey, '{"fields": ').expect(400);
    await request(t.server)
      .post(`/v1/public/forms/${form.publicKey}`)
      .set('Origin', ORIGIN)
      .type('form')
      .send('phone=9812345678')
      .expect(400);
    const tooMany = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`f${i}`, 'x']));
    await post(form.publicKey, submission(tooMany)).expect(400);
    await post(form.publicKey, { fields: 'nope' }).expect(400);
    await post(
      form.publicKey,
      submission({ phone: phone() }, { submissionId: 'not-a-uuid' }),
    ).expect(400);
  });

  it('captcha: required by the source → missing/invalid 400, valid token accepted', async () => {
    const guarded = await newSource('Captcha', { captcha: true });
    const p = phone();
    const missing = await post(guarded.publicKey, submission({ phone: p })).expect(400);
    expect(missing.body).toMatchObject({ code: 'captcha_failed' });
    await post(guarded.publicKey, submission({ phone: p }, { _captcha: 'wrong' })).expect(400);
    await post(
      guarded.publicKey,
      submission({ phone: p }, { _captcha: FakeCaptchaVerifier.VALID_TOKEN }),
    ).expect(201);
    expect(await leadByPhone(p)).toBeDefined();
  });

  it('preflight: CORS headers only for allowed origins', async () => {
    const ok = await request(t.server)
      .options(`/v1/public/forms/${form.publicKey}`)
      .set('Origin', ORIGIN)
      .set('Access-Control-Request-Method', 'POST')
      .expect(204);
    expect(ok.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(ok.headers['access-control-allow-methods']).toBe('POST');
    const no = await request(t.server)
      .options(`/v1/public/forms/${form.publicKey}`)
      .set('Origin', 'https://evil.example')
      .expect(204);
    expect(no.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rate limits: per source → 429 with Retry-After (nothing stored)', async () => {
    const limited = await newSource('Limited');
    const { limit, windowMs } = PUBLIC_FORM_LIMITS.source;
    const limiter = t.app.get(RateLimiter);
    for (let i = 0; i < limit; i += 1) {
      await limiter.consume(`public-form-source:${limited.id}`, limit, windowMs);
    }
    const res = await post(limited.publicKey, submission({ phone: phone() })).expect(429);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('rate limits: per IP before any lookup (even unknown keys)', async () => {
    const { limit, windowMs } = PUBLIC_FORM_LIMITS.ip;
    const limiter = t.app.get(RateLimiter);
    // supertest connects from loopback.
    for (const ip of ['::ffff:127.0.0.1', '127.0.0.1', '::1']) {
      for (let i = 0; i < limit; i += 1)
        await limiter.consume(`public-form-ip:${ip}`, limit, windowMs);
    }
    await post('A'.repeat(43), submission({ phone: phone() })).expect(429);
    await post(form.publicKey, submission({ phone: phone() })).expect(429);
  });
});
