import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  createParamDecorator,
} from '@nestjs/common';
import { CSRF_HEADER } from '@revops/shared';
import type { ApiEnv } from '@revops/shared/env';
import type { Request } from 'express';
import { csrfInvalid, unauthenticated } from './errors';
import { API_ENV } from '../../config/env';
import { type AuthContext, SessionService, sessionCookieName } from './session.service';
import { safeEqual } from './tokens';

type AuthedRequest = Request & { auth?: AuthContext };

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Requires a live session cookie; on unsafe methods also requires `x-csrf-token` to match the
 * session's CSRF token (synchronizer pattern, token derived from the session). SameSite=Lax blocks
 * most cross-site sends already; the token covers the rest (e.g. same-site subdomains).
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const cookies = req.cookies as Record<string, string | undefined> | undefined;
    const token = cookies?.[sessionCookieName(this.env.COOKIE_SECURE)];
    const auth = token ? await this.sessions.authenticate(token) : null;
    if (!auth) throw unauthenticated();

    if (!SAFE_METHODS.has(req.method)) {
      const header = req.header(CSRF_HEADER);
      if (!header || !safeEqual(header, auth.csrfToken)) throw csrfInvalid();
    }
    req.auth = auth;
    return true;
  }
}

/** The authenticated session, set by SessionGuard. */
export const CurrentAuth = createParamDecorator((_: unknown, context: ExecutionContext) => {
  const auth = context.switchToHttp().getRequest<AuthedRequest>().auth;
  if (!auth) throw unauthenticated();
  return auth;
});
