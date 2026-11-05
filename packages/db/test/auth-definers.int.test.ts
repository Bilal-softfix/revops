import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/client.js';
import { authTokens, sessions } from '../src/schema/index.js';
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

describe('auth_consume_token', () => {
  const insertToken = async (patch: Partial<typeof authTokens.$inferInsert> = {}) => {
    const token = newToken();
    await withContext(app.db, { userId }, (tx) =>
      tx.insert(authTokens).values({
        userId,
        purpose: 'password_reset',
        tokenHash: sha256(token),
        expiresAt: inOneDay(),
        ...patch,
      }),
    );
    return token;
  };
  const consume = async (token: string, purpose = 'password_reset') => {
    const [row] = await app.db.execute<{ user_id: string | null }>(
      sql`select auth_consume_token(${sha256(token)}, ${purpose}::auth_token_purpose) as user_id`,
    );
    return row?.user_id ?? null;
  };

  it('returns the user id once, then null (single use)', async () => {
    const token = await insertToken();
    expect(await consume(token)).toBe(userId);
    expect(await consume(token)).toBeNull();
  });

  it('is single-use under concurrent consumption', async () => {
    const token = await insertToken();
    const results = await Promise.all(Array.from({ length: 4 }, () => consume(token)));
    expect(results.filter((r) => r === userId)).toHaveLength(1);
  });

  it('rejects expired tokens and tokens of another purpose', async () => {
    expect(await consume(await insertToken({ expiresAt: new Date(Date.now() - 1000) }))).toBeNull();
    expect(await consume(await insertToken(), 'email_verify')).toBeNull();
  });
});
