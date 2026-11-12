import { loadTestDatabaseEnv } from '@revops/db/testing';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { FakeClock } from '../src/platform/clock';
import { Database } from '../src/platform/database/database';
import { PostgresRateLimiter, rateLimitKeyHash } from '../src/platform/rate-limit/rate-limiter';

// ADR-011: the Postgres-backed limiter must behave exactly like the in-memory one it replaced.
const { appUrl, ownerUrl } = loadTestDatabaseEnv();
const database = new Database(appUrl);
const owner = postgres(ownerUrl, { max: 1, onnotice: () => undefined });
afterAll(async () => {
  await database.onApplicationShutdown();
  await owner.end({ timeout: 5 });
});

const WINDOW = 15 * 60_000;
let n = 0;
const key = () => `test-key:${++n}:${Date.now()}`;

describe('PostgresRateLimiter', () => {
  it('allows `limit` attempts, then reports seconds until the window ends', async () => {
    const clock = new FakeClock(new Date());
    const limiter = new PostgresRateLimiter(database, clock);
    const k = key();
    for (let i = 0; i < 5; i++) expect(await limiter.consume(k, 5, WINDOW)).toBe(0);
    expect(await limiter.consume(k, 5, WINDOW)).toBe(900);
    clock.advance(10 * 60_000);
    expect(await limiter.consume(k, 5, WINDOW)).toBe(300);
  });

  it('is atomic across connections: a concurrent burst gets exactly `limit` allowances', async () => {
    const limiter = new PostgresRateLimiter(database, new FakeClock(new Date()));
    const k = key();
    const results = await Promise.all(
      Array.from({ length: 30 }, () => limiter.consume(k, 5, WINDOW)),
    );
    expect(results.filter((r) => r === 0)).toHaveLength(5);
  });

  it('starts a fresh window once the old one has passed, and reset clears one key', async () => {
    const clock = new FakeClock(new Date());
    const limiter = new PostgresRateLimiter(database, clock);
    const [a, b] = [key(), key()];
    for (let i = 0; i < 2; i++) {
      await limiter.consume(a, 1, WINDOW);
      await limiter.consume(b, 1, WINDOW);
    }
    await limiter.reset(a);
    expect(await limiter.consume(a, 1, WINDOW)).toBe(0);
    expect(await limiter.consume(b, 1, WINDOW)).toBeGreaterThan(0);
    clock.advance(WINDOW);
    expect(await limiter.consume(b, 1, WINDOW)).toBe(0);
  });

  it('stores only a sha256 of the key (no IPs/emails) and purges ended windows', async () => {
    const clock = new FakeClock(new Date());
    const limiter = new PostgresRateLimiter(database, clock);
    const k = `login:203.0.113.9:someone-${Date.now()}@example.test`;
    await limiter.consume(k, 5, WINDOW);
    const rows = await owner<{ key_hash: string }[]>`
      select key_hash from rate_limit_buckets where key_hash = ${rateLimitKeyHash(k)}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.key_hash).toMatch(/^[0-9a-f]{64}$/);
    const [leak] = await owner`
      select 1 from rate_limit_buckets where key_hash like '%203.0.113.9%' or key_hash like '%@%'`;
    expect(leak).toBeUndefined();

    clock.advance(WINDOW + 1000);
    expect(await limiter.purgeExpired()).toBeGreaterThanOrEqual(1);
    const after =
      await owner`select 1 from rate_limit_buckets where key_hash = ${rateLimitKeyHash(k)}`;
    expect(after).toHaveLength(0);
  });

  it('app_user cannot touch the table directly — only through the functions', async () => {
    const app = postgres(appUrl, { max: 1, prepare: false, onnotice: () => undefined });
    try {
      await expect(app`select * from rate_limit_buckets`).rejects.toMatchObject({
        code: '42501',
      });
      await expect(
        app`insert into rate_limit_buckets (key_hash, count, reset_at) values ('x', 0, now())`,
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        app`select rate_limit_consume('not-a-hash', 5, 1000, now())`,
      ).rejects.toMatchObject({ code: '22023' });
    } finally {
      await app.end({ timeout: 5 });
    }
  });
});
