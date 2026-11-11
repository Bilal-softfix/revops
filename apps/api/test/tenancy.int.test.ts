import { auditLogs, createDb, outboxEvents, withTenant } from '@revops/db';
import { loadTestDatabaseEnv } from '@revops/db/testing';
import {
  type Invitation,
  MEMBER_JOINED_V1,
  type MemberPage,
  type MyTenantsResponse,
  ROLES,
  type Role,
  type SessionResponse,
} from '@revops/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INVITATION_TTL_MS } from '../src/modules/tenancy/tenancy.service';
import {
  type LoggedIn,
  PASSWORD,
  type TestApp,
  addMember,
  createTestApp,
  login,
  sessionCookie,
  signup,
  signupVerified,
  uniqueEmail,
  withSession,
} from './test-app';

const OTHER_PASSWORD = 'another long passphrase';

let t: TestApp;
/** A fresh app per describe: its own rate limiters and clock. */
function freshApp(): void {
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
}

/** An owner (via real signup) and a logged-in session for each other role, in one tenant. */
async function team(): Promise<{ tenantId: string; sessions: Record<Role, LoggedIn> }> {
  const ownerEmail = uniqueEmail('owner');
  const owner = await signupVerified(t, ownerEmail);
  const tenantId = owner.tenant?.id ?? '';
  const sessions = { owner: await login(t, ownerEmail) } as Record<Role, LoggedIn>;
  for (const role of ['admin', 'manager', 'agent'] as const) {
    const { email } = await addMember(t, tenantId, role);
    sessions[role] = await login(t, email);
  }
  return { tenantId, sessions };
}

const invite = (s: LoggedIn, email: string, role: Role) =>
  withSession(request(t.server).post('/v1/invitations'), s).send({ email, role });

describe('M0-T5 AC: every role against the protected route matrix', () => {
  freshApp();
  let tenantId: string;
  let sessions: Record<Role, LoggedIn>;
  let targetAgent: string;

  beforeAll(async () => {
    ({ tenantId, sessions } = await team());
    targetAgent = (await addMember(t, tenantId, 'agent')).userId;
  });

  const allowed = (roles: readonly Role[]) =>
    Object.fromEntries(ROLES.map((r) => [r, roles.includes(r)]));
  const MATRIX: {
    name: string;
    allow: Record<string, boolean>;
    call: (s: LoggedIn, role: Role) => Promise<request.Response>;
    ok: number;
  }[] = [
    {
      name: 'GET /v1/members',
      allow: allowed(ROLES),
      call: (s) => withSession(request(t.server).get('/v1/members'), s),
      ok: 200,
    },
    {
      name: 'GET /v1/invitations',
      allow: allowed(['owner', 'admin']),
      call: (s) => withSession(request(t.server).get('/v1/invitations'), s),
      ok: 200,
    },
    {
      name: 'POST /v1/invitations (agent cannot invite)',
      allow: allowed(['owner', 'admin']),
      call: (s, role) => invite(s, uniqueEmail(`by-${role}`), 'agent'),
      ok: 201,
    },
    {
      name: 'PATCH /v1/members/:id',
      allow: allowed(['owner', 'admin']),
      call: (s) =>
        withSession(request(t.server).patch(`/v1/members/${targetAgent}`), s).send({
          role: 'agent',
        }),
      ok: 200,
    },
    {
      name: 'POST /v1/invitations/:id/resend',
      allow: allowed(['owner', 'admin']),
      call: async (s, role) => {
        const created = await invite(sessions.owner, uniqueEmail(`resend-${role}`), 'agent');
        const id = (created.body as Invitation).id;
        return withSession(request(t.server).post(`/v1/invitations/${id}/resend`), s);
      },
      ok: 204,
    },
    {
      name: 'DELETE /v1/invitations/:id',
      allow: allowed(['owner', 'admin']),
      call: async (s, role) => {
        const created = await invite(sessions.owner, uniqueEmail(`revoke-${role}`), 'agent');
        const id = (created.body as Invitation).id;
        return withSession(request(t.server).delete(`/v1/invitations/${id}`), s);
      },
      ok: 204,
    },
  ];

  describe.each(MATRIX)('$name', ({ allow, call, ok }) => {
    it.each([...ROLES])('%s', async (role) => {
      const res = await call(sessions[role], role);
      if (allow[role]) {
        expect(res.status, JSON.stringify(res.body)).toBe(ok);
      } else {
        expect(res.status).toBe(403);
        expect(res.body).toMatchObject({ code: 'forbidden' });
      }
    });
  });

  it('every protected route rejects anonymous callers with 401', async () => {
    for (const [method, path] of [
      ['get', '/v1/members'],
      ['get', '/v1/invitations'],
      ['post', '/v1/invitations'],
      ['patch', `/v1/members/${targetAgent}`],
      ['get', '/v1/tenants'],
    ] as const) {
      const res = await request(t.server)[method](path).send({});
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });

  it('unsafe routes still need the CSRF token', async () => {
    const res = await withSession(
      request(t.server).post('/v1/invitations'),
      sessions.owner,
      false,
    ).send({ email: uniqueEmail(), role: 'agent' });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'csrf_invalid' });
  });
});

describe('invitations: who may invite what', () => {
  freshApp();
  let tenantId: string;
  let sessions: Record<Role, LoggedIn>;
  beforeAll(async () => {
    ({ tenantId, sessions } = await team());
  });

  it('only owners can invite owners', async () => {
    expect((await invite(sessions.admin, uniqueEmail(), 'owner')).status).toBe(403);
    expect((await invite(sessions.owner, uniqueEmail(), 'owner')).status).toBe(201);
  });

  it('one open invitation per email; active members can’t be invited again', async () => {
    const email = uniqueEmail('dup');
    await invite(sessions.owner, email, 'agent').expect(201);
    const again = await invite(sessions.admin, email, 'manager').expect(409);
    expect(again.body).toMatchObject({ code: 'invitation_exists' });
    const member = await addMember(t, tenantId, 'agent');
    const existing = await invite(sessions.owner, member.email, 'manager').expect(409);
    expect(existing.body).toMatchObject({ code: 'already_member' });
  });

  it('emails a single-use link that names the inviter, workspace and role', async () => {
    const email = uniqueEmail('mail');
    await invite(sessions.owner, email, 'manager').expect(201);
    await t.drain();
    const mail = t.email.lastTo(email);
    expect(mail?.subject).toMatch(/invited you to Asha Realty/);
    expect(mail?.text).toContain('as a manager');
    expect(t.email.lastTokenTo(email)).toMatch(new RegExp(`^${tenantId}\\.[A-Za-z0-9_-]{43}$`));
  });

  it('admins can’t resend or revoke an owner invitation', async () => {
    const created = await invite(sessions.owner, uniqueEmail(), 'owner').expect(201);
    const id = (created.body as Invitation).id;
    await withSession(
      request(t.server).post(`/v1/invitations/${id}/resend`),
      sessions.admin,
    ).expect(403);
    await withSession(request(t.server).delete(`/v1/invitations/${id}`), sessions.admin).expect(
      403,
    );
  });
});

describe('accepting an invitation', () => {
  freshApp();
  let tenantId: string;
  let owner: LoggedIn;
  const accept = (body: Record<string, unknown>, session?: LoggedIn) => {
    const req = request(t.server).post('/v1/invitations/accept');
    return (session ? withSession(req, session) : req).send(body);
  };
  async function invited(email: string, role: Role = 'agent'): Promise<string> {
    await invite(owner, email, role).expect(201);
    await t.drain();
    return t.email.lastTokenTo(email) ?? '';
  }

  beforeAll(async () => {
    const email = uniqueEmail('owner');
    tenantId = (await signupVerified(t, email)).tenant?.id ?? '';
    owner = await login(t, email);
  });

  it('a new user sets name + password, is created verified, joins and is signed in', async () => {
    const email = uniqueEmail('newbie');
    const token = await invited(email, 'manager');
    const missing = await accept({ token }).expect(400);
    expect(missing.body).toMatchObject({ code: 'invitation_details_required' });

    const res = await accept({ token, name: 'New Bie', password: OTHER_PASSWORD }).expect(200);
    const body = res.body as SessionResponse;
    expect(body).toMatchObject({
      user: { email, name: 'New Bie', emailVerified: true },
      tenant: { id: tenantId, role: 'manager' },
    });
    sessionCookie(res); // signed in
    await login(t, email, OTHER_PASSWORD);

    const reuse = await accept({ token, name: 'X', password: OTHER_PASSWORD }).expect(400);
    expect(reuse.body).toMatchObject({ code: 'invalid_invitation' });

    const db = createDb(loadTestDatabaseEnv().appUrl, { max: 1 });
    try {
      const [audits, events] = await withTenant(db.db, tenantId, async (tx) => [
        await tx.select().from(auditLogs),
        await tx.select().from(outboxEvents),
      ]);
      expect(audits.map((a) => a.action)).toContain('member.joined');
      expect(events.map((e) => e.type)).toContain(MEMBER_JOINED_V1);
    } finally {
      await db.close();
    }
  });

  it('an existing verified user must be signed in as the invited email; then joins + switches', async () => {
    const email = uniqueEmail('existing');
    const own = await signupVerified(t, email); // has their own workspace
    const token = await invited(email, 'admin');

    const anonymous = await accept({ token }).expect(401);
    expect(anonymous.body).toMatchObject({ code: 'invitation_login_required' });
    const wrong = await accept({ token }, owner).expect(403);
    expect(wrong.body).toMatchObject({ code: 'invitation_email_mismatch' });

    const session = await login(t, email);
    const res = await accept({ token }, session).expect(200);
    expect((res.body as SessionResponse).tenant).toMatchObject({ id: tenantId, role: 'admin' });
    expect(res.headers['set-cookie']).toBeUndefined(); // same session, now on the new tenant

    const me = await withSession(request(t.server).get('/v1/auth/me'), session).expect(200);
    expect((me.body as SessionResponse).tenant?.id).toBe(tenantId);
    const tenants = await withSession(request(t.server).get('/v1/tenants'), session).expect(200);
    expect((tenants.body as MyTenantsResponse).items.map((x) => x.id).sort()).toEqual(
      [tenantId, own.tenant?.id].sort(),
    );

    // Tenant switcher: back to their own workspace, never to someone else's.
    const back = await withSession(request(t.server).post('/v1/session/tenant'), session)
      .send({ tenantId: own.tenant?.id })
      .expect(200);
    expect((back.body as SessionResponse).tenant).toMatchObject({
      id: own.tenant?.id,
      role: 'owner',
    });
    const foreign = await signupVerified(t, uniqueEmail('stranger'));
    await withSession(request(t.server).post('/v1/session/tenant'), session)
      .send({ tenantId: foreign.tenant?.id })
      .expect(404);
  });

  it('replaces a pending (unverified) signup for the invited email', async () => {
    const email = uniqueEmail('pending');
    await signup(t, email, PASSWORD); // never verified
    const token = await invited(email);
    await accept({ token, name: 'Real Person', password: OTHER_PASSWORD }).expect(200);
    await request(t.server).post('/v1/auth/login').send({ email, password: PASSWORD }).expect(401);
    await login(t, email, OTHER_PASSWORD);
  });

  it('revoked, expired and rotated (resent) links don’t work', async () => {
    const email = uniqueEmail('dead');
    const first = await invited(email);
    const list = await withSession(request(t.server).get('/v1/invitations'), owner).expect(200);
    const id = (list.body as { items: Invitation[] }).items.find((i) => i.email === email)?.id;

    await withSession(request(t.server).post(`/v1/invitations/${id}/resend`), owner).expect(204);
    await t.drain();
    const second = t.email.lastTokenTo(email);
    expect(second).not.toBe(first);
    await accept({ token: first, name: 'X', password: OTHER_PASSWORD }).expect(400);

    const fresh = uniqueEmail('revoked');
    const token = await invited(fresh);
    const items = (
      (await withSession(request(t.server).get('/v1/invitations'), owner)).body as {
        items: Invitation[];
      }
    ).items;
    const revokeId = items.find((i) => i.email === fresh)?.id;
    await withSession(request(t.server).delete(`/v1/invitations/${revokeId}`), owner).expect(204);
    await accept({ token, name: 'X', password: OTHER_PASSWORD }).expect(400);

    // Last: jumping 7 days also idles out the owner's session (7-day idle timeout).
    t.clock.advance(INVITATION_TTL_MS + 60_000);
    await accept({ token: second, name: 'X', password: OTHER_PASSWORD }).expect(400);
  });

  it('garbage and foreign-tenant tokens are just invalid', async () => {
    const res = await accept({
      token: `aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.${'A'.repeat(43)}`,
      name: 'X',
      password: OTHER_PASSWORD,
    }).expect(400);
    expect(res.body).toMatchObject({ code: 'invalid_invitation' });
  });
});

describe('changing roles and disabling members', () => {
  freshApp();
  let tenantId: string;
  let sessions: Record<Role, LoggedIn>;
  const patch = (s: LoggedIn, userId: string, body: Record<string, unknown>) =>
    withSession(request(t.server).patch(`/v1/members/${userId}`), s).send(body);

  beforeAll(async () => {
    ({ tenantId, sessions } = await team());
  });

  it('M0-T5 AC: the last owner can’t be demoted or disabled; nobody disables themselves', async () => {
    const ownerId = sessions.owner.body.user.id;
    const demote = await patch(sessions.owner, ownerId, { role: 'admin' }).expect(409);
    expect(demote.body).toMatchObject({ code: 'last_owner' });
    const self = await patch(sessions.owner, ownerId, { status: 'disabled' }).expect(409);
    expect(self.body).toMatchObject({ code: 'cannot_change_self' });
  });

  it('admins can’t touch owners or grant owner', async () => {
    const ownerId = sessions.owner.body.user.id;
    await patch(sessions.admin, ownerId, { status: 'disabled' }).expect(403);
    const agent = await addMember(t, tenantId, 'agent');
    await patch(sessions.admin, agent.userId, { role: 'owner' }).expect(403);
    const ok = await patch(sessions.admin, agent.userId, { role: 'manager' }).expect(200);
    expect(ok.body).toMatchObject({ userId: agent.userId, role: 'manager', status: 'active' });
  });

  it('with a second owner, an owner can step down — but two concurrent demotions can’t leave none', async () => {
    const second = await addMember(t, tenantId, 'owner');
    const secondSession = await login(t, second.email);
    const firstId = sessions.owner.body.user.id;
    const results = await Promise.all([
      patch(sessions.owner, second.userId, { role: 'admin' }),
      patch(secondSession, firstId, { role: 'admin' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it('a disabled member loses access at once and gets it back when re-enabled', async () => {
    const owner = (await team()).sessions.owner;
    const ownerTenant = owner.body.tenant?.id ?? '';
    const member = await addMember(t, ownerTenant, 'manager');
    const session = await login(t, member.email);
    await withSession(request(t.server).get('/v1/members'), session).expect(200);

    await patch(owner, member.userId, { status: 'disabled' }).expect(200);
    const blocked = await withSession(request(t.server).get('/v1/members'), session).expect(403);
    expect(blocked.body).toMatchObject({ code: 'no_active_tenant' });

    await patch(owner, member.userId, { status: 'active' }).expect(200);
    await withSession(request(t.server).get('/v1/members'), session).expect(200);
  });

  it('unknown member → 404; a member of another tenant is invisible (404, not 403)', async () => {
    await patch(sessions.owner, '00000000-0000-4000-8000-000000000000', { role: 'agent' }).expect(
      404,
    );
    const other = await team();
    const outsider = await addMember(t, other.tenantId, 'agent');
    await patch(sessions.owner, outsider.userId, { role: 'manager' }).expect(404);
  });
});

describe('members list', () => {
  freshApp();

  it('pages with an opaque cursor, covering everyone exactly once', async () => {
    const { tenantId, sessions } = await team();
    for (let i = 0; i < 3; i++) await addMember(t, tenantId, 'agent');
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const query: Record<string, string | number> = cursor ? { limit: 2, cursor } : { limit: 2 };
      const res = await withSession(
        request(t.server).get('/v1/members').query(query),
        sessions.owner,
      ).expect(200);
      const page = res.body as MemberPage;
      expect(page.items.length).toBeLessThanOrEqual(2);
      seen.push(...page.items.map((m) => m.userId));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toHaveLength(7); // owner + admin + manager + agent + 3 agents
    expect(new Set(seen).size).toBe(7);
  });

  it('never lists another tenant’s members', async () => {
    const a = await team();
    const b = await team();
    const res = await withSession(request(t.server).get('/v1/members'), a.sessions.owner).expect(
      200,
    );
    const ids = (res.body as MemberPage).items.map((m) => m.userId);
    for (const s of Object.values(b.sessions)) expect(ids).not.toContain(s.body.user.id);
  });
});
