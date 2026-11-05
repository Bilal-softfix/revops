import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type EmailOnlyRequest,
  type LoginRequest,
  type ResetPasswordRequest,
  type SessionResponse,
  type SignupRequest,
  type SignupResponse,
  USER_SIGNED_UP_V1,
  type UserSignedUpV1,
  type VerifyEmailRequest,
} from '@revops/shared';
import type { ApiEnv } from '@revops/shared/env';
import { API_ENV } from '../../config/env';
import { Clock } from '../../platform/clock';
import { Database } from '../../platform/database/database';
import { RateLimiter } from '../../platform/rate-limit/rate-limiter';
import { type EmailMessage, EmailProvider, maskEmail } from '../../providers/email';
import { resetPasswordMessage, verifyEmailMessage } from './emails';
import {
  emailNotVerified,
  emailTaken,
  invalidCredentials,
  invalidToken,
  rateLimited,
  unauthenticated,
} from './errors';
import { IdentityRepository } from './identity.repository';
import { PasswordService } from './password.service';
import { type AuthContext, SessionService } from './session.service';
import { hashToken, newToken, tenantSlug } from './tokens';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const EMAIL_VERIFY_TTL_MS = 24 * HOUR;
const PASSWORD_RESET_TTL_MS = HOUR;
/**
 * Login: 5 attempts per (IP, email) per 15 minutes, then 429 until the window ends. An attempt is
 * reserved before the password is checked (so a concurrent burst can't exceed it) and the counter
 * is cleared on success.
 */
export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_WINDOW_MS = 15 * MINUTE;
/** Per-IP ceilings across all emails (credential stuffing, argon2 CPU, junk signups). */
export const LOGIN_PER_IP = 50;
export const SIGNUPS_PER_IP_PER_HOUR = 10;
/** Verification/reset emails per (IP, email) and per IP, per hour; extra requests are dropped silently. */
const EMAILS_PER_ADDRESS_PER_HOUR = 3;
const EMAILS_PER_IP_PER_HOUR = 20;
const SIGNUP_ATTEMPTS = 3; // retries on a (24-bit) tenant slug collision

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

/** The violated unique constraint's name, or undefined if `error` isn't a unique violation. */
function uniqueViolation(error: unknown): string | undefined {
  const e = error as { code?: unknown; constraint_name?: unknown; cause?: unknown };
  const pg = (e.code ? e : e.cause) as { code?: unknown; constraint_name?: unknown } | undefined;
  if (pg?.code !== '23505') return undefined;
  return typeof pg.constraint_name === 'string' ? pg.constraint_name : '';
}

@Injectable()
export class IdentityService {
  private readonly logger = new Logger('Identity');

  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly database: Database,
    private readonly repository: IdentityRepository,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly email: EmailProvider,
    private readonly rateLimiter: RateLimiter,
    private readonly clock: Clock,
  ) {}

  /**
   * One transaction: user + tenant + owner membership + audit log + `user.signed_up.v1` outbox event
   * + verification token. The email goes out after commit; no session until the email is verified.
   */
  async signup(input: SignupRequest, meta: RequestMeta): Promise<SignupResponse> {
    const retryAfter = await this.rateLimiter.consume(
      `signup-ip:${meta.ip ?? 'unknown'}`,
      SIGNUPS_PER_IP_PER_HOUR,
      HOUR,
    );
    if (retryAfter > 0) throw rateLimited(retryAfter);
    if (await this.repository.findUserByEmail(input.email)) throw emailTaken();

    const passwordHash = await this.passwords.hash(input.password);
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.createAccount(input, passwordHash, meta);
      } catch (error) {
        const constraint = uniqueViolation(error);
        if (constraint === 'users_email_unique') throw emailTaken(); // lost a concurrent-signup race
        if (constraint === 'tenants_slug_unique' && attempt < SIGNUP_ATTEMPTS) continue;
        throw error;
      }
    }
  }

  private async createAccount(
    input: SignupRequest,
    passwordHash: string,
    meta: RequestMeta,
  ): Promise<SignupResponse> {
    const userId = randomUUID();
    const tenantId = randomUUID();
    const slug = tenantSlug(input.tenantName);
    const verifyToken = newToken();
    const now = this.clock.now();

    await this.database.withContext({ tenantId, userId }, async (tx) => {
      await this.repository.insertUser(tx, {
        id: userId,
        email: input.email,
        name: input.name,
        passwordHash,
      });
      await this.repository.insertTenant(tx, { id: tenantId, name: input.tenantName, slug });
      await this.repository.insertMembership(tx, { tenantId, userId, role: 'owner' });
      await this.repository.insertAudit(tx, {
        tenantId,
        actorType: 'user',
        actorId: userId,
        action: 'user.signed_up',
        entity: 'tenant',
        entityId: tenantId,
        ip: meta.ip,
      });
      const payload: UserSignedUpV1 = { userId, tenantId };
      await this.repository.insertOutboxEvent(tx, {
        tenantId,
        type: USER_SIGNED_UP_V1,
        aggregateId: userId,
        payload,
      });
      await this.repository.insertAuthToken(tx, {
        userId,
        purpose: 'email_verify',
        tokenHash: hashToken(verifyToken),
        expiresAt: new Date(now.getTime() + EMAIL_VERIFY_TTL_MS),
      });
    });

    this.sendInBackground(verifyEmailMessage(input.email, this.env.APP_URL, verifyToken));
    return {
      user: { id: userId, email: input.email, name: input.name, emailVerified: false },
      tenant: { id: tenantId, name: input.tenantName, slug, role: 'owner' },
    };
  }

  async verifyEmail(input: VerifyEmailRequest): Promise<void> {
    const userId = await this.repository.consumeToken(hashToken(input.token), 'email_verify');
    if (!userId) throw invalidToken();
    await this.database.withContext({ userId }, (tx) =>
      this.repository.markEmailVerified(tx, userId, this.clock.now()),
    );
  }

  /** Always succeeds (202): never reveals whether an address has an account. */
  async resendVerification(input: EmailOnlyRequest, meta: RequestMeta): Promise<void> {
    if (!(await this.allowEmail('verify', input.email, meta))) return;
    const user = await this.repository.findUserByEmail(input.email);
    if (!user || user.emailVerifiedAt) return;
    const token = await this.issueToken(user.id, 'email_verify', EMAIL_VERIFY_TTL_MS);
    this.sendInBackground(verifyEmailMessage(input.email, this.env.APP_URL, token));
  }

  async login(
    input: LoginRequest,
    meta: RequestMeta,
  ): Promise<{ token: string; response: SessionResponse }> {
    const ip = meta.ip ?? 'unknown';
    const key = `login:${ip}:${input.email}`;
    // Reserve the attempt first (atomic), then verify: a parallel burst can't exceed the limit.
    const retryAfter = Math.max(
      await this.rateLimiter.consume(`login-ip:${ip}`, LOGIN_PER_IP, LOGIN_WINDOW_MS),
      await this.rateLimiter.consume(key, LOGIN_MAX_FAILURES, LOGIN_WINDOW_MS),
    );
    if (retryAfter > 0) throw rateLimited(retryAfter);

    const user = await this.repository.findUserByEmail(input.email);
    const ok = user?.passwordHash
      ? await this.passwords.verify(user.passwordHash, input.password)
      : await this.passwords.verifyDummy(input.password);
    if (!user || !ok) throw invalidCredentials();
    // Only after a correct password, so this doesn't reveal which accounts exist.
    if (!user.emailVerifiedAt) throw emailNotVerified();
    await this.rateLimiter.reset(key);

    const tenantId =
      (await this.database.withContext({ userId: user.id }, (tx) =>
        this.repository.firstActiveTenantId(tx, user.id),
      )) ?? null;
    const session = await this.sessions.create({ userId: user.id, tenantId, ...meta });
    if (tenantId) {
      await this.database.withContext({ tenantId, userId: user.id }, (tx) =>
        this.repository.insertAudit(tx, {
          tenantId,
          actorType: 'user',
          actorId: user.id,
          action: 'auth.login',
          entity: 'session',
          entityId: session.sessionId,
          ip: meta.ip,
        }),
      );
    }
    const response = await this.me({
      sessionId: session.sessionId,
      userId: user.id,
      tenantId,
      role: null, // me() resolves the membership itself
      csrfToken: session.csrfToken,
    });
    return { token: session.token, response };
  }

  async logout(auth: AuthContext, meta: RequestMeta): Promise<void> {
    await this.sessions.revoke(auth);
    if (auth.tenantId) {
      const tenantId = auth.tenantId;
      await this.database.withContext({ tenantId, userId: auth.userId }, (tx) =>
        this.repository.insertAudit(tx, {
          tenantId,
          actorType: 'user',
          actorId: auth.userId,
          action: 'auth.logout',
          entity: 'session',
          entityId: auth.sessionId,
          ip: meta.ip,
        }),
      );
    }
  }

  async me(auth: AuthContext): Promise<SessionResponse> {
    return this.database.withContext(
      { tenantId: auth.tenantId, userId: auth.userId },
      async (tx) => {
        const user = await this.repository.getUser(tx, auth.userId);
        if (!user) throw unauthenticated(); // user row gone: treat as signed out
        const tenant = auth.tenantId
          ? await this.repository.getActiveMembership(tx, auth.tenantId, auth.userId)
          : undefined;
        return {
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            emailVerified: user.emailVerifiedAt !== null,
          },
          tenant: tenant ?? null,
          csrfToken: auth.csrfToken,
        };
      },
    );
  }

  /** Always succeeds (202): never reveals whether an address has an account. */
  async forgotPassword(input: EmailOnlyRequest, meta: RequestMeta): Promise<void> {
    if (!(await this.allowEmail('reset', input.email, meta))) return;
    const user = await this.repository.findUserByEmail(input.email);
    if (!user) return;
    const token = await this.issueToken(user.id, 'password_reset', PASSWORD_RESET_TTL_MS);
    this.sendInBackground(resetPasswordMessage(input.email, this.env.APP_URL, token));
  }

  /**
   * New password + all sessions revoked + other reset links invalidated. The emailed link proves
   * the address, so an unverified email becomes verified.
   */
  async resetPassword(input: ResetPasswordRequest): Promise<void> {
    const userId = await this.repository.consumeToken(hashToken(input.token), 'password_reset');
    if (!userId) throw invalidToken();
    const passwordHash = await this.passwords.hash(input.password);
    const now = this.clock.now();
    await this.database.withContext({ userId }, async (tx) => {
      await this.repository.setPassword(tx, userId, passwordHash);
      await this.repository.markEmailVerified(tx, userId, now);
      await this.repository.revokeAllSessions(tx, userId, now);
      await this.repository.expireUnusedTokens(tx, userId, 'password_reset', now);
    });
  }

  private async issueToken(
    userId: string,
    purpose: 'email_verify' | 'password_reset',
    ttlMs: number,
  ): Promise<string> {
    const token = newToken();
    const expiresAt = new Date(this.clock.now().getTime() + ttlMs);
    await this.database.withContext({ userId }, (tx) =>
      this.repository.insertAuthToken(tx, {
        userId,
        purpose,
        tokenHash: hashToken(token),
        expiresAt,
      }),
    );
    return token;
  }

  /**
   * Per (IP, email) so one IP can't use up a victim's allowance for everyone, plus a per-IP ceiling.
   * Over the limit the request still returns 202; the email just isn't sent.
   */
  private async allowEmail(
    kind: 'verify' | 'reset',
    email: string,
    meta: RequestMeta,
  ): Promise<boolean> {
    const ip = meta.ip ?? 'unknown';
    const [perAddress, perIp] = await Promise.all([
      this.rateLimiter.consume(`${kind}:${ip}:${email}`, EMAILS_PER_ADDRESS_PER_HOUR, HOUR),
      this.rateLimiter.consume(`${kind}-ip:${ip}`, EMAILS_PER_IP_PER_HOUR, HOUR),
    ]);
    return perAddress === 0 && perIp === 0;
  }

  /**
   * Sends after the response, so 202 answers take the same time whether or not an account exists,
   * and email failures never fail the request (the user can ask again). Moves to the outbox in M0-T6.
   */
  private sendInBackground(message: EmailMessage): void {
    this.email.send(message).catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(`email to ${maskEmail(message.to)} failed: ${reason}`);
    });
  }
}
