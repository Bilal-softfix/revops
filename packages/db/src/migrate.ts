import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

/** `migrations/` sits next to both `src/` and `dist/`. */
export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));

/**
 * Applies pending migrations. Must use an *_OWNER URL on the DIRECT endpoint: migrations run DDL as
 * the table owner, and session-level work (advisory lock, multi-statement transactions) does not
 * belong on the PgBouncer pooler.
 */
export async function runMigrations(ownerUrl: string): Promise<void> {
  const sql = postgres(ownerUrl, { max: 1, connect_timeout: 15, onnotice: () => undefined });
  try {
    await migrate(drizzle(sql), { migrationsFolder: MIGRATIONS_DIR });
  } finally {
    await sql.end({ timeout: 5 });
  }
}
