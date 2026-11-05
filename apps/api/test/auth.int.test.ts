import {
  auditLogs,
  createDb,
  eq,
  memberships,
  outboxEvents,
  tenants,
  withContext,
  withTenant,
} from '@revops/db';
import { loadTestDatabaseEnv } from '@revops/db/testing';
import { CSRF_HEADER, type SessionResponse, USER_SIGNED_UP_V1 } from '@revops/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { IdentityRepository } from '../src/modules/identity/identity.repository';
import {
  LOGIN_MAX_FAILURES,
  LOGIN_WINDOW_MS,
  SIGNUPS_PER_IP_PER_HOUR,
  VERIFY_MAX_ATTEMPTS,
} from '../src/modules/identity/identity.service';
import { PasswordService } from '../src/modules/identity/password.service';
import { SESSION_IDLE_TIMEOUT_MS } from '../src/modules/identity/session.service';
import { UnverifiedAccountCleanupJob } from '../src/modules/identity/unverified-cleanup.job';
import {
  PASSWORD,
  SESSION_COOKIE,
  type TestApp,
  asTestOwner,
  createTestApp,
  expireSignup,
  login,
  sessionCookie,
  signup,
  signupVerified,
  uniqueEmail,
  verify,
  withSession,
} from './test-app';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const OTHER_PASSWORD = 'a different passphrase';

let t: TestApp;
/** A fresh app per describe: its own in-memory rate limiter and fake clock, so blocks don't interfere. */
function freshApp(): void {
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
}

const userIdOf = async (email: string) =>
  asTestOwner(async (sql) => {
    const [row] = await sql<{ id: string }[]>`select id from users where email = ${email}`;
    return row?.id;
  });

/** Tenants the user belongs to (user-only context, self_select). */
async function tenantIdsOf(userId: string): Promise<string[]> {
  const db = createDb(loadTestDatabaseEnv().appUrl, { max: 1 });
  try {
    return (
      await withContext(db.db, { userId }, (tx) =>
        tx.select({ id: memberships.tenantId }).from(memberships),
      )
    ).map((r) => r.id);
  } finally {
    await db.close();
  }
}

async function tenantExists(tenantId: string): Promise<boolean> {
  const db = createDb(loadTestDatabaseEnv().appUrl, { max: 1 });
  try {
    return (await withTenant(db.db, tenantId, (tx) => tx.select().from(tenants))).length === 1;
  } finally {
    await db.close();
  }
}

describe('M0-T4 AC: signup → verify email → login → me → logout revokes the session', () => {
  freshApp();
  const email = uniqueEmail('flow');
  let session: Awaited<ReturnType<typeof login>>;

  it('signup → 202 { status: check_email }, no session, a verification link by email', async () => {
    const res = await request(t.server)
      .post('/v1/auth/signup')
      .send({
        name: 'Asha',
        email: email.toUpperCase(),
        password: PASSWORD,
        tenantName: 'Asha Realty',
      })
      .expect(202);
    expect(res.body).toEqual({ status: 'check_email' });
    expect(res.headers['set-cookie']).toBeUndefined();
    await t.drain();
    expect(t.email.lastTo(email)?.text).toContain('http://localhost:3000/verify-email?token=');
  });

  it('login before verification → 403 email_not_verified (only with the right password)', async () => {
    const res = await request(t.server).post('/v1/auth/login').send({ email, password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'email_not_verified' });
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
  });

  it('verify-email needs the password; wrong password → verification_failed; link works once', async () => {
    const token = t.email.lastTokenTo(email);
    await request(t.server).post('/v1/auth/verify-email').send({ token }).expect(400);
    const wrong = await verify(t, token, OTHER_PASSWORD).expect(400);
    expect(wrong.body).toMatchObject({ code: 'verification_failed' });
    await verify(t, token).expect(204);
    const again = await verify(t, token).expect(400);
    expect(again.body).toMatchObject({ code: 'verification_failed' });
  });

  it('login sets an httpOnly, Secure, SameSite=Lax __Host- cookie and returns the session', async () => {
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
      user: { email, name: 'Asha', emailVerified: true },
      tenant: { name: 'Asha Realty', role: 'owner' },
    });
    expect(body.tenant?.slug).toMatch(/^asha-realty-[0-9a-f]{6}$/);
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
    const after = await withSession(request(t.server).get('/v1/auth/me'), session).expect(401);
    expect(after.body).toMatchObject({ code: 'unauthenticated' });
  });

  it('signup wrote the audit log and the user.signed_up.v1 outbox event (same transaction)', async () => {
    const { user, tenant } = session.body;
    const db = createDb(loadTestDatabaseEnv().appUrl, { max: 1 });
    try {
      const [audits, events] = await withTenant(db.db, tenant?.id ?? '', async (tx) => [
        await tx.select().from(auditLogs),
        await tx.select().from(outboxEvents),
      ]);
      expect(audits.map((a) => a.action)).toEqual(
        expect.arrayContaining(['user.signed_up', 'auth.login', 'auth.logout']),
      );
      expect(events).toEqual([
        expect.objectContaining({
          type: USER_SIGNED_UP_V1,
          aggregateId: user.id,
          payload: { userId: user.id, tenantId: tenant?.id },
          publishedAt: null,
        }),
      ]);
    } finally {
      await db.close();
    }
  });
});

describe('decision (a): signup for an email that already has a verified account', () => {
  freshApp();

  it('sends "you already have an account", creates nothing and changes nothing', async () => {
    const email = uniqueEmail('verified');
    const before = await signupVerified(t, email);
    const res = await request(t.server)
      .post('/v1/auth/signup')
      .send({ name: 'Mallory', email, password: OTHER_PASSWORD, tenantName: 'Evil Co' })
      .expect(202);
    expect(res.body).toEqual({ status: 'check_email' });
    await t.drain();

    const mail = t.email.lastTo(email);
    expect(mail?.subject).toBe('You already have a RevOps account');
    expect(mail?.text).toContain('http://localhost:3000/forgot-password');
    expect(mail?.text).not.toMatch(/token=/);

    await request(t.server)
      .post('/v1/auth/login')
      .send({ email, password: OTHER_PASSWORD })
      .expect(401);
    const after = await login(t, email);
    expect(after.body.user).toEqual(before.user);
    expect(await tenantIdsOf(before.user.id)).toEqual([before.tenant?.id]);
  });
});

describe('decision (b2): a fresh signup replaces a pending (unverified) one', () => {
  freshApp();

  it('new password + new tenant; the old link and old password stop working', async () => {
    const email = uniqueEmail('replace');
    await signup(t, email, PASSWORD, 'Victim Co');
    const oldToken = t.email.lastTokenTo(email);
    const oldUserId = await userIdOf(email);
    const oldTenants = await tenantIdsOf(oldUserId ?? '');

    await signup(t, email, OTHER_PASSWORD, 'Real Co');
    const newToken = t.email.lastTokenTo(email);
    expect(newToken).not.toBe(oldToken);

    // Old link is dead with either password; the new link needs the new password.
    await verify(t, oldToken, PASSWORD).expect(400);
    await verify(t, oldToken, OTHER_PASSWORD).expect(400);
    await verify(t, newToken, PASSWORD).expect(400);
    await verify(t, newToken, OTHER_PASSWORD).expect(204);

    await request(t.server).post('/v1/auth/login').send({ email, password: PASSWORD }).expect(401);
    const session = await login(t, email, OTHER_PASSWORD);
    expect(session.body.tenant?.name).toBe('Real Co');
    expect(session.body.user.id).not.toBe(oldUserId);
    for (const id of oldTenants) expect(await tenantExists(id)).toBe(false);
  });
});

describe('decision (b1): "this wasn’t me / start over"', () => {
  freshApp();

  it('the verify link deletes the unverified account and its tenant; the link then dies', async () => {
    const email = uniqueEmail('cancel');
    await signup(t, email);
    const token = t.email.lastTokenTo(email);
    const userId = await userIdOf(email);
    const [tenantId] = await tenantIdsOf(userId ?? '');
    expect(tenantId && (await tenantExists(tenantId))).toBe(true);

    await request(t.server).post('/v1/auth/verify-email/cancel').send({ token }).expect(204);

    expect(await userIdOf(email)).toBeUndefined();
    expect(await tenantExists(tenantId ?? '')).toBe(false);
    await verify(t, token).expect(400);
    await request(t.server).post('/v1/auth/login').send({ email, password: PASSWORD }).expect(401);
    const again = await request(t.server)
      .post('/v1/auth/verify-email/cancel')
      .send({ token })
      .expect(400);
    expect(again.body).toMatchObject({ code: 'invalid_token' });
  });

  it('cannot delete a verified account (its link is already used)', async () => {
    const email = uniqueEmail('cancel-verified');
    await signupVerified(t, email);
    const token = t.email.lastTokenTo(email);
    await request(t.server).post('/v1/auth/verify-email/cancel').send({ token }).expect(400);
    await login(t, email);
  });

  it(`wrong passwords count: ${VERIFY_MAX_ATTEMPTS} misses lock the link, even for the right password`, async () => {
    const email = uniqueEmail('verify-limit');
    await signup(t, email);
    const token = t.email.lastTokenTo(email);
    for (let i = 0; i < VERIFY_MAX_ATTEMPTS; i++)
      await verify(t, token, OTHER_PASSWORD).expect(400);
    const locked = await verify(t, token).expect(429);
    expect(locked.body).toMatchObject({ code: 'rate_limited' });
    t.clock.advance(LOGIN_WINDOW_MS + 1000);
    await verify(t, token).expect(204);
  });
});

describe('decision (b3): unverified accounts expire after 48 h', () => {
  freshApp();

  it('an expired signup is treated as non-existent by login, verify and resend', async () => {
    const email = uniqueEmail('expired');
    await signup(t, email);
    const token = t.email.lastTokenTo(email);
    await expireSignup(email);

    const res = await request(t.server).post('/v1/auth/login').send({ email, password: PASSWORD });
    expect(res.status).toBe(401); // not 403 email_not_verified
    expect(res.body).toMatchObject({ code: 'invalid_credentials' });
    const failed = await verify(t, token).expect(400);
    expect(failed.body).toMatchObject({ code: 'verification_failed' });

    const sent = t.email.sent.length;
    await request(t.server).post('/v1/auth/resend-verification').send({ email }).expect(202);
    await t.drain();
    expect(t.email.sent.length).toBe(sent);
  });

  it('signing up again after expiry starts a fresh account', async () => {
    const email = uniqueEmail('expired-again');
    await signup(t, email);
    await expireSignup(email);
    await signupVerified(t, email, OTHER_PASSWORD);
  });

  it('the cleanup job (scheduled in T6) deletes only unverified accounts past 48 h', async () => {
    const [expired, fresh, oldVerified] = [
      uniqueEmail('purge'),
      uniqueEmail('keep'),
      uniqueEmail('old'),
    ];
    await signup(t, expired);
    await signup(t, fresh);
    await signupVerified(t, oldVerified);
    await expireSignup(expired);
    await asTestOwner(
      (sql) =>
        sql`update users set created_at = now() - interval '100 hours' where email = ${oldVerified}`,
    );

    const removed = await t.app.get(UnverifiedAccountCleanupJob).run();
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(await userIdOf(expired)).toBeUndefined();
    expect(await userIdOf(fresh)).toBeDefined();
    expect(await userIdOf(oldVerified)).toBeDefined();
  });
});

describe('decision (b4): password reset revokes every session of the user', () => {
  freshApp();
  const email = uniqueEmail('reset');
  const NEW_PASSWORD = 'a brand new passphrase';

  it('forgot-password is 202 for unknown and known emails; only a real account gets mail', async () => {
    await signupVerified(t, email);
    const unknown = uniqueEmail('ghost');
    await request(t.server).post('/v1/auth/forgot-password').send({ email: unknown }).expect(202);
    await request(t.server).post('/v1/auth/forgot-password').send({ email }).expect(202);
    await t.drain();
    expect(t.email.lastTo(unknown)).toBeUndefined();
    expect(t.email.lastTo(email)?.text).toContain('/reset-password?token=');
  });

  it('reset revokes ALL sessions (in the DB), sets the new password, link works once', async () => {
    const [s1, s2, s3] = [await login(t, email), await login(t, email), await login(t, email)];
    await request(t.server).post('/v1/auth/forgot-password').send({ email }).expect(202);
    await t.drain();
    const token = t.email.lastTokenTo(email);
    await request(t.server)
      .post('/v1/auth/reset-password')
      .send({ token, password: 'too-short' })
      .expect(400);
    await request(t.server)
      .post('/v1/auth/reset-password')
      .send({ token, password: NEW_PASSWORD })
      .expect(204);

    for (const s of [s1, s2, s3]) {
      await withSession(request(t.server).get('/v1/auth/me'), s).expect(401);
    }
    const userId = await userIdOf(email);
    const [live] = await asTestOwner(
      (sql) =>
        sql<
          { n: number }[]
        >`select count(*)::int as n from sessions where user_id = ${userId ?? ''} and revoked_at is null`,
    );
    expect(live?.n).toBe(0);

    await request(t.server).post('/v1/auth/login').send({ email, password: PASSWORD }).expect(401);
    await login(t, email, NEW_PASSWORD);
    const reuse = await request(t.server)
      .post('/v1/auth/reset-password')
      .send({ token, password: 'yet another passphrase' })
      .expect(400);
    expect(reuse.body).toMatchObject({ code: 'invalid_token' });
  });
});

describe('timing-safety: responses never depend on account state', () => {
  freshApp();
  const emails = {
    new: uniqueEmail('new'),
    verified: uniqueEmail('verified'),
    pending: uniqueEmail('pending'),
    expired: uniqueEmail('expired'),
  };

  beforeAll(async () => {
    await signupVerified(t, emails.verified);
    await signup(t, emails.pending);
    await signup(t, emails.expired);
    await expireSignup(emails.expired);
  });

  /** status + body + content type + length: everything a client can observe. */
  const observable = (res: request.Response) => ({
    status: res.status,
    body: res.body as unknown,
    type: res.headers['content-type'],
    length: res.headers['content-length'],
  });

  it.each(['signup', 'resend-verification', 'forgot-password'] as const)(
    '%s: identical response for new / verified / pending / expired, and no account lookup or DB write before it',
    async (endpoint) => {
      const repository = t.app.get(IdentityRepository);
      const lookups = vi.spyOn(repository, 'findUserByEmail');
      const discards = vi.spyOn(repository, 'discardUnverifiedByEmail');
      const hashes = vi.spyOn(t.app.get(PasswordService), 'hash');
      try {
        const responses = [];
        for (const email of Object.values(emails)) {
          const body =
            endpoint === 'signup'
              ? { name: 'X', email, password: OTHER_PASSWORD, tenantName: 'X Co' }
              : { email };
          responses.push(
            observable(await request(t.server).post(`/v1/auth/${endpoint}`).send(body)),
          );
        }
        expect(new Set(responses.map((r) => JSON.stringify(r))).size).toBe(1);
        expect(responses[0]?.status).toBe(202);
        // Nothing state-dependent ran on the request path: it is all queued for the background.
        expect(lookups).not.toHaveBeenCalled();
        expect(discards).not.toHaveBeenCalled();
        expect(hashes).not.toHaveBeenCalled();
        expect(t.background.queue).toHaveLength(Object.keys(emails).length);
      } finally {
        t.background.queue.length = 0; // don't change the fixtures for the next case
        vi.restoreAllMocks();
      }
    },
  );

  it('login: exactly one argon2 verify and the same answer for unknown / wrong password / expired', async () => {
    const verifySpy = vi.spyOn(t.app.get(PasswordService), 'verify');
    try {
      const cases = [
        { email: uniqueEmail('nobody'), password: PASSWORD },
        { email: emails.verified, password: OTHER_PASSWORD },
        { email: emails.expired, password: PASSWORD }, // right password, expired account
      ];
      const responses = [];
      for (const body of cases) {
        verifySpy.mockClear();
        responses.push(observable(await request(t.server).post('/v1/auth/login').send(body)));
        expect(verifySpy).toHaveBeenCalledTimes(1);
      }
      expect(new Set(responses.map((r) => JSON.stringify(r))).size).toBe(1);
      expect(responses[0]).toMatchObject({ status: 401, body: { code: 'invalid_credentials' } });
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('verify-email: exactly one argon2 verify and the same answer for bad link / wrong password / expired account', async () => {
    const pendingToken = t.email.lastTokenTo(emails.pending);
    const expiredToken = t.email.lastTokenTo(emails.expired);
    const verifySpy = vi.spyOn(t.app.get(PasswordService), 'verify');
    try {
      const cases = [
        { token: 'A'.repeat(43), password: PASSWORD }, // unknown link
        { token: pendingToken, password: OTHER_PASSWORD }, // wrong password
        { token: expiredToken, password: PASSWORD }, // expired account, right password
      ];
      const responses = [];
      for (const body of cases) {
        verifySpy.mockClear();
        responses.push(
          observable(await request(t.server).post('/v1/auth/verify-email').send(body)),
        );
        expect(verifySpy).toHaveBeenCalledTimes(1);
      }
      expect(new Set(responses.map((r) => JSON.stringify(r))).size).toBe(1);
      expect(responses[0]).toMatchObject({ status: 400, body: { code: 'verification_failed' } });
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe('signup validation', () => {
  freshApp();

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

describe('resend verification', () => {
  freshApp();

  it('re-sends only to unverified accounts, 202 either way, max 3 per hour', async () => {
    const email = uniqueEmail('resend');
    await signup(t, email);
    const before = t.email.sent.length;
    for (let i = 0; i < 4; i++) {
      await request(t.server).post('/v1/auth/resend-verification').send({ email }).expect(202);
    }
    await t.drain();
    expect(t.email.sent.length - before).toBe(3);
    await verify(t, t.email.lastTokenTo(email)).expect(204);

    const verified = uniqueEmail('verified');
    await signupVerified(t, verified);
    const count = t.email.sent.length;
    await request(t.server)
      .post('/v1/auth/resend-verification')
      .send({ email: verified })
      .expect(202);
    await t.drain();
    expect(t.email.sent.length).toBe(count);
  });
});

describe('membership is re-checked on every request (security review #2)', () => {
  freshApp();

  it('a member removed from the tenant loses tenant access at once, without a new login', async () => {
    const email = uniqueEmail('removed');
    const { user, tenant } = await signupVerified(t, email);
    const session = await login(t, email);
    expect(session.body.tenant?.id).toBe(tenant?.id);

    const db = createDb(loadTestDatabaseEnv().appUrl, { max: 1 });
    try {
      await withTenant(db.db, tenant?.id ?? '', (tx) =>
        tx.update(memberships).set({ status: 'disabled' }).where(eq(memberships.userId, user.id)),
      );
    } finally {
      await db.close();
    }

    const me = await withSession(request(t.server).get('/v1/auth/me'), session).expect(200);
    expect((me.body as SessionResponse).tenant).toBeNull();
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
