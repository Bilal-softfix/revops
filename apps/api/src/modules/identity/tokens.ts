import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** 32 random bytes → 43 base64url chars. Used for session cookies and emailed one-time links. */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Only this is stored: a DB leak doesn't yield usable session cookies or links. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * CSRF token derived from the (secret, httpOnly) session token: stable for the session's lifetime,
 * unforgeable without the cookie, nothing extra to store.
 */
export function csrfTokenFor(sessionToken: string): string {
  return createHmac('sha256', sessionToken).update('csrf.v1').digest('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** `Asha Realty` → `asha-realty-3f9a1c`. Falls back to `tenant-…` for non-Latin names. */
export function tenantSlug(name: string, suffix = randomBytes(3).toString('hex')): string {
  const base = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return `${base || 'tenant'}-${suffix}`;
}
