import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Tx } from '../src/client.js';
import { USER_SETTING } from '../src/rls.js';
import { users } from '../src/schema/index.js';

/**
 * Inserts a user inside the current transaction. users only allows self-insert, so this switches
 * the transaction's app.user_id to the new user first (the tenant context is left as is).
 */
export async function insertUser(
  tx: Tx,
  values: Partial<typeof users.$inferInsert> = {},
): Promise<string> {
  const id = values.id ?? randomUUID();
  await tx.execute(sql`select set_config(${USER_SETTING}, ${id}, true)`);
  await tx.insert(users).values({ email: `${id}@test.local`, name: 'U', ...values, id });
  return id;
}
