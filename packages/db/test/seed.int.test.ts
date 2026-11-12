import { verify } from '@node-rs/argon2';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/client.js';
import { memberships, users } from '../src/schema/index.js';
import { DEMO_TENANT_2_ID, DEMO_TENANT_ID, DEMO_TENANTS, seedDemo } from '../src/seed.js';
import { loadTestDatabaseEnv } from '../src/testing/index.js';
import { withContext, withTenant } from '../src/with-tenant.js';

const { appUrl } = loadTestDatabaseEnv();
const app = createDb(appUrl, { max: 1 });
afterAll(() => app.close());

const PASSWORD = 'seed-password-for-tests';
const byEmail = (x: { email: string }, y: { email: string }) => x.email.localeCompare(y.email);

async function membersOf(tenantId: string) {
  const rows = await withTenant(app.db, tenantId, (tx) =>
    tx
      .select({ email: users.email, role: memberships.role, status: memberships.status })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId)),
  );
  return rows.sort(byEmail);
}

describe('seedDemo (as app_user, through RLS)', () => {
  it('creates both demo tenants with their members, and is idempotent', async () => {
    await seedDemo(app.db, PASSWORD);
    await seedDemo(app.db, PASSWORD);

    for (const tenant of DEMO_TENANTS) {
      expect(await membersOf(tenant.id), tenant.slug).toEqual(
        tenant.members.map((m) => ({ ...m, status: 'active' })).sort(byEmail),
      );
    }
  });

  it('the first tenant has owner/admin/manager/agent; the second its own owner + agent', async () => {
    expect((await membersOf(DEMO_TENANT_ID)).map((m) => m.role).sort()).toEqual([
      'admin',
      'agent',
      'manager',
      'owner',
    ]);
    const second = await membersOf(DEMO_TENANT_2_ID);
    expect(second.find((m) => m.role === 'owner')?.email).toBe('owner2@demo.revops.test');
    expect(second.find((m) => m.role === 'agent')?.email).toBe('agent2@demo.revops.test');
  });

  it('manager@demo.revops.test is one user with an active membership in both tenants', async () => {
    const [manager] = await app.db.execute<{ id: string }>(
      sql`select id from auth_find_user_by_email('manager@demo.revops.test')`,
    );
    // User-only context: the self_select policy lists the user's own active memberships.
    const mine = await withContext(app.db, { userId: manager?.id ?? '' }, (tx) =>
      tx
        .select({ tenantId: memberships.tenantId, role: memberships.role })
        .from(memberships)
        .where(eq(memberships.userId, manager?.id ?? '')),
    );
    expect(mine.map((m) => m.tenantId).sort()).toEqual([DEMO_TENANT_ID, DEMO_TENANT_2_ID].sort());
    expect(mine.every((m) => m.role === 'manager')).toBe(true);
  });

  it('stores an argon2id hash of SEED_PASSWORD and marks users verified', async () => {
    // app_user can't select password_hash; login-style lookup goes through the definer function.
    const [owner] = await app.db.execute<{ password_hash: string; email_verified_at: unknown }>(
      sql`select * from auth_find_user_by_email('owner2@demo.revops.test')`,
    );
    expect(owner?.password_hash).toMatch(/^\$argon2id\$/);
    expect(await verify(owner?.password_hash ?? '', PASSWORD)).toBe(true);
    expect(owner?.email_verified_at).not.toBeNull();
    // ...and visible only to members of its own tenant (users RLS).
    const visibleIn = (tenantId: string) =>
      withTenant(app.db, tenantId, (tx) =>
        tx
          .select({ email: users.email })
          .from(users)
          .where(eq(users.email, 'owner2@demo.revops.test')),
      );
    expect(await visibleIn(DEMO_TENANT_2_ID)).toHaveLength(1);
    expect(await visibleIn(DEMO_TENANT_ID)).toHaveLength(0);
  });
});
