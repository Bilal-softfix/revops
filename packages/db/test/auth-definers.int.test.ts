import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/client.js';
import { authTokens, memberships, sessions, tenants } from '../src/schema/index.js';
import { loadTestDatabaseEnv } from '../src/testing/index.js';
import { withContext } from '../src/with-tenant.js';
import { insertUser } from './users.js';

// The SECURITY DEFINER lookups work without any context, return only their documented fields,
// and enforce their own validity rules (revoked/expired sessions, single-use tokens).
const { appUrl } = loadTestDatabaseEnv();
const app = createDb(appUrl, { max: 4 });
afterAll(() => app.close());

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');
const inOneDay = () => new Date(Date.now() + 86_400_000);

let userId: string;
const email = `${randomUUID()}@Definer.Test`;

beforeAll(async () => {
  userId = randomUUID();
  await withContext(app.db, { userId }, (tx) =>
    insertUser(tx, { id: userId, email: email.toLowerCase(), passwordHash: '$argon2id$fake' }),
  );
});

describe('auth_find_user_by_email', () => {
  it('finds a user case-insensitively with no context, returning only id/hash/verified', async () => {
    const rows = await app.db.execute(sql`select * from auth_find_user_by_email(${email})`);
    expect(rows).toEqual([
      { id: userId, password_hash: '$argon2id$fake', email_verified_at: null },
    ]);
  });

  it('returns nothing for an unknown email', async () => {
    expect(
      await app.db.execute(sql`select * from auth_find_user_by_email('nobody@x.test')`),
    ).toEqual([]);
  });
});

describe('auth_session_lookup', () => {
  const insertSession = async (patch: Partial<typeof sessions.$inferInsert>) => {
    const token = newToken();
    await withContext(app.db, { userId }, (tx) =>
      tx
        .insert(sessions)
        .values({ userId, tokenHash: sha256(token), expiresAt: inOneDay(), ...patch }),
    );
    return token;
  };
  const lookup = (token: string) =>
    app.db.execute<{ session_id: string; user_id: string }>(
      sql`select * from auth_session_lookup(${sha256(token)})`,
    );

  it('returns a live session (no context needed)', async () => {
    const rows = await lookup(await insertSession({}));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: userId, active_tenant_id: null });
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual(
      ['active_tenant_id', 'last_seen_at', 'session_id', 'user_id'].sort(),
    );
  });

  it('ignores revoked and expired sessions', async () => {
    expect(await lookup(await insertSession({ revokedAt: new Date() }))).toEqual([]);
    expect(await lookup(await insertSession({ expiresAt: new Date(Date.now() - 1000) }))).toEqual(
      [],
    );
  });
});

describe('unverified accounts, verify and reset (migrations 0005, 0006)', () => {
  const HOUR = 3_600_000;
  const DENIED = '42501';

  /** An unverified (or verified) user who owns one tenant, created `ageHours` ago. */
  async function account(opts: { ageHours: number; verified?: boolean }) {
    const id = randomUUID();
    const tenantId = randomUUID();
    const userEmail = `${id}@pending.test`;
    const createdAt = new Date(Date.now() - opts.ageHours * HOUR);
    await withContext(app.db, { tenantId, userId: id }, async (tx) => {
      await insertUser(tx, {
        id,
        email: userEmail,
        passwordHash: '$argon2id$x',
        createdAt,
        emailVerifiedAt: opts.verified ? createdAt : null,
      });
      await tx.insert(tenants).values({ id: tenantId, name: 'P', slug: `p-${id}` });
      await tx.insert(memberships).values({ tenantId, userId: id, role: 'owner' });
    });
    const token = newToken();
    await withContext(app.db, { userId: id }, (tx) =>
      tx.insert(authTokens).values({
        userId: id,
        purpose: 'email_verify',
        tokenHash: sha256(token),
        expiresAt: inOneDay(),
      }),
    );
    return { id, tenantId, email: userEmail, token };
  }
  const tenantExists = async (tenantId: string) =>
    (await withContext(app.db, { tenantId }, (tx) => tx.select().from(tenants))).length === 1;
  const findByEmail = (e: string) =>
    app.db.execute(sql`select id from auth_find_user_by_email(${e})`);

  it('auth_find_user_by_email hides unverified accounts older than 48 h, not verified ones', async () => {
    const [fresh, expired, oldVerified] = [
      await account({ ageHours: 1 }),
      await account({ ageHours: 49 }),
      await account({ ageHours: 24 * 30, verified: true }),
    ];
    expect(await findByEmail(fresh.email)).toHaveLength(1);
    expect(await findByEmail(expired.email)).toEqual([]);
    expect(await findByEmail(oldVerified.email)).toHaveLength(1);
  });

  it('auth_peek_verify_token returns user + hash without consuming; nothing for expired accounts', async () => {
    const fresh = await account({ ageHours: 1 });
    const peek = () =>
      app.db.execute(sql`select * from auth_peek_verify_token(${sha256(fresh.token)})`);
    expect(await peek()).toEqual([{ user_id: fresh.id, password_hash: '$argon2id$x' }]);
    expect(await peek()).toHaveLength(1); // still there: peek doesn't consume
    const expired = await account({ ageHours: 49 });
    expect(
      await app.db.execute(sql`select * from auth_peek_verify_token(${sha256(expired.token)})`),
    ).toEqual([]);
  });

  it('auth_discard_unverified_by_email removes the pending user and its tenant; never a verified one', async () => {
    const pending = await account({ ageHours: 1 });
    const verified = await account({ ageHours: 1, verified: true });
    const discard = async (e: string) =>
      (
        await app.db.execute<{ ok: boolean }>(
          sql`select auth_discard_unverified_by_email(${e}) as ok`,
        )
      )[0]?.ok;

    expect(await discard(pending.email)).toBe(true);
    expect(await findByEmail(pending.email)).toEqual([]);
    expect(await tenantExists(pending.tenantId)).toBe(false);

    expect(await discard(verified.email)).toBe(false);
    expect(await findByEmail(verified.email)).toHaveLength(1);
    expect(await tenantExists(verified.tenantId)).toBe(true);
  });

  it('keeps a tenant that has other members', async () => {
    const pending = await account({ ageHours: 1 });
    const other = await withContext(app.db, { tenantId: pending.tenantId }, async (tx) => {
      const id = await insertUser(tx);
      await tx
        .insert(memberships)
        .values({ tenantId: pending.tenantId, userId: id, role: 'admin' });
      return id;
    });
    await app.db.execute(sql`select auth_discard_unverified_by_email(${pending.email})`);
    expect(await findByEmail(pending.email)).toEqual([]);
    expect(await tenantExists(pending.tenantId)).toBe(true);
    // ...and the other member keeps their membership; only the discarded user's is gone.
    const remaining = await withContext(app.db, { tenantId: pending.tenantId }, (tx) =>
      tx.select({ userId: memberships.userId }).from(memberships),
    );
    expect(remaining).toEqual([{ userId: other }]);
  });

  it('auth_discard_unverified_by_token works only with a live verify token', async () => {
    const pending = await account({ ageHours: 1 });
    const discard = async (token: string) =>
      (
        await app.db.execute<{ ok: boolean }>(
          sql`select auth_discard_unverified_by_token(${sha256(token)}) as ok`,
        )
      )[0]?.ok;
    expect(await discard(newToken())).toBe(false);
    expect(await discard(pending.token)).toBe(true);
    expect(await tenantExists(pending.tenantId)).toBe(false);
    expect(await discard(pending.token)).toBe(false);
  });

  it('auth_purge_expired_unverified removes only unverified accounts past 48 h', async () => {
    const [expired, fresh, oldVerified] = [
      await account({ ageHours: 49 }),
      await account({ ageHours: 47 }),
      await account({ ageHours: 100, verified: true }),
    ];
    const [row] = await app.db.execute<{ n: number }>(
      sql`select auth_purge_expired_unverified() as n`,
    );
    expect(row?.n).toBeGreaterThanOrEqual(1);
    expect(await tenantExists(expired.tenantId)).toBe(false);
    expect(await tenantExists(fresh.tenantId)).toBe(true);
    expect(await tenantExists(oldVerified.tenantId)).toBe(true);
  });

  it('app_user cannot call the internal auth_discard_unverified_user directly', async () => {
    const pending = await account({ ageHours: 1 });
    await expect(
      app.db.execute(sql`select auth_discard_unverified_user(${pending.id}::uuid)`),
    ).rejects.toSatisfy((e) => {
      const err = e as { code?: string; cause?: { code?: string } };
      return (err.code ?? err.cause?.code) === DENIED;
    });
  });

  it('restores the caller’s context (tenant and user, set or unset), whether or not it discarded', async () => {
    const read = (tx: Parameters<Parameters<typeof withContext>[2]>[0]) =>
      tx.execute<{ t: string | null; u: string | null }>(
        sql`select nullif(current_setting('app.tenant_id', true), '') as t,
                   nullif(current_setting('app.user_id', true), '') as u`,
      );
    for (const ctx of [{ tenantId: randomUUID(), userId: randomUUID() }, {}]) {
      for (const discards of [true, false]) {
        const target = discards ? (await account({ ageHours: 1 })).email : 'nobody@x.test';
        const [row] = await withContext(app.db, ctx, async (tx) => {
          await tx.execute(sql`select auth_discard_unverified_by_email(${target})`);
          return read(tx);
        });
        expect(row).toEqual({ t: ctx.tenantId ?? null, u: ctx.userId ?? null });
      }
    }
  });

  describe('auth_verify_email (atomic)', () => {
    const verifyFn = async (token: string, id: string) =>
      (
        await app.db.execute<{ ok: boolean }>(
          sql`select auth_verify_email(${sha256(token)}, ${id}::uuid) as ok`,
        )
      )[0]?.ok;

    it('verifies the owner of a live link once, and spends all of its verify links', async () => {
      const pending = await account({ ageHours: 1 });
      expect(await verifyFn(pending.token, pending.id)).toBe(true);
      expect(await verifyFn(pending.token, pending.id)).toBe(false);
      const [row] = await app.db.execute<{ email_verified_at: unknown }>(
        sql`select email_verified_at from auth_find_user_by_email(${pending.email})`,
      );
      expect(row?.email_verified_at).not.toBeNull();
    });

    it('rejects a link presented for another user, and expired accounts', async () => {
      const [a, b] = [await account({ ageHours: 1 }), await account({ ageHours: 1 })];
      expect(await verifyFn(a.token, b.id)).toBe(false);
      const expired = await account({ ageHours: 49 });
      expect(await verifyFn(expired.token, expired.id)).toBe(false);
    });

    it('racing a discard: never "verified" for an account that was deleted', async () => {
      for (let i = 0; i < 6; i++) {
        const pending = await account({ ageHours: 1 });
        const [verified] = await Promise.all([
          verifyFn(pending.token, pending.id),
          app.db.execute(sql`select auth_discard_unverified_by_email(${pending.email})`),
        ]);
        const exists = (await findByEmail(pending.email)).length === 1;
        // Either verify won (account kept, verified) or discard won (account gone, verify false).
        expect({ verified, exists }).toEqual(
          verified ? { verified: true, exists: true } : { verified: false, exists: false },
        );
        expect(await tenantExists(pending.tenantId)).toBe(exists);
      }
    });
  });

  describe('auth_reset_password (atomic)', () => {
    async function withResetLink(opts: { ageHours?: number; verified?: boolean } = {}) {
      const acc = await account({ ageHours: opts.ageHours ?? 1, verified: opts.verified ?? true });
      const token = newToken();
      await withContext(app.db, { userId: acc.id }, async (tx) => {
        await tx.insert(authTokens).values({
          userId: acc.id,
          purpose: 'password_reset',
          tokenHash: sha256(token),
          expiresAt: inOneDay(),
        });
        for (let i = 0; i < 2; i++) {
          await tx
            .insert(sessions)
            .values({ userId: acc.id, tokenHash: sha256(newToken()), expiresAt: inOneDay() });
        }
      });
      return { ...acc, resetToken: token };
    }
    const reset = async (token: string, hash = '$argon2id$new') =>
      (
        await app.db.execute<{ user_id: string | null }>(
          sql`select auth_reset_password(${sha256(token)}, ${hash}) as user_id`,
        )
      )[0]?.user_id ?? null;

    it('sets the password, revokes every session and spends every link — in one call', async () => {
      const acc = await withResetLink();
      expect(await reset(acc.resetToken)).toBe(acc.id);
      const [user] = await app.db.execute<{ password_hash: string }>(
        sql`select password_hash from auth_find_user_by_email(${acc.email})`,
      );
      expect(user?.password_hash).toBe('$argon2id$new');
      const state = await withContext(app.db, { userId: acc.id }, async (tx) => ({
        liveSessions: (await tx.select().from(sessions)).filter((r) => !r.revokedAt).length,
        liveLinks: (await tx.select().from(authTokens)).filter((r) => !r.usedAt).length,
      }));
      expect(state).toEqual({ liveSessions: 0, liveLinks: 0 });
    });

    it('is single-use, also under concurrent calls', async () => {
      const acc = await withResetLink();
      const results = await Promise.allSettled(
        Array.from({ length: 4 }, () => reset(acc.resetToken)),
      );
      const winners = results.filter((r) => r.status === 'fulfilled' && r.value === acc.id);
      expect(winners).toHaveLength(1);
      expect(await reset(acc.resetToken)).toBeNull();
    });

    it('rejects unknown links, verify links, and expired unverified accounts', async () => {
      expect(await reset(newToken())).toBeNull();
      const pending = await account({ ageHours: 1 });
      expect(await reset(pending.token)).toBeNull(); // an email_verify link
      const expired = await withResetLink({ ageHours: 49, verified: false });
      expect(await reset(expired.resetToken)).toBeNull();
    });
  });
});
