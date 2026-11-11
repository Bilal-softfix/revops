import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type CancelSignupRequest,
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
import { BackgroundTasks } from '../../platform/background-tasks';
import { Clock } from '../../platform/clock';
import { Database } from '../../platform/database/database';
import { RateLimiter } from '../../platform/rate-limit/rate-limiter';
import type { RequestMeta } from '../../platform/request-meta';
import { EmailProvider, maskEmail } from '../../providers/email';
import { accountExistsMessage, resetPasswordMessage, verifyEmailMessage } from './emails';
import {
  invalidCredentials,
  invalidToken,
  rateLimited,
  unauthenticated,
  verificationFailed,
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
/** Verify-email password attempts per account per 15 minutes (plus a per-IP ceiling). */
export const VERIFY_MAX_ATTEMPTS = 5;
const VERIFY_PER_IP = 50;
/** Auth emails per (IP, email) and per IP, per hour; extra requests are dropped silently. */
const EMAILS_PER_ADDRESS_PER_HOUR = 3;
const EMAILS_PER_IP_PER_HOUR = 20;
/**
 * A pending signup can be replaced by a new signup for the same email (Dev decision b2), but at most
 * this often per email per day, from any IP, so nobody can keep wiping someone else's signup.
 */
const REPLACES_PER_EMAIL_PER_DAY = 3;
const CANCELS_PER_IP = 20;
const SIGNUP_ATTEMPTS = 3; // retries on a (24-bit) tenant slug collision

/** The violated unique constraint's name, or undefined if `error` isn't a unique violation. */
function uniqueViolation(error: unknown): string | undefined {
  const e = error as { code?: unknown; constraint_name?: unknown; cause?: unknown };
  const pg = (e.code ? e : e.cause) as { code?: unknown; constraint_name?: unknown } | undefined;
  if (pg?.code !== '23505') return undefined;
  return typeof pg.constraint_name === 'string' ? pg.constraint_name : '';
}

const CHECK_EMAIL: SignupResponse = { status: 'check_email' };

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
    private readonly background: BackgroundTasks,
    private readonly clock: Clock,
  ) {}

  /**
   * Always the same 202 right after validation and the per-IP limit; everything that depends on
   * the email's state runs in the background, so neither the body nor the timing reveals it:
   * - verified account → "you already have an account" email, nothing created;
   * - unverified (pending or expired) → that pending account is discarded and replaced;
   * - new → user + tenant + owner membership + audit + `user.signed_up.v1` + verify token, one tx.
   */
  async signup(input: SignupRequest, meta: RequestMeta): Promise<SignupResponse> {
    const retryAfter = await this.rateLimiter.consume(
      `signup-ip:${meta.ip ?? 'unknown'}`,
      SIGNUPS_PER_IP_PER_HOUR,
      HOUR,
    );
    if (retryAfter > 0) throw rateLimited(retryAfter);
    this.background.run('identity.signup', () => this.processSignup(input, meta));
    return CHECK_EMAIL;
  }

  private async processSignup(input: SignupRequest, meta: RequestMeta): Promise<void> {
    if (!(await this.allowEmail('signup', input.email, meta))) return;
    const existing = await this.repository.findUserByEmail(input.email);
    if (existing?.emailVerifiedAt) {
      await this.email.send(accountExistsMessage(input.email, this.env.APP_URL));
      return;
    }
    // Pending unverified account for this email: replace it (new password, tenant and links; the
    // old ones stop working). Expired ones are invisible to the lookup and always replaced.
    if (existing) {
      const blocked = await this.rateLimiter.consume(
        `signup-replace:${input.email}`,
        REPLACES_PER_EMAIL_PER_DAY,
        24 * HOUR,
      );
      if (blocked > 0) return; // the current pending signup stays; the request already got 202
    }
    if (await this.repository.discardUnverifiedByEmail(input.email)) {
      const ip = meta.ip ?? 'unknown';
      this.logger.log(
        `discarded unverified ${maskEmail(input.email)}: replaced by signup from ${ip}`,
      );
    }

    const passwordHash = await this.passwords.hash(input.password);
    for (let attempt = 1; ; attempt++) {
      try {
        const verifyToken = await this.createAccount(input, passwordHash, meta);
        await this.email.send(verifyEmailMessage(input.email, this.env.APP_URL, verifyToken));
        return;
      } catch (error) {
        const constraint = uniqueViolation(error);
        // A concurrent signup for the same email won the race; it sent its own email.
        if (constraint === 'users_email_unique') return;
        if (constraint === 'tenants_slug_unique' && attempt < SIGNUP_ATTEMPTS) continue;
        throw error;
      }
    }
  }

  /** Returns the verification token to email. */
  private async createAccount(
    input: SignupRequest,
    passwordHash: string,
    meta: RequestMeta,
  ): Promise<string> {
    const userId = randomUUID();
    const tenantId = randomUUID();
    const verifyToken = newToken();
    const now = this.clock.now();

    await this.database.withContext({ tenantId, userId }, async (tx) => {
      await this.repository.insertUser(tx, {
        id: userId,
        email: input.email,
        name: input.name,
        passwordHash,
      });
      await this.repository.insertTenant(tx, {
        id: tenantId,
        name: input.tenantName,
        slug: tenantSlug(input.tenantName),
      });
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
    return verifyToken;
  }

  /**
   * Token + the account password. Unknown/used/expired token, an expired account and a wrong
   * password all give the same `verification_failed` after exactly one argon2 verify, and every
   * attempt counts toward the per-account and per-IP limits.
   */
  async verifyEmail(input: VerifyEmailRequest, meta: RequestMeta): Promise<void> {
    const tokenHash = hashToken(input.token);
    const pending = await this.repository.peekVerifyToken(tokenHash);
    const retryAfter = Math.max(
      await this.rateLimiter.consume(
        `verify-ip:${meta.ip ?? 'unknown'}`,
        VERIFY_PER_IP,
        LOGIN_WINDOW_MS,
      ),
      pending
        ? await this.rateLimiter.consume(
            `verify-user:${pending.userId}`,
            VERIFY_MAX_ATTEMPTS,
            LOGIN_WINDOW_MS,
          )
        : 0,
    );
    if (retryAfter > 0) throw rateLimited(retryAfter);

    const ok = pending?.passwordHash
      ? await this.passwords.verify(pending.passwordHash, input.password)
      : await this.passwords.verifyDummy(input.password);
    if (!pending || !ok) throw verificationFailed();

    // One transaction: link still live and theirs, account still unverified and not discarded by a
    // concurrent signup-replace / cancel / purge. Losing any of those races fails cleanly here.
    if (!(await this.repository.verifyEmail(tokenHash, pending.userId))) throw verificationFailed();
    await this.rateLimiter.reset(`verify-user:${pending.userId}`);
  }

  /**
   * "This wasn't me / start over": the link discards its unverified account and tenant. The web
   * page must only call this from an explicit button click, never on load (mail link scanners).
   */
  async cancelSignup(input: CancelSignupRequest, meta: RequestMeta): Promise<void> {
    const ip = meta.ip ?? 'unknown';
    const retryAfter = await this.rateLimiter.consume(
      `cancel-ip:${ip}`,
      CANCELS_PER_IP,
      LOGIN_WINDOW_MS,
    );
    if (retryAfter > 0) throw rateLimited(retryAfter);
    if (!(await this.repository.discardUnverifiedByToken(hashToken(input.token)))) {
      throw invalidToken();
    }
    this.logger.log(`discarded an unverified account via its "this wasn't me" link (from ${ip})`);
  }

  /** Always 202; the lookup and email happen in the background (no account-state signal). */
  resendVerification(input: EmailOnlyRequest, meta: RequestMeta): void {
    this.background.run('identity.resend-verification', async () => {
      if (!(await this.allowEmail('verify', input.email, meta))) return;
      const user = await this.repository.findUserByEmail(input.email);
      if (!user || user.emailVerifiedAt) return;
      const token = await this.issueToken(user.id, 'email_verify', EMAIL_VERIFY_TTL_MS);
      await this.email.send(verifyEmailMessage(input.email, this.env.APP_URL, token));
    });
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

    // Expired unverified accounts are filtered out in SQL, i.e. treated as non-existent.
    const user = await this.repository.findUserByEmail(input.email);
    const ok = user?.passwordHash
      ? await this.passwords.verify(user.passwordHash, input.password)
      : await this.passwords.verifyDummy(input.password);
    if (!user || !ok) throw invalidCredentials();
    if (!user.emailVerifiedAt) {
      // Same answer as a wrong password: a distinct "not verified" response would let anyone tell,
      // via signup + login, whether an email already had a verified account. The owner gets a
      // fresh verification email instead (rate-limited, in the background).
      this.resendVerification({ email: input.email }, meta);
      throw invalidCredentials();
    }
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

  /** Always 202; the lookup and email happen in the background (no account-state signal). */
  forgotPassword(input: EmailOnlyRequest, meta: RequestMeta): void {
    this.background.run('identity.forgot-password', async () => {
      if (!(await this.allowEmail('reset', input.email, meta))) return;
      const user = await this.repository.findUserByEmail(input.email);
      if (!user) return;
      if (!user.emailVerifiedAt) {
        // Unverified: it may be someone else's pre-registration with this email. A reset would
        // hand the inbox owner that account (and its tenant name); the verify email offers
        // "this wasn't me / start over" instead.
        const token = await this.issueToken(user.id, 'email_verify', EMAIL_VERIFY_TTL_MS);
        await this.email.send(verifyEmailMessage(input.email, this.env.APP_URL, token));
        return;
      }
      const token = await this.issueToken(user.id, 'password_reset', PASSWORD_RESET_TTL_MS);
      await this.email.send(resetPasswordMessage(input.email, this.env.APP_URL, token));
    });
  }

  /**
   * New password + every session of the user revoked + other reset links invalidated. The emailed
   * link proves the address, so an unverified email becomes verified.
   */
  async resetPassword(input: ResetPasswordRequest): Promise<void> {
    // Hash first (argon2 time doesn't depend on the link), then one atomic DB call.
    const passwordHash = await this.passwords.hash(input.password);
    const userId = await this.repository.resetPassword(hashToken(input.token), passwordHash);
    if (!userId) throw invalidToken();
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
   * Over the limit nothing is sent (the request already returned 202).
   */
  private async allowEmail(
    kind: 'signup' | 'verify' | 'reset',
    email: string,
    meta: RequestMeta,
  ): Promise<boolean> {
    const ip = meta.ip ?? 'unknown';
    const [perAddress, perIp] = await Promise.all([
      this.rateLimiter.consume(`email-${kind}:${ip}:${email}`, EMAILS_PER_ADDRESS_PER_HOUR, HOUR),
      this.rateLimiter.consume(`email-${kind}-ip:${ip}`, EMAILS_PER_IP_PER_HOUR, HOUR),
    ]);
    return perAddress === 0 && perIp === 0;
  }
}
