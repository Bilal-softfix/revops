import { describe, expect, it } from 'vitest';
import { CURRENT_TENANT_SQL, tenantRlsSql } from './rls.js';

describe('tenantRlsSql', () => {
  it('enables + forces RLS, adds one ALL policy (USING + WITH CHECK) and grants app_user', () => {
    const statements = tenantRlsSql({ table: 'leads' }).split('\n--> statement-breakpoint\n');
    expect(statements).toEqual([
      'ALTER TABLE "leads" ENABLE ROW LEVEL SECURITY;',
      'ALTER TABLE "leads" FORCE ROW LEVEL SECURITY;',
      `CREATE POLICY "tenant_isolation" ON "leads" AS PERMISSIVE FOR ALL TO PUBLIC USING ("tenant_id" = ${CURRENT_TENANT_SQL}) WITH CHECK ("tenant_id" = ${CURRENT_TENANT_SQL});`,
      'REVOKE ALL ON "leads" FROM "app_user";',
      'GRANT SELECT, INSERT, UPDATE, DELETE ON "leads" TO "app_user";',
    ]);
  });

  it('supports a custom tenant column and restricted privileges', () => {
    const out = tenantRlsSql({ table: 'tenants', column: 'id', privileges: ['SELECT'] });
    expect(out).toContain(`USING ("id" = ${CURRENT_TENANT_SQL})`);
    expect(out).toContain('GRANT SELECT ON "tenants" TO "app_user";');
  });

  it('treats an empty (reset) setting as no tenant rather than a cast error', () => {
    expect(CURRENT_TENANT_SQL).toBe("nullif(current_setting('app.tenant_id', true), '')::uuid");
  });

  it.each(['Leads', 'a-b', 'x"; drop table t; --', ''])('rejects identifier %j', (table) => {
    expect(() => tenantRlsSql({ table })).toThrow(/invalid identifier/);
  });
});
