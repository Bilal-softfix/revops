import { type SessionResponse, sessionResponseSchema } from '@revops/shared';
import { cookies, headers } from 'next/headers';
import { webEnv } from '@/lib/env';
import { toApiError } from './problem';

/**
 * Server Components only (uses next/headers): the current session from GET /v1/auth/me, with the
 * browser's cookie forwarded. null = signed out (no cookie, or the API says 401).
 */
export async function getSession(): Promise<SessionResponse | null> {
  const cookieHeader = (await cookies()).toString();
  if (!cookieHeader) return null;
  const forwardedFor = (await headers()).get('x-forwarded-for');
  const res = await fetch(new URL('/v1/auth/me', webEnv().API_INTERNAL_URL), {
    headers: {
      accept: 'application/json',
      cookie: cookieHeader,
      ...(forwardedFor ? { 'x-forwarded-for': forwardedFor } : {}),
    },
    cache: 'no-store',
  });
  if (res.status === 401) return null;
  if (!res.ok) throw await toApiError(res);
  return sessionResponseSchema.parse(await res.json());
}
