import { verify } from '@node-rs/argon2';
import { eq } from 'drizzle-orm';
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
    const [owner] = await app.db.select().from(users).limit(1);
    expect(owner?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(await verify(owner?.passwordHash ?? '', PASSWORD)).toBe(true);
    expect(owner?.emailVerifiedAt).toBeInstanceOf(Date);
  });
});
