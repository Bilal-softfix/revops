import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { sql } from '@revops/db';
import { Clock } from '../clock';
import { Database } from '../database/database';

/**
 * Fixed-window counters. `consume` counts and decides in one step, so concurrent requests can't
 * all slip through a check-then-increment gap.
 */
export abstract class RateLimiter {
  /**
   * Counts one attempt for `key`. Returns 0 if it is within `limit` for the current window (the
   * window of `windowMs` starts at the first attempt), else the seconds until the window ends.
   */
  abstract consume(key: string, limit: number, windowMs: number): Promise<number>;
  abstract reset(key: string): Promise<void>;
  /** Deletes ended windows (the worker runs this on a schedule). Returns how many were removed. */
  abstract purgeExpired(): Promise<number>;
}

/** Keys contain IPs and emails: only their sha256 reaches the database. */
export const rateLimitKeyHash = (key: string): string =>
  createHash('sha256').update(key, 'utf8').digest('hex');

/**
 * Shared across processes (ADR-011: Postgres, no Redis). Atomic in SQL: `rate_limit_consume` is a
 * single INSERT .. ON CONFLICT DO UPDATE (migration 0010). Windows use the app's Clock.
 */
@Injectable()
export class PostgresRateLimiter extends RateLimiter {
  constructor(
    private readonly database: Database,
    private readonly clock: Clock,
  ) {
    super();
  }

  async consume(key: string, limit: number, windowMs: number): Promise<number> {
    const [row] = await this.database.db.execute<{ retry_after: number }>(
      sql`select rate_limit_consume(${rateLimitKeyHash(key)}, ${limit}::int, ${windowMs}::int,
                                    ${this.clock.now().toISOString()}::timestamptz) as retry_after`,
    );
    return row?.retry_after ?? 0;
  }

  async reset(key: string): Promise<void> {
    await this.database.db.execute(sql`select rate_limit_reset(${rateLimitKeyHash(key)})`);
  }

  async purgeExpired(): Promise<number> {
    const [row] = await this.database.db.execute<{ n: number }>(
      sql`select rate_limit_purge(${this.clock.now().toISOString()}::timestamptz) as n`,
    );
    return row?.n ?? 0;
  }
}

/**
 * Single-process fake for unit tests (and the DB-less AppModule smoke test). Synchronous inside
 * `consume`, so it is atomic on the event loop.
 */
@Injectable()
export class InMemoryRateLimiter extends RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly clock: Clock) {
    super();
  }

  consume(key: string, limit: number, windowMs: number): Promise<number> {
    const now = this.clock.now().getTime();
    let window = this.windows.get(key);
    if (!window || window.resetAt <= now) {
      window = { count: 0, resetAt: now + windowMs };
      this.windows.set(key, window);
    }
    window.count += 1;
    return Promise.resolve(window.count <= limit ? 0 : Math.ceil((window.resetAt - now) / 1000));
  }

  reset(key: string): Promise<void> {
    this.windows.delete(key);
    return Promise.resolve();
  }

  purgeExpired(): Promise<number> {
    const now = this.clock.now().getTime();
    let removed = 0;
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now && this.windows.delete(key)) removed += 1;
    }
    return Promise.resolve(removed);
  }
}
