import postgres from 'postgres';

/** Database name of a postgres URL (decoded), or '' if it has none. */
export function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.slice(1));
}

/**
 * `pnpm db:reset:dev` refuses anything that isn't plainly the local dev database: the name must
 * end in `_dev`, NODE_ENV must not be production, and it must not be the test database. Every URL
 * the reset will use (owner for DDL, app for the seed) must point at that same database.
 */
export function assertResettableDevDatabase(input: {
  urls: readonly string[];
  nodeEnv: string | undefined;
  testUrls?: readonly (string | undefined)[];
}): string {
  if (input.nodeEnv === 'production') {
    throw new Error('refusing to reset with NODE_ENV=production');
  }
  const names = new Set(input.urls.map(databaseName));
  if (names.size !== 1) {
    throw new Error(`the URLs point at different databases (${[...names].join(', ')})`);
  }
  const [name = ''] = [...names];
  if (!/_dev$/.test(name)) {
    throw new Error(`refusing to reset "${name}": only databases whose name ends in _dev`);
  }
  for (const testUrl of input.testUrls ?? []) {
    if (testUrl && databaseName(testUrl) === name) {
      throw new Error(`refusing to reset "${name}": it is also the test database`);
    }
  }
  return name;
}

/**
 * Drops every object the migrations created, as the owner: the `pgboss` and `drizzle` (migration
 * journal) schemas, and all tables, enum types and functions in `public` — except objects that
 * belong to extensions (citext, pg_trgm, vector), which stay installed, so no superuser is needed.
 * Run migrations afterwards to get an empty, current schema.
 */
export async function dropMigratedObjects(ownerUrl: string): Promise<void> {
  const sql = postgres(ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe('DROP SCHEMA IF EXISTS pgboss CASCADE');
      await tx.unsafe('DROP SCHEMA IF EXISTS drizzle CASCADE');
      const notExtension = (oid: string) =>
        `not exists (select 1 from pg_depend d where d.objid = ${oid} and d.deptype = 'e')`;
      const tables = await tx.unsafe<{ name: string }[]>(
        `select format('%I.%I', schemaname, tablename) as name from pg_tables
         where schemaname = 'public'`,
      );
      if (tables.length > 0) {
        await tx.unsafe(`DROP TABLE IF EXISTS ${tables.map((t) => t.name).join(', ')} CASCADE`);
      }
      const functions = await tx.unsafe<{ name: string }[]>(
        `select p.oid::regprocedure::text as name from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and ${notExtension('p.oid')}`,
      );
      for (const fn of functions) await tx.unsafe(`DROP FUNCTION IF EXISTS ${fn.name} CASCADE`);
      const types = await tx.unsafe<{ name: string }[]>(
        `select format('%I.%I', n.nspname, t.typname) as name from pg_type t
         join pg_namespace n on n.oid = t.typnamespace
         where n.nspname = 'public' and t.typtype = 'e' and ${notExtension('t.oid')}`,
      );
      if (types.length > 0) {
        await tx.unsafe(`DROP TYPE IF EXISTS ${types.map((t) => t.name).join(', ')} CASCADE`);
      }
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}
