import { verify } from '@node-rs/argon2';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/client.js';
import { memberships, users } from '../src/schema/index.js';
import { DEMO_TENANT_ID, DEMO_USERS, seedDemo } from '../src/seed.js';
import { loadTestDatabaseEnv } from '../src/testing/index.js';
import { withTenant } from '../src/with-tenant.js';

const { appUrl } = loadTestDatabaseEnv();
const app = createDb(appUrl, { max: 1 });
afterAll(() => app.close());

const PASSWORD = 'seed-password-for-tests';

describe('seedDemo (as app_user, through RLS)', () => {
  it('creates the demo tenant with owner/admin/manager/agent, and is idempotent', async () => {
    await seedDemo(app.db, PASSWORD);
    await seedDemo(app.db, PASSWORD);

    const rows = await withTenant(app.db, DEMO_TENANT_ID, (tx) =>
      tx
        .select({ email: users.email, role: memberships.role, status: memberships.status })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId)),
    );
    expect(rows.sort((x, y) => x.email.localeCompare(y.email))).toEqual(
      DEMO_USERS.map((u) => ({ email: u.email, role: u.role, status: 'active' })).sort((x, y) =>
        x.email.localeCompare(y.email),
      ),
    );
  });

  it('stores an argon2id hash of SEED_PASSWORD and marks users verified', async () => {
    // app_user can't select password_hash; login-style lookup goes through the definer function.
    const [owner] = await app.db.execute<{ password_hash: string; email_verified_at: unknown }>(
      sql`select * from auth_find_user_by_email('owner@demo.revops.test')`,
    );
    expect(owner?.password_hash).toMatch(/^\$argon2id\$/);
    expect(await verify(owner?.password_hash ?? '', PASSWORD)).toBe(true);
    expect(owner?.email_verified_at).not.toBeNull();
    // ...and the users row is visible to members of the demo tenant (users RLS).
    const visible = await withTenant(app.db, DEMO_TENANT_ID, (tx) =>
      tx
        .select({ email: users.email })
        .from(users)
        .where(eq(users.email, 'owner@demo.revops.test')),
    );
    expect(visible).toHaveLength(1);
  });
});
