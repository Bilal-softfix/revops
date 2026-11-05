import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { APP_ROLE, TENANT_SETTING } from '../src/rls.js';
import { loadTestDatabaseEnv } from '../src/testing/index.js';
import { TENANT_TABLES } from './tenant-tables.js';

// Meta-test on the migrated schema: fails if any tenant table loses forced RLS or its policy
// (e.g. a migration drops it), or if a new tenant table isn't registered in the leak suite.
const { appUrl, ownerUrl } = loadTestDatabaseEnv();
const owner = postgres(ownerUrl, { max: 1, onnotice: () => undefined });
afterAll(() => owner.end({ timeout: 5 }));

interface TableRls {
  table: string;
  rls: boolean;
  force: boolean;
  policies: { cmd: string; qual: string | null; withCheck: string | null; roles: string[] }[];
}

async function tenantTablesInCatalog(): Promise<TableRls[]> {
  // A table is tenant-owned if it has a tenant_id column, plus `tenants` itself.
  return owner<TableRls[]>`
    select c.relname::text as table,
           c.relrowsecurity as rls,
           c.relforcerowsecurity as force,
           coalesce((select json_agg(json_build_object(
                       'cmd', p.cmd, 'qual', p.qual, 'withCheck', p.with_check, 'roles', p.roles))
                     from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname),
                    '[]') as policies
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    where c.relkind = 'r'
      and (c.relname = 'tenants' or exists (
        select 1 from pg_attribute a
        where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped))
    order by 1`;
}

describe('RLS catalog meta-test', () => {
  it('every tenant table is in the leak suite (and vice versa)', async () => {
    const inCatalog = (await tenantTablesInCatalog()).map((t) => t.table);
    expect(inCatalog).toEqual(TENANT_TABLES.map((f) => f.table).sort());
  });

  it('every tenant table has ENABLE + FORCE RLS and one tenant_isolation policy for ALL', async () => {
    for (const t of await tenantTablesInCatalog()) {
      expect({ table: t.table, rls: t.rls, force: t.force }).toEqual({
        table: t.table,
        rls: true,
        force: true,
      });
      expect(t.policies, `${t.table} policies`).toHaveLength(1);
      const [policy] = t.policies;
      expect(policy?.cmd, t.table).toBe('ALL');
      expect(policy?.roles, t.table).toEqual(['public']);
      for (const expr of [policy?.qual, policy?.withCheck]) {
        expect(expr, `${t.table} policy`).toContain(`current_setting('${TENANT_SETTING}'`);
      }
    }
  });

  it(`${APP_ROLE} can't bypass RLS: not superuser, no BYPASSRLS, owns no tables`, async () => {
    const app = postgres(appUrl, { max: 1, prepare: false });
    try {
      const [me] = await app<
        { role: string; superuser: boolean; bypass: boolean; owned: number }[]
      >`
        select current_user::text as role, rolsuper as superuser, rolbypassrls as bypass,
               (select count(*)::int from pg_tables where tableowner = current_user) as owned
        from pg_roles where rolname = current_user`;
      expect(me).toEqual({ role: APP_ROLE, superuser: false, bypass: false, owned: 0 });
    } finally {
      await app.end({ timeout: 5 });
    }
  });

  it('audit_logs is append-only for the app role', async () => {
    const [grants] = await owner<{ update: boolean; delete: boolean; insert: boolean }[]>`
      select has_table_privilege(${APP_ROLE}, 'audit_logs', 'UPDATE') as update,
             has_table_privilege(${APP_ROLE}, 'audit_logs', 'DELETE') as delete,
             has_table_privilege(${APP_ROLE}, 'audit_logs', 'INSERT') as insert`;
    expect(grants).toEqual({ update: false, delete: false, insert: true });
  });
});
