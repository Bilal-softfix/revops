import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/client.js';
import { tenantRlsSql } from '../src/rls.js';
import { loadTestDatabaseEnv } from '../src/testing/index.js';
import { type OwnedRow, type TenantTableFixture, findTenantLeaks } from './leak-check.js';
import { createTenant } from './tenant-tables.js';

// Meta-test for the leak test itself (AC: the test must FAIL if the RLS policy is dropped).
// A throwaway probe table gets the exact SQL tenantRlsSql generates for real tables; the same
// checker the leak suite uses must pass it, then report violations once the policy is dropped
// and once RLS is disabled.
const PROBE = 'rls_meta_probe';
const { appUrl, ownerUrl } = loadTestDatabaseEnv();
const owner = postgres(ownerUrl, { max: 1, onnotice: () => undefined });
const app = createDb(appUrl, { max: 2 });

const probe: TenantTableFixture = {
  table: PROBE,
  tenantColumn: 'tenant_id',
  privileges: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  insert: async (tx, tenantId) => {
    const rows = await tx.execute<{ id: string }>(
      sql`insert into ${sql.identifier(PROBE)} (tenant_id) values (${tenantId}) returning id`,
    );
    return rows[0]?.id ?? '';
  },
};

let a: OwnedRow;
let b: OwnedRow;

/**
 * Fresh probe rows (earlier scenarios may have moved/deleted them while the table was open).
 * FORCE RLS applies to the owner too, so lift it just for this insert and put it back.
 */
async function resetRows(): Promise<void> {
  await owner.begin(async (tx) => {
    const [state] = await tx<{ force: boolean }[]>`
      select relforcerowsecurity as force from pg_class where relname = ${PROBE}`;
    await tx.unsafe(`ALTER TABLE ${PROBE} NO FORCE ROW LEVEL SECURITY`);
    await tx.unsafe(`TRUNCATE ${PROBE}`);
    const ids = await tx<{ id: string }[]>`
      insert into ${tx(PROBE)} (tenant_id) values (${a.tenantId}), (${b.tenantId}) returning id`;
    if (state?.force) await tx.unsafe(`ALTER TABLE ${PROBE} FORCE ROW LEVEL SECURITY`);
    a = { ...a, rowId: ids[0]?.id ?? '' };
    b = { ...b, rowId: ids[1]?.id ?? '' };
  });
}

beforeAll(async () => {
  await owner.unsafe(`DROP TABLE IF EXISTS ${PROBE}`);
  await owner.unsafe(
    `CREATE TABLE ${PROBE} (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL)`,
  );
  await owner.unsafe(tenantRlsSql({ table: PROBE }).replaceAll('--> statement-breakpoint', ''));
  a = { tenantId: await createTenant(app.db, 'A'), rowId: '' };
  b = { tenantId: await createTenant(app.db, 'B'), rowId: '' };
});

afterAll(async () => {
  await owner.unsafe(`DROP TABLE IF EXISTS ${PROBE}`);
  await Promise.all([owner.end({ timeout: 5 }), app.close()]);
});

describe('leak test meta-test', () => {
  it('passes a table protected by the generated RLS SQL', async () => {
    await resetRows();
    expect(await findTenantLeaks(app.db, probe, a, b)).toEqual([]);
  });

  it('FAILS when the policy is dropped (RLS on, no policy)', async () => {
    await owner.unsafe(`DROP POLICY tenant_isolation ON ${PROBE}`);
    await resetRows();
    const violations = await findTenantLeaks(app.db, probe, a, b);
    expect(violations).toContain('own row is not visible');
  });

  it('FAILS with cross-tenant leaks when RLS is disabled', async () => {
    await owner.unsafe(`ALTER TABLE ${PROBE} DISABLE ROW LEVEL SECURITY`);
    await resetRows();
    const violations = await findTenantLeaks(app.db, probe, a, b);
    expect(violations).toEqual(
      expect.arrayContaining([
        'SELECT by id sees the other tenant’s row',
        'UPDATE changed the other tenant’s row',
        'INSERT of a row for the other tenant was allowed',
      ]),
    );
  });
});
