import { type SQL, sql } from 'drizzle-orm';
import type { Db, Tx } from '../src/client.js';
import { withTenant } from '../src/with-tenant.js';

type Privilege = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';

export interface TenantTableFixture {
  table: string;
  /** Column the RLS policy compares with app.tenant_id (`id` for tenants). */
  tenantColumn: string;
  /** Column that identifies a row. Default `id`; processed_events uses `event_id`. */
  idColumn?: string;
  /** What app_user is granted; UPDATE/DELETE outside this must fail with a privilege error. */
  privileges: readonly Privilege[];
  /** Inserts one row for `tenantId` (inside the current tx) and returns its id. */
  insert: (tx: Tx, tenantId: string) => Promise<string>;
}

export interface OwnedRow {
  tenantId: string;
  rowId: string;
}

const INSUFFICIENT_PRIVILEGE = '42501'; // also the code for "new row violates row-level security"

function pgCode(error: unknown): string | undefined {
  const e = error as { code?: unknown; cause?: { code?: unknown } };
  const code = e.code ?? e.cause?.code;
  return typeof code === 'string' ? code : undefined;
}

async function rowCount(tx: Tx, query: SQL): Promise<number> {
  const result = await tx.execute(query);
  return result.count;
}

/**
 * Runs every cross-tenant probe from tenant A's context against tenant B's row and returns the
 * violations found (empty = isolated). Each probe runs in its own withTenant transaction, so an
 * expected error in one can't mask the others. Also checks A can still use its own row, so a
 * dropped policy (RLS on, no policy = deny all) is reported too, not just an open table.
 */
export async function findTenantLeaks(
  db: Db,
  fixture: TenantTableFixture,
  a: OwnedRow,
  b: OwnedRow,
): Promise<string[]> {
  const t = sql.identifier(fixture.table);
  const col = sql.identifier(fixture.tenantColumn);
  const idCol = sql.identifier(fixture.idColumn ?? 'id');
  const violations: string[] = [];
  const inA = <T>(fn: (tx: Tx) => Promise<T>) => withTenant(db, a.tenantId, fn);
  const can = (p: Privilege) => fixture.privileges.includes(p);

  /** Runs a probe that must fail with a privilege/RLS error; records a violation if it doesn't. */
  const mustBeDenied = async (label: string, fn: (tx: Tx) => Promise<unknown>) => {
    try {
      await inA(fn);
      violations.push(`${label} was allowed`);
    } catch (error) {
      if (pgCode(error) !== INSUFFICIENT_PRIVILEGE) throw error;
    }
  };

  const own = await inA((tx) => rowCount(tx, sql`select 1 from ${t} where ${idCol} = ${a.rowId}`));
  if (own !== 1) violations.push('own row is not visible');

  const foreign = await inA((tx) =>
    rowCount(tx, sql`select 1 from ${t} where ${idCol} = ${b.rowId}`),
  );
  if (foreign !== 0) violations.push('SELECT by id sees the other tenant’s row');

  const others = await inA((tx) =>
    rowCount(tx, sql`select 1 from ${t} where ${col} is distinct from ${a.tenantId}::uuid`),
  );
  if (others !== 0) violations.push(`SELECT * returns ${others} row(s) of other tenants`);

  if (can('UPDATE')) {
    const touched = await inA((tx) =>
      rowCount(tx, sql`update ${t} set ${col} = ${col} where ${idCol} = ${b.rowId}`),
    );
    if (touched !== 0) violations.push('UPDATE changed the other tenant’s row');
    const mine = await inA((tx) =>
      rowCount(tx, sql`update ${t} set ${col} = ${col} where ${idCol} = ${a.rowId}`),
    );
    if (mine !== 1) violations.push('own row is not updatable');
    await mustBeDenied('UPDATE moving own row to the other tenant', (tx) =>
      tx.execute(sql`update ${t} set ${col} = ${b.tenantId}::uuid where ${idCol} = ${a.rowId}`),
    );
  } else {
    await mustBeDenied('UPDATE without the privilege', (tx) =>
      tx.execute(sql`update ${t} set ${col} = ${col} where ${idCol} = ${b.rowId}`),
    );
  }

  if (can('DELETE')) {
    const deleted = await inA((tx) =>
      rowCount(tx, sql`delete from ${t} where ${idCol} = ${b.rowId}`),
    );
    if (deleted !== 0) violations.push('DELETE removed the other tenant’s row');
  } else {
    await mustBeDenied('DELETE without the privilege', (tx) =>
      tx.execute(sql`delete from ${t} where ${idCol} = ${b.rowId}`),
    );
  }

  await mustBeDenied('INSERT of a row for the other tenant', (tx) =>
    fixture.insert(tx, b.tenantId),
  );

  return violations;
}
