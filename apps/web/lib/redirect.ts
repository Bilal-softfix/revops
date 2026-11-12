const BASE = 'http://app.invalid';

/**
 * A post-login destination from `?next=`, only if it stays on this origin. The value is resolved
 * the way a browser would (which strips tabs/newlines and treats `\` like `/`), so `//evil`,
 * `/\evil`, `/%09/evil` and absolute URLs all fall back instead of becoming an open redirect.
 */
export function safeNext(value: string | string[] | undefined, fallback = '/dashboard'): string {
  const next = Array.isArray(value) ? value[0] : value;
  // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
  if (!next || !next.startsWith('/') || /[\u0000-\u001f\u007f\\]/.test(next)) return fallback;
  try {
    const url = new URL(next, BASE);
    return url.origin === BASE ? `${url.pathname}${url.search}${url.hash}` : fallback;
  } catch {
    return fallback;
  }
}

/** First value of a search param. */
export function param(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
