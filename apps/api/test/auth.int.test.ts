import { auditLogs, createDb, eq, memberships, outboxEvents, withTenant } from '@revops/db';
import { loadTestDatabaseEnv } from '@revops/db/testing';
import { CSRF_HEADER, type SessionResponse, USER_SIGNED_UP_V1 } from '@revops/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  LOGIN_MAX_FAILURES,
  LOGIN_WINDOW_MS,
  SIGNUPS_PER_IP_PER_HOUR,
} from '../src/modules/identity/identity.service';
import { SESSION_IDLE_TIMEOUT_MS } from '../src/modules/identity/session.service';
import {
  PASSWORD,
  SESSION_COOKIE,
  type TestApp,
  createTestApp,
  login,
  sessionCookie,
  signup,
  signupVerified,
  uniqueEmail,
  withSession,
} from './test-app';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
let t: TestApp;
/** A fresh app per describe: its own in-memory rate limiter and fake clock, so blocks don't interfere. */
function freshApp(): void {
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
}

describe('M0-T4 AC: signup → verify email → login → me → logout revokes the session', () => {
  freshApp();
  const email = uniqueEmail('flow');
  let signedUp: Awaited<ReturnType<typeof signup>>;

  it('signup creates user + tenant + owner membership, sets no session, emails a link', async () => {
    const res = await request(t.server)
      .post('/v1/auth/signup')
      .send({
        name: 'Asha',
        email: email.toUpperCase(),
        password: PASSWORD,
        tenantName: 'Asha Realty',
      })
      .expect(201);
    signedUp = res.body as typeof signedUp;
    expect(res.body).toMatchObject({
      user: { email, name: 'Asha', emailVerified: false },
      tenant: { name: 'Asha Realty', role: 'owner' },
    });
    expect((res.body as { tenant: { slug: string } }).tenant.slug).toMatch(
      /^asha-realty-[0-9a-f]{6}$/,
    );
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(t.email.lastTo(email)?.text).toContain('http://localhost:3000/verify-email?token=');
  });

  it('login before verification → 403 email_not_verified (only with the right password)', async () => {
    const res = await request(t.server).post('/v1/auth/login').send({ email, password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'email_not_verified' });
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
  });

  it('verify-email consumes the link once', async () => {
    const token = t.email.lastTokenTo(email);
    await request(t.server).post('/v1/auth/verify-email').send({ token }).expect(204);
    const again = await request(t.server).post('/v1/auth/verify-email').send({ token }).expect(400);
    expect(again.body).toMatchObject({ code: 'invalid_token' });
  });

  let session: Awaited<ReturnType<typeof login>>;

  it('login sets an httpOnly, Secure, SameSite=Lax session cookie and returns the session', async () => {
    const res = await request(t.server)
      .post('/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? [])[0] ?? '';
    expect(cookie).toMatch(/^__Host-sid=[A-Za-z0-9_-]{43};/);
    expect(cookie).toMatch(/; HttpOnly/);
    expect(cookie).toMatch(/; Secure/);
    expect(cookie).toMatch(/; SameSite=Lax/);
    expect(cookie).toMatch(/; Path=\//);
    expect(cookie).toMatch(/; Max-Age=2592000/); // 30 days
    const body = res.body as SessionResponse;
    expect(body).toMatchObject({
      user: { id: signedUp.user.id, email, emailVerified: true },
      tenant: { id: signedUp.tenant.id, role: 'owner' },
    });
    expect(body.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    session = { cookie: sessionCookie(res), csrf: body.csrfToken, body };
  });

  it('GET /me works with the cookie (the "dashboard" call) and needs no CSRF token', async () => {
    const res = await withSession(request(t.server).get('/v1/auth/me'), session, false).expect(200);
    expect(res.body).toEqual(session.body);
  });

  it('logout without / with a wrong CSRF token → 403 csrf_invalid, session still valid', async () => {
    const missing = await withSession(request(t.server).post('/v1/auth/logout'), session, false);
    expect(missing.status).toBe(403);
    expect(missing.body).toMatchObject({ code: 'csrf_invalid' });
    const wrong = await request(t.server)
      .post('/v1/auth/logout')
      .set('Cookie', session.cookie)
      .set(CSRF_HEADER, 'x'.repeat(43));
    expect(wrong.status).toBe(403);
    await withSession(request(t.server).get('/v1/auth/me'), session).expect(200);
  });

  it('logout revokes the session server-side and clears the cookie', async () => {
    const res = await withSession(request(t.server).post('/v1/auth/logout'), session).expect(204);
    expect(([] as string[]).concat(res.headers['set-cookie'] ?? [])[0]).toMatch(/^__Host-sid=;/);
    // Replaying the old cookie must fail: revocation is in the DB, not just the browser.
    const after = await withSession(request(t.server).get('/v1/auth/me'), session).expect(401);
    expect(after.body).toMatchObject({ code: 'unauthenticated' });
  });

  it('signup wrote the audit log and the user.signed_up.v1 outbox event (same transaction)', async () => {
    const db = createDb(loadTestDatabaseEnv().appUrl, { max: 1 });
    try {
      const [audits, events] = await withTenant(db.db, signedUp.tenant.id, async (tx) => [
        await tx.select().from(auditLogs),
        await tx.select().from(outboxEvents),
      ]);
      expect(audits.map((a) => a.action)).toEqual(
        expect.arrayContaining(['user.signed_up', 'auth.login', 'auth.logout']),
      );
      expect(events).toEqual([
        expect.objectContaining({
          type: USER_SIGNED_UP_V1,
          aggregateId: signedUp.user.id,
          payload: { userId: signedUp.user.id, tenantId: signedUp.tenant.id },
          publishedAt: null,
        }),
      ]);
    } finally {
      await db.close();
    }
  });
});

describe('signup validation', () => {
  freshApp();
  it('rejects a second account for the same email (case-insensitive) → 409 email_taken', async () => {
    const email = uniqueEmail('dup');
    await signup(t, email);
    const res = await request(t.server)
      .post('/v1/auth/signup')
      .send({ name: 'B', email: email.toUpperCase(), password: PASSWORD, tenantName: 'B' })
      .expect(409);
    expect(res.body).toMatchObject({ code: 'email_taken' });
  });

  it('rejects a short password without echoing it', async () => {
    const res = await request(t.server)
      .post('/v1/auth/signup')
      .send({ name: 'C', email: uniqueEmail(), password: 'short-pw', tenantName: 'C' })
      .expect(400);
    expect(res.body).toMatchObject({ code: 'validation_failed' });
    expect(JSON.stringify(res.body)).not.toContain('short-pw');
  });

  it('a form-encoded (cross-site form) POST is not parsed as JSON → 400', async () => {
    await request(t.server)
      .post('/v1/auth/login')
      .type('form')
      .send({ email: 'a@b.co', password: 'x' })
      .expect(400);
  });
});

describe(`M0-T4 AC: wrong password ×${LOGIN_MAX_FAILURES} → 429`, () => {
  freshApp();
  const email = uniqueEmail('limit');
  beforeAll(() => signupVerified(t, email));

  it('locks the (IP, email) pair after 5 failures, even for the right password', async () => {
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) {
      const res = await request(t.server)
        .post('/v1/auth/login')
        .send({ email, password: 'wrong password!!' });
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ code: 'invalid_credentials' });
    }
    for (const password of ['wrong password!!', PASSWORD]) {
      const res = await request(t.server).post('/v1/auth/login').send({ email, password });
      expect(res.status).toBe(429);
      expect(res.body).toMatchObject({ code: 'rate_limited' });
      const retryAfter = Number(res.headers['retry-after']);
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(LOGIN_WINDOW_MS / 1000);
    }
  });

  it('unlocks when the window has passed', async () => {
    t.clock.advance(LOGIN_WINDOW_MS + 1000);
    await login(t, email);
  });

  it('unknown email and wrong password give the identical response', async () => {
    const unknown = await request(t.server)
      .post('/v1/auth/login')
      .send({ email: uniqueEmail('nobody'), password: PASSWORD });
    const wrong = await request(t.server)
      .post('/v1/auth/login')
      .send({ email, password: 'wrong password!!' });
    expect([unknown.status, wrong.status]).toEqual([401, 401]);
    expect(unknown.body).toEqual(wrong.body);
  });
});

describe('password reset', () => {
  freshApp();
  const email = uniqueEmail('reset');
  const NEW_PASSWORD = 'a brand new passphrase';
  let oldSession: Awaited<ReturnType<typeof login>>;

  beforeAll(async () => {
    await signupVerified(t, email);
    oldSession = await login(t, email);
  });

  it('forgot-password is 202 for unknown and known emails; only a real account gets mail', async () => {
    const unknown = uniqueEmail('ghost');
    await request(t.server).post('/v1/auth/forgot-password').send({ email: unknown }).expect(202);
    expect(t.email.lastTo(unknown)).toBeUndefined();
    await request(t.server).post('/v1/auth/forgot-password').send({ email }).expect(202);
    expect(t.email.lastTo(email)?.text).toContain('/reset-password?token=');
  });

  it('reset sets the new password, revokes every session, and the link works once', async () => {
    const token = t.email.lastTokenTo(email);
    await request(t.server)
      .post('/v1/auth/reset-password')
      .send({ token, password: 'too-short' })
      .expect(400);
    await request(t.server)
      .post('/v1/auth/reset-password')
      .send({ token, password: NEW_PASSWORD })
      .expect(204);

    await withSession(request(t.server).get('/v1/auth/me'), oldSession).expect(401);
    await request(t.server).post('/v1/auth/login').send({ email, password: PASSWORD }).expect(401);
    await login(t, email, NEW_PASSWORD);
    const reuse = await request(t.server)
      .post('/v1/auth/reset-password')
      .send({ token, password: 'yet another passphrase' })
      .expect(400);
    expect(reuse.body).toMatchObject({ code: 'invalid_token' });
  });
});

describe('resend verification', () => {
  freshApp();
  it('re-sends only to unverified accounts, 202 either way, max 3 per hour', async () => {
    const email = uniqueEmail('resend');
    await signup(t, email);
    const before = t.email.sent.length;
    for (let i = 0; i < 4; i++) {
      await request(t.server).post('/v1/auth/resend-verification').send({ email }).expect(202);
    }
    expect(t.email.sent.length - before).toBe(3);
    // The newest link verifies.
    await request(t.server)
      .post('/v1/auth/verify-email')
      .send({ token: t.email.lastTokenTo(email) })
      .expect(204);

    const verified = uniqueEmail('verified');
    await signupVerified(t, verified);
    const count = t.email.sent.length;
    await request(t.server)
      .post('/v1/auth/resend-verification')
      .send({ email: verified })
      .expect(202);
    expect(t.email.sent.length).toBe(count);
  });
});

describe('session lifetime', () => {
  freshApp();
  const email = uniqueEmail('idle');
  beforeAll(() => signupVerified(t, email));

  it('activity keeps a session alive (rolling idle window)', async () => {
    const session = await login(t, email);
    t.clock.advance(6 * DAY);
    await withSession(request(t.server).get('/v1/auth/me'), session).expect(200);
    t.clock.advance(6 * DAY); // 12 days since login, 6 since last use
    await withSession(request(t.server).get('/v1/auth/me'), session).expect(200);
  });

  it(`a session idle for more than ${SESSION_IDLE_TIMEOUT_MS / DAY} days is rejected`, async () => {
    const session = await login(t, email);
    t.clock.advance(SESSION_IDLE_TIMEOUT_MS + 60_000);
    await withSession(request(t.server).get('/v1/auth/me'), session).expect(401);
  });

  it('a tampered or unknown cookie is rejected', async () => {
    const session = await login(t, email);
    const flipped = session.cookie.endsWith('A') ? 'B' : 'A';
    const tampered = { ...session, cookie: `${session.cookie.slice(0, -1)}${flipped}` };
    await withSession(request(t.server).get('/v1/auth/me'), tampered).expect(401);
    await request(t.server)
      .get('/v1/auth/me')
      .set('Cookie', `${SESSION_COOKIE}=garbage`)
      .expect(401);
  });
});

describe('rate limits are atomic and per IP (security review #1, #4)', () => {
  freshApp();

  it('a concurrent burst of wrong passwords gets at most 5 real attempts', async () => {
    const email = uniqueEmail('burst');
    await signupVerified(t, email);
    const statuses = await Promise.all(
      Array.from({ length: 20 }, () =>
        request(t.server).post('/v1/auth/login').send({ email, password: 'wrong password!!' }),
      ),
    ).then((responses) => responses.map((r) => r.status));
    expect(statuses.filter((s) => s === 401)).toHaveLength(LOGIN_MAX_FAILURES);
    expect(statuses.filter((s) => s === 429)).toHaveLength(20 - LOGIN_MAX_FAILURES);
  });

  it(`signup is limited to ${SIGNUPS_PER_IP_PER_HOUR} per IP per hour`, async () => {
    t.clock.advance(HOUR); // clear the previous test's signup
    for (let i = 0; i < SIGNUPS_PER_IP_PER_HOUR; i++) await signup(t, uniqueEmail('many'));
    const res = await request(t.server)
      .post('/v1/auth/signup')
      .send({ name: 'X', email: uniqueEmail('many'), password: PASSWORD, tenantName: 'X' })
      .expect(429);
    expect(res.body).toMatchObject({ code: 'rate_limited' });
  });
});

describe('membership is re-checked on every request (security review #2)', () => {
  freshApp();

  it('a member removed from the tenant loses tenant access at once, without a new login', async () => {
    const email = uniqueEmail('removed');
    const { user, tenant } = await signupVerified(t, email);
    const session = await login(t, email);
    expect(session.body.tenant?.id).toBe(tenant.id);

    const db = createDb(loadTestDatabaseEnv().appUrl, { max: 1 });
    try {
      await withTenant(db.db, tenant.id, (tx) =>
        tx.update(memberships).set({ status: 'disabled' }).where(eq(memberships.userId, user.id)),
      );
    } finally {
      await db.close();
    }

    const me = await withSession(request(t.server).get('/v1/auth/me'), session).expect(200);
    expect((me.body as SessionResponse).tenant).toBeNull();
  });
});
