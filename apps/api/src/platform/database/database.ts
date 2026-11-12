import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { type Db, type DbContext, type DbHandle, type Tx, createDb, withContext } from '@revops/db';

/**
 * The app's pool (app_user over DATABASE_URL; on Neon, the pooled endpoint). Tenant/user-scoped work goes
 * through `withContext`; `db` is for the SECURITY DEFINER lookups that run before any context.
 */
@Injectable()
export class Database implements OnApplicationShutdown {
  private readonly handle: DbHandle;

  constructor(url: string) {
    this.handle = createDb(url);
  }

  get db(): Db {
    return this.handle.db;
  }

  withContext<T>(context: DbContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withContext(this.handle.db, context, fn);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.handle.close();
  }
}
