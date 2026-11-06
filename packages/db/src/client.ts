import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

export type Schema = typeof schema;
export type Db = PostgresJsDatabase<Schema>;
/** The transaction handle `withTenant` passes to its callback. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface DbHandle {
  db: Db;
  /** Underlying postgres.js pool, for raw SQL in tests and scripts. */
  sql: postgres.Sql;
  close: () => Promise<void>;
}

export interface CreateDbOptions {
  /** Pool size. Default 10. */
  max?: number;
}

/**
 * `DATABASE_URL` is Neon's PgBouncer endpoint in transaction mode: no named prepared statements
 * (`prepare: false`) and no session state — tenant context is transaction-local (see withTenant).
 */
export function createDb(url: string, options: CreateDbOptions = {}): DbHandle {
  const sql = postgres(url, {
    max: options.max ?? 10,
    prepare: false,
    connect_timeout: 15,
    onnotice: () => undefined,
  });
  return {
    db: drizzle(sql, { schema }),
    sql,
    close: () => sql.end({ timeout: 5 }),
  };
}
