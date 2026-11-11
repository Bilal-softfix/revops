import type { ApiEnv } from '@revops/shared/env';
import type { CookieOptions, Response } from 'express';
import { SESSION_MAX_AGE_MS, sessionCookieName } from './session.service';

const options = (env: ApiEnv): CookieOptions => ({
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: 'lax',
  path: '/',
});

/** Sets the session cookie (login, accepting an invitation as a new user). */
export function setSessionCookie(res: Response, env: ApiEnv, token: string): void {
  res.cookie(sessionCookieName(env.COOKIE_SECURE), token, {
    ...options(env),
    maxAge: SESSION_MAX_AGE_MS,
  });
}

export function clearSessionCookie(res: Response, env: ApiEnv): void {
  res.clearCookie(sessionCookieName(env.COOKIE_SECURE), options(env));
}
