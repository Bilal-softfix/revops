import { randomBytes, randomUUID } from 'node:crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Tx, createDb } from '../src/client.js';
import { authTokens, memberships, sessions, tenants, users } from '../src/schema/index.js';
import { loadTestDatabaseEnv } from '../src/testing/index.js';
import { type DbContext, withContext } from '../src/with-tenant.js';
import { createTenant } from './tenant-tables.js';
import { insertUser } from './users.js';

// Leak tests for the global, user-scoped tables (M0-T4 decision): app_user sees only itself and
// users with a membership in the current tenant; sessions/auth_tokens only the acting user's.
const { appUrl } = loadTestDatabaseEnv();
const app = createDb(appUrl, { max: 2 });
afterAll(() => app.close());

const DENIED = '42501';
const pgCode = (e: unknown) => {
  const err = e as { code?: string; cause?: { code?: string } };
  return err.code ?? err.cause?.code;
};
const as = <T>(ctx: DbContext, fn: (tx: Tx) => Promise<T>) => withContext(app.db, ctx, fn);
const hashLike = () => randomBytes(32).toString('hex');

let tenantA: string;
let tenantB: string;
let tenantC: string;
/** uA1, uA2 ∈ A · uB ∈ B · uAB ∈ A and B · uX ∈ none */
const u: Record<'A1' | 'A2' | 'B' | 'AB' | 'X', string> = { A1: '', A2: '', B: '', AB: '', X: '' };
const sessionOf: Record<string, string> = {};
const tokenOf: Record<string, string> = {};

beforeAll(async () => {
  [tenantA, tenantB, tenantC] = [
    await createTenant(app.db, 'A'),
    await createTenant(app.db, 'B'),
    await createTenant(app.db, 'C'),
  ];
  const member = async (key: keyof typeof u, tenantIds: string[]) => {
    const id = randomUUID();
    u[key] = id;
    await as({ userId: id }, (tx) => insertUser(tx, { id }));
    for (const tenantId of tenantIds) {
      await as({ tenantId, userId: id }, (tx) =>
        tx.insert(memberships).values({ tenantId, userId: id, role: 'agent' }),
      );
    }
    await as({ userId: id }, async (tx) => {
      const [s] = await tx
        .insert(sessions)
        .values({ userId: id, tokenHash: hashLike(), expiresAt: new Date(Date.now() + 86_400_000) })
        .returning({ id: sessions.id });
      const [t] = await tx
        .insert(authTokens)
        .values({
          userId: id,
          purpose: 'email_verify',
          tokenHash: hashLike(),
          expiresAt: new Date(Date.now() + 86_400_000),
        })
        .returning({ id: authTokens.id });
      sessionOf[key] = s?.id ?? '';
      tokenOf[key] = t?.id ?? '';
    });
  };
  await member('A1', [tenantA]);
  await member('A2', [tenantA]);
  await member('B', [tenantB]);
  await member('AB', [tenantA, tenantB]);
  await member('X', []);
});

const visibleUserIds = (ctx: DbContext) =>
  as(ctx, async (tx) => (await tx.select({ id: users.id }).from(users)).map((r) => r.id).sort());

describe('users RLS', () => {
  it('in a tenant context: self + members of the current tenant only', async () => {
    expect(await visibleUserIds({ tenantId: tenantA, userId: u.A1 })).toEqual(
      [u.A1, u.A2, u.AB].sort(),
    );
  });

  it('a non-member acting in another tenant still sees only itself + that tenant’s members', async () => {
    expect(await visibleUserIds({ tenantId: tenantB, userId: u.A1 })).toEqual(
      [u.A1, u.B, u.AB].sort(),
    );
  });

  it('user-only context sees only itself; no context sees nobody', async () => {
    expect(await visibleUserIds({ userId: u.X })).toEqual([u.X]);
    expect(await visibleUserIds({ userId: u.AB })).toEqual([u.AB]);
    expect(await visibleUserIds({})).toEqual([]);
  });

  it('can update only itself — not co-members, not other tenants’ users', async () => {
    const touched = await as({ tenantId: tenantA, userId: u.A1 }, (tx) =>
      tx
        .update(users)
        .set({ name: 'hacked' })
        .where(inArray(users.id, [u.A2, u.AB, u.B, u.X]))
        .returning({ id: users.id }),
    );
    expect(touched).toEqual([]);
    const self = await as({ tenantId: tenantA, userId: u.A1 }, (tx) =>
      tx.update(users).set({ name: 'Me' }).where(eq(users.id, u.A1)).returning({ id: users.id }),
    );
    expect(self).toEqual([{ id: u.A1 }]);
  });

  it('cannot insert a user other than itself, or change its own id to someone else’s', async () => {
    await expect(
      as({ tenantId: tenantA, userId: u.A1 }, (tx) =>
        tx.insert(users).values({ id: randomUUID(), email: `${randomUUID()}@x.test`, name: 'N' }),
      ),
    ).rejects.toSatisfy((e) => pgCode(e) === DENIED);
    await expect(
      as({ userId: u.X }, (tx) =>
        tx.update(users).set({ id: randomUUID() }).where(eq(users.id, u.X)),
      ),
    ).rejects.toSatisfy((e) => pgCode(e) === DENIED);
  });

  it('cannot delete users at all', async () => {
    await expect(
      as({ userId: u.X }, (tx) => tx.delete(users).where(eq(users.id, u.X))),
    ).rejects.toSatisfy((e) => pgCode(e) === DENIED);
  });
});

describe.each([
  { name: 'sessions', table: sessions, rowOf: sessionOf },
  { name: 'auth_tokens', table: authTokens, rowOf: tokenOf },
] as const)('$name RLS', ({ table, rowOf }) => {
  it('a user sees only its own rows, in any tenant context', async () => {
    for (const ctx of [{ userId: u.A1 }, { tenantId: tenantA, userId: u.A1 }]) {
      const rows = await as(ctx, (tx) => tx.select({ userId: table.userId }).from(table));
      expect(rows).toEqual([{ userId: u.A1 }]);
    }
  });

  it('a co-member of the same tenant cannot read or update them; no context sees none', async () => {
    const seen = await as({ tenantId: tenantA, userId: u.A2 }, (tx) =>
      tx
        .select()
        .from(table)
        .where(eq(table.id, rowOf.A1 ?? '')),
    );
    expect(seen).toEqual([]);
    const touched = await as({ tenantId: tenantA, userId: u.A2 }, (tx) =>
      tx
        .update(table)
        .set({ expiresAt: new Date() })
        .where(eq(table.id, rowOf.A1 ?? ''))
        .returning({ id: table.id }),
    );
    expect(touched).toEqual([]);
    expect(await as({}, (tx) => tx.select().from(table))).toEqual([]);
  });

  it('cannot insert a row for another user', async () => {
    await expect(
      as({ userId: u.A2 }, (tx) =>
        tx.execute(
          sql`insert into ${table} (user_id, token_hash, expires_at${
            table === authTokens ? sql`, purpose` : sql``
          }) values (${u.A1}, ${hashLike()}, now() + interval '1 day'${
            table === authTokens ? sql`, 'email_verify'` : sql``
          })`,
        ),
      ),
    ).rejects.toSatisfy((e) => pgCode(e) === DENIED);
  });
});

describe('memberships/tenants in a user-only context (self_select)', () => {
  it('a user sees its own memberships across tenants, nobody else’s', async () => {
    const rows = await as({ userId: u.AB }, (tx) =>
      tx.select({ userId: memberships.userId, tenantId: memberships.tenantId }).from(memberships),
    );
    expect(rows.map((r) => r.userId)).toEqual([u.AB, u.AB]);
    expect(rows.map((r) => r.tenantId).sort()).toEqual([tenantA, tenantB].sort());
  });

  it('and only the tenants it belongs to', async () => {
    const rows = await as({ userId: u.AB }, (tx) => tx.select({ id: tenants.id }).from(tenants));
    expect(rows.map((r) => r.id).sort()).toEqual([tenantA, tenantB].sort());
    expect(rows.map((r) => r.id)).not.toContain(tenantC);
  });

  it('is read-only: cannot update or delete its memberships without a tenant context', async () => {
    const touched = await as({ userId: u.AB }, (tx) =>
      tx
        .update(memberships)
        .set({ role: 'owner' })
        .where(eq(memberships.userId, u.AB))
        .returning({ id: memberships.id }),
    );
    expect(touched).toEqual([]);
    const deleted = await as({ userId: u.AB }, (tx) =>
      tx.delete(memberships).where(eq(memberships.userId, u.AB)).returning({ id: memberships.id }),
    );
    expect(deleted).toEqual([]);
  });

  it('never widens a tenant context: with tenant A set, B memberships stay hidden', async () => {
    const rows = await as({ tenantId: tenantA, userId: u.AB }, (tx) =>
      tx.select({ tenantId: memberships.tenantId }).from(memberships),
    );
    expect(new Set(rows.map((r) => r.tenantId))).toEqual(new Set([tenantA]));
    const visibleTenants = await as({ tenantId: tenantA, userId: u.AB }, (tx) =>
      tx.select({ id: tenants.id }).from(tenants),
    );
    expect(visibleTenants).toEqual([{ id: tenantA }]);
  });
});

describe('hardening (migration 0004)', () => {
  it('password_hash is unreadable to app_user, even for the user itself', async () => {
    await expect(
      as({ userId: u.X }, (tx) =>
        tx.select({ hash: users.passwordHash }).from(users).where(eq(users.id, u.X)),
      ),
    ).rejects.toSatisfy((e) => pgCode(e) === DENIED);
  });

  it('a disabled membership (and its tenant) is hidden in a user-only context', async () => {
    await as({ tenantId: tenantB, userId: u.AB }, (tx) =>
      tx.update(memberships).set({ status: 'disabled' }).where(eq(memberships.userId, u.AB)),
    );
    try {
      const rows = await as({ userId: u.AB }, async (tx) => ({
        memberships: (await tx.select({ t: memberships.tenantId }).from(memberships)).map(
          (r) => r.t,
        ),
        tenants: (await tx.select({ id: tenants.id }).from(tenants)).map((r) => r.id),
      }));
      expect(rows).toEqual({ memberships: [tenantA], tenants: [tenantA] });
    } finally {
      await as({ tenantId: tenantB, userId: u.AB }, (tx) =>
        tx.update(memberships).set({ status: 'active' }).where(eq(memberships.userId, u.AB)),
      );
    }
  });
});
