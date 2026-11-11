/**
 * A post-login destination from `?next=`, only if it is a same-origin path. Anything else
 * (`https://evil`, `//evil`, `/\evil`, missing) falls back, so the param can't be an open redirect.
 */
export function safeNext(value: string | string[] | undefined, fallback = '/dashboard'): string {
  const next = Array.isArray(value) ? value[0] : value;
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) {
    return fallback;
  }
  return next;
}

/** First value of a search param. */
export function param(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
