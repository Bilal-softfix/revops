import { describe, expect, it } from 'vitest';
import { FakeClock } from '../clock';
import { InMemoryRateLimiter } from './rate-limiter';

const WINDOW = 15 * 60_000;

describe('InMemoryRateLimiter (fixed window, count-then-decide)', () => {
  it('allows `limit` attempts, then reports seconds until the window ends', async () => {
    const clock = new FakeClock();
    const limiter = new InMemoryRateLimiter(clock);
    for (let i = 0; i < 5; i++) expect(await limiter.consume('k', 5, WINDOW)).toBe(0);
    expect(await limiter.consume('k', 5, WINDOW)).toBe(900);
    clock.advance(10 * 60_000);
    expect(await limiter.consume('k', 5, WINDOW)).toBe(300);
  });

  it('is atomic: a concurrent burst gets exactly `limit` allowances', async () => {
    const limiter = new InMemoryRateLimiter(new FakeClock());
    const results = await Promise.all(
      Array.from({ length: 50 }, () => limiter.consume('k', 5, WINDOW)),
    );
    expect(results.filter((r) => r === 0)).toHaveLength(5);
  });

  it('starts a fresh window once the old one has passed', async () => {
    const clock = new FakeClock();
    const limiter = new InMemoryRateLimiter(clock);
    for (let i = 0; i < 6; i++) await limiter.consume('k', 5, WINDOW);
    clock.advance(WINDOW);
    expect(await limiter.consume('k', 5, WINDOW)).toBe(0);
  });

  it('keys are independent and reset clears one key', async () => {
    const limiter = new InMemoryRateLimiter(new FakeClock());
    await limiter.consume('a', 1, WINDOW);
    await limiter.consume('b', 1, WINDOW);
    await limiter.reset('a');
    expect(await limiter.consume('a', 1, WINDOW)).toBe(0);
    expect(await limiter.consume('b', 1, WINDOW)).toBeGreaterThan(0);
  });
});
