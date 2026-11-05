import { Injectable } from '@nestjs/common';
import type { Role } from '@revops/shared';
import { Clock } from '../../platform/clock';
import { Database } from '../../platform/database/database';
import { IdentityRepository } from './identity.repository';
import { csrfTokenFor, hashToken, newToken } from './tokens';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
/** Absolute lifetime: sign in again after 30 days regardless of activity. */
export const SESSION_MAX_AGE_MS = 30 * DAY;
/** Rolling idle timeout: a session unused for 7 days is dead. */
export const SESSION_IDLE_TIMEOUT_MS = 7 * DAY;
/** last_seen_at is written at most this often (keeps requests read-mostly). */
const TOUCH_INTERVAL_MS = 5 * MINUTE;

/**
 * `__Host-` prefix: browsers only accept it with Secure, Path=/ and no Domain, so a sibling
 * subdomain can't plant a session cookie for us (cookie tossing / login CSRF). Plain `sid` only
 * when COOKIE_SECURE=false, where the prefix would be rejected.
 */
export function sessionCookieName(secure: boolean): string {
  return secure ? '__Host-sid' : 'sid';
}

export interface AuthContext {
  sessionId: string;
  userId: string;
  /** The session's tenant — only while the user's membership there (and the tenant) is active. */
  tenantId: string | null;
  role: Role | null;
  csrfToken: string;
}

@Injectable()
export class SessionService {
  constructor(
    private readonly database: Database,
    private readonly repository: IdentityRepository,
    private readonly clock: Clock,
  ) {}

  /** Creates a session; the caller sets the returned token as the cookie. */
  async create(input: {
    userId: string;
    tenantId: string | null;
    ip: string | null;
    userAgent: string | null;
  }): Promise<{ token: string; sessionId: string; csrfToken: string }> {
    const token = newToken();
    const now = this.clock.now();
    const sessionId = await this.database.withContext({ userId: input.userId }, (tx) =>
      this.repository.insertSession(tx, {
        userId: input.userId,
        tokenHash: hashToken(token),
        activeTenantId: input.tenantId,
        ip: input.ip,
        userAgent: input.userAgent,
        now,
        expiresAt: new Date(now.getTime() + SESSION_MAX_AGE_MS),
      }),
    );
    return { token, sessionId, csrfToken: csrfTokenFor(token) };
  }

  /** Resolves a cookie token to a live session, or null (unknown, revoked, expired, idle). */
  async authenticate(token: string): Promise<AuthContext | null> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const session = await this.repository.findLiveSession(hashToken(token));
    if (!session) return null;

    const now = this.clock.now();
    const idleMs = now.getTime() - session.lastSeenAt.getTime();
    if (idleMs > SESSION_IDLE_TIMEOUT_MS) return null;

    const { userId, activeTenantId: tenantId } = session;
    // Re-checked on every request: a removed member or a suspended tenant loses access at once,
    // not when the session expires. One transaction with the (throttled) last_seen_at touch.
    const membership = await this.database.withContext({ tenantId, userId }, async (tx) => {
      if (idleMs > TOUCH_INTERVAL_MS)
        await this.repository.touchSession(tx, session.sessionId, now);
      return tenantId ? this.repository.getActiveMembership(tx, tenantId, userId) : undefined;
    });
    return {
      sessionId: session.sessionId,
      userId,
      tenantId: membership ? membership.id : null,
      role: membership ? membership.role : null,
      csrfToken: csrfTokenFor(token),
    };
  }

  async revoke(auth: Pick<AuthContext, 'sessionId' | 'userId'>): Promise<void> {
    await this.database.withContext({ userId: auth.userId }, (tx) =>
      this.repository.revokeSession(tx, auth.sessionId, this.clock.now()),
    );
  }
}
