import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/client.js';
import { loadTestDatabaseEnv } from '../src/testing/index.js';
import { withTenant } from '../src/with-tenant.js';
import { type OwnedRow, findTenantLeaks } from './leak-check.js';
import { TENANT_TABLES, createTenant } from './tenant-tables.js';

// AC (M0-T3): in tenant A's context, tenant B's rows can't be read, updated, deleted, or written —
// for every tenant table, as app_user over the same connection type the app uses.
const { appUrl } = loadTestDatabaseEnv();
const app = createDb(appUrl, { max: 2 });
afterAll(() => app.close());

describe.each(TENANT_TABLES)('tenant isolation: $table', (fixture) => {
  let a: OwnedRow;
  let b: OwnedRow;

  beforeAll(async () => {
    const [tenantA, tenantB] = [await createTenant(app.db, 'A'), await createTenant(app.db, 'B')];
    const own = async (tenantId: string): Promise<OwnedRow> => ({
      tenantId,
      // The tenant row itself is the "row" for the tenants table.
      rowId:
        fixture.table === 'tenants'
          ? tenantId
          : await withTenant(app.db, tenantId, (tx) => fixture.insert(tx, tenantId)),
    });
    [a, b] = [await own(tenantA), await own(tenantB)];
  });

  it('tenant A cannot read, update, delete or insert tenant B rows', async () => {
    expect(await findTenantLeaks(app.db, fixture, a, b)).toEqual([]);
  });

  it('and the same holds the other way round', async () => {
    expect(await findTenantLeaks(app.db, fixture, b, a)).toEqual([]);
  });
});
