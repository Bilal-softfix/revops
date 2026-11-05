import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db, Tx } from './client.js';
import { TENANT_SETTING } from './rls.js';

const tenantIdSchema = z.uuid();

export class InvalidTenantIdError extends Error {
  constructor() {
    super('withTenant: tenantId must be a UUID');
    this.name = 'InvalidTenantIdError';
  }
}

/**
 * The only way to touch tenant-owned tables. Opens a transaction and sets `app.tenant_id` with
 * `set_config(..., is_local => true)` — the transaction-scoped form of `SET LOCAL`. It reverts at
 * COMMIT/ROLLBACK, so on a pooled connection (Neon PgBouncer, transaction mode) the next
 * transaction never inherits it. Never use a session-level `SET`: under PgBouncer the server
 * connection is shared with other clients and the value would leak to their transactions.
 */
export async function withTenant<T>(
  db: Db,
  tenantId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const parsed = tenantIdSchema.safeParse(tenantId);
  if (!parsed.success) throw new InvalidTenantIdError();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config(${TENANT_SETTING}, ${parsed.data}, true)`);
    return fn(tx);
  });
}
