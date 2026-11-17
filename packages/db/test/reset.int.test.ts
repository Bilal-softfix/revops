import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/migrate.js';
import { dropMigratedObjects } from '../src/reset.js';
import { loadTestDatabaseEnv } from '../src/testing/index.js';

// The reset machinery behind `pnpm db:reset:dev`, exercised on the TEST database (the dev guard
// itself is unit-tested): drop everything migrated, keep extensions, migrate again cleanly.
const { ownerUrl } = loadTestDatabaseEnv();
const owner = postgres(ownerUrl, { max: 1, onnotice: () => undefined });
afterAll(() => owner.end({ timeout: 5 }));

const count = async (query: string) =>
  Number((await owner.unsafe<{ n: string }[]>(query))[0]?.n ?? 0);

describe('dropMigratedObjects + runMigrations', () => {
  it('leaves an empty schema with extensions intact, then migrations rebuild everything', async () => {
    const tablesBefore = await count(
      `select count(*) n from pg_tables where schemaname = 'public'`,
    );
    expect(tablesBefore).toBeGreaterThan(10);

    await dropMigratedObjects(ownerUrl);
    expect(await count(`select count(*) n from pg_tables where schemaname = 'public'`)).toBe(0);
    expect(
      await count(`select count(*) n from pg_namespace where nspname in ('pgboss', 'drizzle')`),
    ).toBe(0);
    expect(
      await count(`select count(*) n from pg_type t join pg_namespace n on n.oid = t.typnamespace
                   where n.nspname = 'public' and t.typtype = 'e'`),
    ).toBe(0);
    // Extensions (citext, pg_trgm) survive: no superuser needed to migrate again.
    expect(
      await count(`select count(*) n from pg_extension where extname in ('citext', 'pg_trgm')`),
    ).toBe(2);

    await runMigrations(ownerUrl);
    expect(await count(`select count(*) n from pg_tables where schemaname = 'public'`)).toBe(
      tablesBefore,
    );
    expect(
      await count(`select count(*) n from pg_tables where schemaname = 'pgboss'`),
    ).toBeGreaterThan(0);
  });
});
