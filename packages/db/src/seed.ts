import { randomUUID } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import type { Role } from '@revops/shared';
import { sql } from 'drizzle-orm';
import type { Db } from './client.js';
import { memberships, tenants, users } from './schema/index.js';
import { withContext } from './with-tenant.js';

/** Fixed id so reruns find the demo tenant without a cross-tenant lookup (RLS is forced). */
export const DEMO_TENANT_ID = '00000000-0000-4000-8000-00000000d3e0';
export const DEMO_TENANT_SLUG = 'demo';
export const DEMO_USERS: readonly { email: string; name: string; role: Role }[] = [
  { email: 'owner@demo.revops.test', name: 'Demo Owner', role: 'owner' },
  { email: 'admin@demo.revops.test', name: 'Demo Admin', role: 'admin' },
  { email: 'manager@demo.revops.test', name: 'Demo Manager', role: 'manager' },
  { email: 'agent@demo.revops.test', name: 'Demo Agent', role: 'agent' },
];

/**
 * Idempotent dev seed: one demo tenant + owner/admin/manager/agent (verified, active), all with
 * `password`. Reruns reset names, roles and passwords to the seed values. Runs as app_user through
 * RLS: each user row is written in that user's own context (users allow self-insert/update only).
 */
export async function seedDemo(db: Db, password: string): Promise<{ tenantId: string }> {
  const passwordHash = await hash(password); // argon2id by default
  await withContext(db, { tenantId: DEMO_TENANT_ID }, (tx) =>
    tx
      .insert(tenants)
      .values({ id: DEMO_TENANT_ID, name: 'Demo Realty', slug: DEMO_TENANT_SLUG })
      .onConflictDoNothing({ target: tenants.id }),
  );

  for (const user of DEMO_USERS) {
    const [existing] = await db.execute<{ id: string }>(
      sql`select id from auth_find_user_by_email(${user.email})`,
    );
    const userId = existing?.id ?? randomUUID();
    await withContext(db, { tenantId: DEMO_TENANT_ID, userId }, async (tx) => {
      await tx
        .insert(users)
        .values({ id: userId, ...user, passwordHash, emailVerifiedAt: new Date() })
        .onConflictDoUpdate({
          target: users.id,
          set: {
            name: user.name,
            passwordHash,
            emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, now())`,
          },
        });
      await tx
        .insert(memberships)
        .values({ tenantId: DEMO_TENANT_ID, userId, role: user.role, status: 'active' })
        .onConflictDoUpdate({
          target: [memberships.tenantId, memberships.userId],
          set: { role: user.role, status: 'active' },
        });
    });
  }
  return { tenantId: DEMO_TENANT_ID };
}
