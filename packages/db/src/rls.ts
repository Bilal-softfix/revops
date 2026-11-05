// RLS policy generator for tenant-owned tables. Paste its output into a custom migration
// (`pnpm db:generate --custom --name=<table>_rls`) whenever you add a tenant table, and add the
// table to the leak suite (test/tenant-tables.ts) — the catalog meta-test fails until you do.

export const TENANT_SETTING = 'app.tenant_id';
export const APP_ROLE = 'app_user';

/** `''` after a transaction-local set_config ends on a pooled connection → NULL → no rows. */
export const CURRENT_TENANT_SQL = `nullif(current_setting('${TENANT_SETTING}', true), '')::uuid`;

const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

export interface TenantRlsOptions {
  table: string;
  /** Column holding the tenant id. `id` for the tenants table itself. Default `tenant_id`. */
  column?: string;
  /** DML granted to app_user. Default all four; append-only tables pass ['SELECT', 'INSERT']. */
  privileges?: readonly ('SELECT' | 'INSERT' | 'UPDATE' | 'DELETE')[];
}

export function tenantRlsSql(options: TenantRlsOptions): string {
  const { table, column = 'tenant_id' } = options;
  const privileges = options.privileges ?? ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];
  for (const name of [table, column]) {
    if (!IDENTIFIER.test(name)) throw new Error(`tenantRlsSql: invalid identifier "${name}"`);
  }
  const predicate = `"${column}" = ${CURRENT_TENANT_SQL}`;
  return [
    `ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`,
    // FORCE: the table owner (migrations, seed) is subject to the policy too.
    `ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY;`,
    `CREATE POLICY "tenant_isolation" ON "${table}" AS PERMISSIVE FOR ALL TO PUBLIC USING (${predicate}) WITH CHECK (${predicate});`,
    `REVOKE ALL ON "${table}" FROM "${APP_ROLE}";`,
    `GRANT ${privileges.join(', ')} ON "${table}" TO "${APP_ROLE}";`,
  ].join('\n--> statement-breakpoint\n');
}
