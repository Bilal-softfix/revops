import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { APP_ROLE, TENANT_SETTING, USER_SETTING } from '../src/rls.js';
import { loadTestDatabaseEnv } from '../src/testing/index.js';
import { TENANT_TABLES } from './tenant-tables.js';

// Meta-test on the migrated schema. Fails if any table in `public` lacks RLS, if a tenant table
// loses FORCE or its tenant_isolation policy (e.g. a migration drops it), if a new table isn't
// classified/registered in a leak suite, or if a SECURITY DEFINER function is added or loosened.
const { appUrl, ownerUrl } = loadTestDatabaseEnv();
const owner = postgres(ownerUrl, { max: 1, onnotice: () => undefined });
afterAll(() => owner.end({ timeout: 5 }));

/** Global, user-scoped tables: RLS ENABLED but not FORCED (SECURITY DEFINER lookups read them). */
const USER_TABLE_POLICIES: Record<string, string[]> = {
  auth_tokens: ['user_isolation:ALL'],
  sessions: ['user_isolation:ALL'],
  users: ['user_self_insert:INSERT', 'user_self_update:UPDATE', 'user_visibility:SELECT'],
};
/** System tables: RLS ENABLED, no policies, no app_user privileges (definer functions only). */
const SYSTEM_TABLES = ['rate_limit_buckets'];
/** Read-only extras on tenant tables for a user-only context (login tenant choice, switcher). */
const EXTRA_TENANT_POLICIES: Record<string, string[]> = {
  memberships: ['self_select:SELECT'],
  tenants: ['self_select:SELECT'],
};
/**
 * Policies bound to the OWNER role only (TO CURRENT_USER at migration time), so the SECURITY
 * DEFINER relay functions can read every tenant's unpublished events. Never apply to app_user.
 */
const OWNER_ONLY_POLICIES: Record<string, string[]> = {
  outbox_events: ['outbox_relay_select:SELECT', 'outbox_relay_update:UPDATE'],
};
/** SECURITY DEFINER functions → whether app_user may call them directly. */
const DEFINER_FUNCTIONS: Record<string, boolean> = {
  auth_discard_unverified_by_email: true,
  auth_discard_unverified_by_token: true,
  auth_discard_unverified_user: false, // internal: only via the wrappers above
  auth_cancel_signup: true,
  auth_find_user_by_email: true,
  auth_peek_verify_token: true,
  auth_purge_expired_unverified: true,
  auth_reset_password: true,
  auth_session_lookup: true,
  auth_verify_email: true,
  outbox_claim_batch: true,
  outbox_dead_letter: true,
  outbox_mark_published: true,
  rate_limit_consume: true,
  rate_limit_purge: true,
  rate_limit_reset: true,
};

interface TableRls {
  table: string;
  rls: boolean;
  force: boolean;
  tenantOwned: boolean;
  policies: {
    name: string;
    cmd: string;
    roles: string[];
    qual: string | null;
    withCheck: string | null;
  }[];
}

async function publicTables(): Promise<TableRls[]> {
  return owner<TableRls[]>`
    select c.relname::text as table,
           c.relrowsecurity as rls,
           c.relforcerowsecurity as force,
           (c.relname = 'tenants' or exists (
              select 1 from pg_attribute a
              where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped)) as "tenantOwned",
           coalesce((select json_agg(json_build_object(
                       'name', p.policyname, 'cmd', p.cmd, 'roles', p.roles,
                       'qual', p.qual, 'withCheck', p.with_check)
                       order by p.policyname)
                     from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname),
                    '[]') as policies
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    where c.relkind = 'r'
    order by 1`;
}

const policyKeys = (t: TableRls) => t.policies.map((p) => `${p.name}:${p.cmd}`).sort();

describe('RLS catalog meta-test', () => {
  it('every table in public is a registered tenant table, a known user table or a system table', async () => {
    const tables = await publicTables();
    expect(tables.filter((t) => t.tenantOwned).map((t) => t.table)).toEqual(
      TENANT_TABLES.map((f) => f.table).sort(),
    );
    expect(tables.filter((t) => !t.tenantOwned).map((t) => t.table)).toEqual(
      [...Object.keys(USER_TABLE_POLICIES), ...SYSTEM_TABLES].sort(),
    );
  });

  it('system tables: RLS ENABLED, no policies, and app_user has no privileges at all', async () => {
    const tables = (await publicTables()).filter((t) => SYSTEM_TABLES.includes(t.table));
    expect(
      tables.map((t) => ({ table: t.table, rls: t.rls, policies: t.policies.length })),
    ).toEqual(SYSTEM_TABLES.map((table) => ({ table, rls: true, policies: 0 })));
    const privs = await owner<{ table: string; any: boolean }[]>`
      select t as table,
             has_table_privilege(${APP_ROLE}, t, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE') as any
      from unnest(${SYSTEM_TABLES}::text[]) t order by 1`;
    expect(privs).toEqual(SYSTEM_TABLES.map((table) => ({ table, any: false })));
  });

  it('tenant tables: ENABLE + FORCE RLS, one tenant_isolation ALL policy (+ known read extras)', async () => {
    for (const t of (await publicTables()).filter((x) => x.tenantOwned)) {
      expect({ table: t.table, rls: t.rls, force: t.force }).toEqual({
        table: t.table,
        rls: true,
        force: true,
      });
      expect(policyKeys(t), t.table).toEqual(
        [
          'tenant_isolation:ALL',
          ...(EXTRA_TENANT_POLICIES[t.table] ?? []),
          ...(OWNER_ONLY_POLICIES[t.table] ?? []),
        ].sort(),
      );
      const isolation = t.policies.find((p) => p.name === 'tenant_isolation');
      for (const expr of [isolation?.qual, isolation?.withCheck]) {
        expect(expr, `${t.table} tenant_isolation`).toContain(
          `current_setting('${TENANT_SETTING}'`,
        );
      }
      // Extras are SELECT-only and require "no tenant set" — they never widen a tenant context.
      const ownerOnly = new Set(
        (OWNER_ONLY_POLICIES[t.table] ?? []).map((key) => key.split(':')[0]),
      );
      for (const extra of t.policies.filter(
        (p) => p.name !== 'tenant_isolation' && !ownerOnly.has(p.name),
      )) {
        expect(extra.qual, `${t.table}.${extra.name}`).toMatch(/IS NULL/);
        expect(extra.qual, `${t.table}.${extra.name}`).toContain(
          `current_setting('${USER_SETTING}'`,
        );
      }
    }
  });

  it('owner-only policies (outbox relay) are bound to the owner role alone — never app_user/PUBLIC', async () => {
    const [{ owner: ownerRole } = { owner: '' }] = await owner<{ owner: string }[]>`
      select current_user::text as owner`;
    expect(ownerRole).not.toBe(APP_ROLE);
    const tables = await publicTables();
    for (const [table, keys] of Object.entries(OWNER_ONLY_POLICIES)) {
      const policies = tables.find((t) => t.table === table)?.policies ?? [];
      for (const key of keys) {
        const policy = policies.find((p) => `${p.name}:${p.cmd}` === key);
        expect(policy?.roles, `${table} ${key}`).toEqual([ownerRole]);
      }
    }
  });

  it('user tables: RLS ENABLED (not forced) with exactly the expected policies on app.user_id', async () => {
    for (const t of (await publicTables()).filter(
      (x) => !x.tenantOwned && !SYSTEM_TABLES.includes(x.table),
    )) {
      expect({ table: t.table, rls: t.rls, force: t.force }).toEqual({
        table: t.table,
        rls: true,
        force: false,
      });
      expect(policyKeys(t), t.table).toEqual(USER_TABLE_POLICIES[t.table]);
      for (const p of t.policies) {
        expect(`${p.qual ?? ''} ${p.withCheck ?? ''}`, `${t.table}.${p.name}`).toContain(
          `current_setting('${USER_SETTING}'`,
        );
      }
    }
  });

  it('SECURITY DEFINER functions: only the known ones, fixed search_path, EXECUTE only as intended', async () => {
    const fns = await owner<
      { name: string; config: string[] | null; publicExec: boolean; appExec: boolean }[]
    >`
      select p.proname::text as name, p.proconfig as config,
             has_function_privilege('public', p.oid, 'EXECUTE') as "publicExec",
             has_function_privilege(${APP_ROLE}, p.oid, 'EXECUTE') as "appExec"
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef
      order by 1`;
    expect(fns.map((f) => f.name)).toEqual(Object.keys(DEFINER_FUNCTIONS).sort());
    for (const f of fns) {
      expect(f.config, f.name).toEqual(['search_path=pg_catalog, public, pg_temp']);
      expect({ name: f.name, publicExec: f.publicExec, appExec: f.appExec }).toEqual({
        name: f.name,
        publicExec: false,
        appExec: DEFINER_FUNCTIONS[f.name],
      });
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

  it('append-only / no-delete grants for the app role', async () => {
    const rows = await owner<{ table: string; update: boolean; delete: boolean }[]>`
      select t as table,
             has_table_privilege(${APP_ROLE}, t, 'UPDATE') as update,
             has_table_privilege(${APP_ROLE}, t, 'DELETE') as delete
      from unnest(array['audit_logs', 'users', 'sessions', 'auth_tokens', 'tenants']) t
      order by 1`;
    expect(rows).toEqual([
      { table: 'audit_logs', update: false, delete: false },
      { table: 'auth_tokens', update: true, delete: false },
      { table: 'sessions', update: true, delete: false },
      { table: 'tenants', update: true, delete: false },
      // users: column-level only (below), so no table-wide UPDATE.
      { table: 'users', update: false, delete: false },
    ]);
  });

  it('users: app_user can never read password_hash, nor update id/email', async () => {
    const cols = await owner<{ col: string; read: boolean; write: boolean }[]>`
      select c as col,
             has_column_privilege(${APP_ROLE}, 'users', c, 'SELECT') as read,
             has_column_privilege(${APP_ROLE}, 'users', c, 'UPDATE') as write
      from unnest(array['id', 'email', 'name', 'password_hash', 'email_verified_at']) c
      order by 1`;
    expect(cols).toEqual([
      { col: 'email', read: true, write: false },
      { col: 'email_verified_at', read: true, write: true },
      { col: 'id', read: true, write: false },
      { col: 'name', read: true, write: true },
      { col: 'password_hash', read: false, write: true },
    ]);
  });
});
