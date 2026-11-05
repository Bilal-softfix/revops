import { Injectable } from '@nestjs/common';
import { Clock } from '../clock';

/**
 * Fixed-window counters. `consume` counts and decides in one step, so concurrent requests can't
 * all slip through a check-then-increment gap (the Redis version, M0-T6, uses INCR + PEXPIRE NX).
 */
export abstract class RateLimiter {
  /**
   * Counts one attempt for `key`. Returns 0 if it is within `limit` for the current window (the
   * window of `windowMs` starts at the first attempt), else the seconds until the window ends.
   */
  abstract consume(key: string, limit: number, windowMs: number): Promise<number>;
  abstract reset(key: string): Promise<void>;
}

/**
 * Single-process implementation for dev/tests until Redis is wired in M0-T6. Synchronous inside
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
}
