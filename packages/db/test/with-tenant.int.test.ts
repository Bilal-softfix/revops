import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Tx, createDb } from '../src/client.js';
import { TENANT_SETTING } from '../src/rls.js';
import { memberships } from '../src/schema/index.js';
import { loadTestDatabaseEnv } from '../src/testing/index.js';
import { withTenant } from '../src/with-tenant.js';
import { createTenant } from './tenant-tables.js';
import { insertUser } from './users.js';

// DATABASE_URL_TEST is Neon's pooled endpoint (PgBouncer, transaction mode) like DATABASE_URL.
// withTenant must use a transaction-local set_config so the tenant context never survives into the
// next transaction on the same pooled connection.
const { appUrl } = loadTestDatabaseEnv();
/** One connection: every query below provably reuses the same client connection. */
const single = createDb(appUrl, { max: 1 });
afterAll(() => single.close());

const currentSetting = async (tx: Pick<Tx, 'execute'>): Promise<string | null> => {
  const [row] = await tx.execute<{ value: string | null }>(
    sql`select nullif(current_setting(${TENANT_SETTING}, true), '') as value`,
  );
  return row?.value ?? null;
};

const visibleMemberships = (tx: Pick<Tx, 'select'>) =>
  tx.select({ tenantId: memberships.tenantId }).from(memberships);

let tenantA: string;
let tenantB: string;

beforeAll(async () => {
  [tenantA, tenantB] = [await createTenant(single.db, 'A'), await createTenant(single.db, 'B')];
  for (const tenantId of [tenantA, tenantB]) {
    await withTenant(single.db, tenantId, async (tx) => {
      const userId = await insertUser(tx);
      await tx.insert(memberships).values({ tenantId, userId, role: 'agent' });
    });
  }
});

describe('withTenant on a pooled connection', () => {
  it('sets app.tenant_id inside the transaction only', async () => {
    expect(await withTenant(single.db, tenantA, currentSetting)).toBe(tenantA);
    expect(await currentSetting(single.db)).toBeNull();
  });

  it('does not leak tenant context into the next transaction on the same pool', async () => {
    const seenInA = await withTenant(single.db, tenantA, visibleMemberships);
    expect(seenInA.map((r) => r.tenantId)).toEqual([tenantA]);

    // Next transaction on the same connection, without withTenant: no context, no rows.
    const after = await single.db.transaction(async (tx) => ({
      setting: await currentSetting(tx),
      rows: await visibleMemberships(tx),
    }));
    expect(after).toEqual({ setting: null, rows: [] });

    // And the next tenant sees only its own rows, never A's.
    const seenInB = await withTenant(single.db, tenantB, visibleMemberships);
    expect(seenInB.map((r) => r.tenantId)).toEqual([tenantB]);
  });

  it('does not leak context after a rolled-back transaction', async () => {
    await expect(
      withTenant(single.db, tenantA, () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
    expect(await currentSetting(single.db)).toBeNull();
    expect(await visibleMemberships(single.db)).toEqual([]);
  });

  it('keeps concurrent transactions on a shared pool isolated', async () => {
    const pool = createDb(appUrl, { max: 3 });
    try {
      const runs = Array.from({ length: 12 }, (_, i) => (i % 2 === 0 ? tenantA : tenantB));
      const results = await Promise.all(
        runs.map((tenantId) =>
          withTenant(pool.db, tenantId, async (tx) => ({
            tenantId,
            setting: await currentSetting(tx),
            rows: (await visibleMemberships(tx)).map((r) => r.tenantId),
          })),
        ),
      );
      for (const r of results) expect(r).toEqual({ ...r, setting: r.tenantId, rows: [r.tenantId] });
    } finally {
      await pool.close();
    }
  });

  it('nested queries see only the current tenant (filtering by another id returns nothing)', async () => {
    const rows = await withTenant(single.db, tenantA, (tx) =>
      tx.select().from(memberships).where(eq(memberships.tenantId, tenantB)),
    );
    expect(rows).toEqual([]);
  });
});
