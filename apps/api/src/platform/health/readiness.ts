import { Injectable } from '@nestjs/common';
import { sql } from '@revops/db';
import { Database } from '../database/database';
import { PGBOSS_SCHEMA } from '../queue/pg-boss-client';

export type CheckStatus = 'ok' | 'fail';
export interface ReadinessReport {
  ready: boolean;
  checks: { database: CheckStatus; queue: CheckStatus };
}

const TIMEOUT_MS = 2000;

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timed out')), TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * /ready: can this process do its job? Database reachable as app_user, and the pg-boss schema
 * usable (installed by migrations, readable by app_user). Liveness (/health) checks nothing.
 */
@Injectable()
export class Readiness {
  constructor(private readonly database: Database) {}

  async check(): Promise<ReadinessReport> {
    const probe = async (query: ReturnType<typeof sql>): Promise<CheckStatus> => {
      try {
        await withTimeout(this.database.db.execute(query));
        return 'ok';
      } catch {
        return 'fail';
      }
    };
    const [database, queue] = await Promise.all([
      probe(sql`select 1`),
      probe(sql`select version from ${sql.identifier(PGBOSS_SCHEMA)}.version limit 1`),
    ]);
    return { ready: database === 'ok' && queue === 'ok', checks: { database, queue } };
  }
}
