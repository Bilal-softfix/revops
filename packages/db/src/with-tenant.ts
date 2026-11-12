import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db, Tx } from './client.js';
import { TENANT_SETTING, USER_SETTING } from './rls.js';

const idSchema = z.uuid();

export class InvalidTenantIdError extends Error {
  constructor(field: 'tenantId' | 'userId' = 'tenantId') {
    super(`withContext: ${field} must be a UUID`);
    this.name = 'InvalidTenantIdError';
  }
}

export interface DbContext {
  /** Tenant whose rows tenant tables expose (app.tenant_id). */
  tenantId?: string | null;
  /** Acting user (app.user_id): sees itself, its sessions/tokens, and — with no tenant — its own memberships. */
  userId?: string | null;
}

function parseId(value: string | null | undefined, field: 'tenantId' | 'userId'): string {
  if (value === undefined || value === null) return '';
  const parsed = idSchema.safeParse(value);
  if (!parsed.success) throw new InvalidTenantIdError(field);
  return parsed.data;
}

/**
 * The only way to touch RLS-protected tables. Opens a transaction and sets `app.tenant_id` and
 * `app.user_id` with `set_config(..., is_local => true)` — the transaction-scoped form of
 * `SET LOCAL`. Both always get set (unset = ''), and both revert at COMMIT/ROLLBACK, so on a pooled
 * connection (Neon PgBouncer, transaction mode) the next transaction never inherits them. Never use
 * a session-level `SET`: under PgBouncer the server connection is shared with other clients and
 * the value would leak into their transactions.
 */
export async function withContext<T>(
  db: Db,
  context: DbContext,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const tenantId = parseId(context.tenantId, 'tenantId');
  const userId = parseId(context.userId, 'userId');
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config(${TENANT_SETTING}, ${tenantId}, true), set_config(${USER_SETTING}, ${userId}, true)`,
    );
    return fn(tx);
  });
}

/** `withContext` for tenant-only work. */
export function withTenant<T>(db: Db, tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withContext(db, { tenantId }, fn);
}
