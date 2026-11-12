import { describe, expect, it } from 'vitest';
import { csrfTokenFor, hashToken, newToken, safeEqual, tenantSlug } from './tokens';

describe('tokens', () => {
  it('newToken is 43 url-safe chars and unique', () => {
    const [a, b] = [newToken(), newToken()];
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it('hashToken is a stable sha256 hex digest that differs from the token', () => {
    const token = newToken();
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toContain(token);
  });

  it('csrfTokenFor is stable per session and different across sessions', () => {
    const [s1, s2] = [newToken(), newToken()];
    expect(csrfTokenFor(s1)).toBe(csrfTokenFor(s1));
    expect(csrfTokenFor(s1)).not.toBe(csrfTokenFor(s2));
    expect(csrfTokenFor(s1)).not.toBe(s1);
  });

  it('safeEqual compares exactly, including different lengths', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('tenantSlug', () => {
  it.each([
    ['Asha Realty', 'asha-realty-abc123'],
    ['  Café & Co. — Pune!! ', 'cafe-co-pune-abc123'],
    ['आशा रियल्टी', 'tenant-abc123'],
    ['x'.repeat(80), `${'x'.repeat(40)}-abc123`],
  ])('%j → %j', (name, slug) => {
    expect(tenantSlug(name, 'abc123')).toBe(slug);
  });
});
