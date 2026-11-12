import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { provisionCrm } from '@revops/db';
import {
  type CancelSignupRequest,
  DEFAULT_INDUSTRY_TEMPLATE,
  type IndustryTemplateKey,
  type EmailOnlyRequest,
  type LoginRequest,
  type ResetPasswordRequest,
  type SessionResponse,
  type SignupRequest,
  type SignupResponse,
  USER_SIGNED_UP,
  type UserSignedUpV1,
  type VerifyEmailRequest,
} from '@revops/shared';
import type { ApiEnv } from '@revops/shared/env';
import { API_ENV } from '../../config/env';
import { Clock } from '../../platform/clock';
import { Database } from '../../platform/database/database';
import { recordAudit, recordEvent } from '../../platform/outbox/record';
import { JobQueue } from '../../platform/queue/job-queue';
import { RateLimiter } from '../../platform/rate-limit/rate-limiter';
import type { RequestMeta } from '../../platform/request-meta';
import { EmailProvider, maskEmail } from '../../providers/email';
import {
  accountExistsMessage,
  resetPasswordMessage,
  startOverMessage,
  verifyEmailMessage,
} from './emails';
import {
  invalidCredentials,
  invalidToken,
  rateLimited,
  unauthenticated,
  verificationFailed,
} from './errors';
import { IdentityRepository } from './identity.repository';
import { PasswordService } from './password.service';
import {
  type EmailJobData,
  FORGOT_PASSWORD_JOB,
  RESEND_VERIFICATION_JOB,
  SIGNUP_JOB,
  type SignupJobData,
} from './job-definitions';
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
/**
 * Per-account login ceiling, whatever the IP (M0 security review HIGH-1): the client IP can be
 * spoofed behind the web proxy until M8, so an IP-keyed limit alone doesn't stop guessing one
 * account. Cleared on success. Trade-off: 20 bad attempts lock that email out for 15 minutes.
 */
export const LOGIN_PER_EMAIL = 20;
export const SIGNUPS_PER_IP_PER_HOUR = 10;
/** Verify-email password attempts per account per 15 minutes (plus a per-IP ceiling). */
export const VERIFY_MAX_ATTEMPTS = 5;
const VERIFY_PER_IP = 50;
/** Auth emails per (IP, email) and per IP, per hour; extra requests are dropped silently. */
const EMAILS_PER_ADDRESS_PER_HOUR = 3;
const EMAILS_PER_IP_PER_HOUR = 20;
/** Auth emails per address per hour from ANY IP (no email bombing via spoofed IPs). */
export const EMAILS_PER_ADDRESS_ANY_IP_PER_HOUR = 5;
/** resend-verification / forgot-password requests per IP per hour, checked before enqueueing. */
export const EMAIL_REQUESTS_PER_IP_PER_HOUR = 20;
/**
 * A pending signup can be replaced by a new signup for the same email (Dev decision b2), but at most
 * this often per email per day, from any IP, so nobody can keep wiping someone else's signup.
 */
const REPLACES_PER_EMAIL_PER_DAY = 3;
const CANCELS_PER_IP = 20;
/** Reset attempts per IP per 15 minutes: each one costs an argon2 hash before the link is checked. */
export const RESETS_PER_IP = 20;
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
    private readonly jobs: JobQueue,
    private readonly clock: Clock,
  ) {}

  /**
   * Always the same 202 right after validation and the per-IP limit; everything that depends on
   * the email's state runs in the background, so neither the body nor the timing reveals it:
   * - verified account → "you already have an account" email, nothing created;
   * - unverified (pending or expired) → that pending account is discarded and replaced;
   * - new → user + tenant + owner membership + audit + `user.signed_up.v1` + verify token, one tx.
   * The password is hashed here (same argon2 work for every request) so the job row stores only
   * the hash, never the password.
   */
  async signup(input: SignupRequest, meta: RequestMeta): Promise<SignupResponse> {
    const retryAfter = await this.rateLimiter.consume(
      `signup-ip:${meta.ip ?? 'unknown'}`,
      SIGNUPS_PER_IP_PER_HOUR,
      HOUR,
    );
    if (retryAfter > 0) throw rateLimited(retryAfter);
    const passwordHash = await this.passwords.hash(input.password);
    await this.jobs.send(SIGNUP_JOB, {
      name: input.name,
      email: input.email,
      tenantName: input.tenantName,
      industry: input.industry ?? DEFAULT_INDUSTRY_TEMPLATE,
      passwordHash,
      meta,
    });
    return CHECK_EMAIL;
  }

  /** Job `identity.signup` (worker). */
  async completeSignup(input: SignupJobData, attempt = 0): Promise<void> {
    const { meta } = input;
    if (!(await this.allowEmail('signup', input.email, meta, attempt))) return;
    const existing = await this.repository.findUserByEmail(input.email);
    if (existing?.emailVerifiedAt) {
      await this.email.send(accountExistsMessage(input.email, this.env.APP_URL));
      return;
    }
    // Pending unverified account for this email: replace it (new password, tenant and links; the
    // old ones stop working). Expired ones are invisible to the lookup and always replaced.
    if (existing && attempt === 0) {
      const blocked = await this.rateLimiter.consume(
        `signup-replace:${input.email}`,
        REPLACES_PER_EMAIL_PER_DAY,
        24 * HOUR,
      );
      if (blocked > 0) {
        // The pending sign-up stays (the request already got 202), but the inbox owner still hears
        // about it: a start-over link, so a squatter can't block the address (M1-T0). Already
        // counted against the per-address email limits by allowEmail above.
        const token = await this.issueToken(existing.id, 'email_verify', EMAIL_VERIFY_TTL_MS);
        await this.email.send(startOverMessage(input.email, this.env.APP_URL, token));
        return;
      }
    }
    if (await this.repository.discardUnverifiedByEmail(input.email)) {
      const ip = meta.ip ?? 'unknown';
      this.logger.log(
        `discarded unverified ${maskEmail(input.email)}: replaced by signup from ${ip}`,
      );
    }

    for (let attempt = 1; ; attempt++) {
      try {
        const verifyToken = await this.createAccount(input, input.passwordHash, meta);
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
    input: Pick<SignupRequest, 'name' | 'email' | 'tenantName'> & { industry: IndustryTemplateKey },
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
        industryTemplate: input.industry,
      });
      await this.repository.insertMembership(tx, { tenantId, userId, role: 'owner' });
      // The CRM setup (pipelines, fields, sources) comes from the chosen industry template, in
      // the same transaction: a new tenant never exists without one (M1-T3a).
      await provisionCrm(tx, tenantId, input.industry);
      await recordAudit(tx, {
        tenantId,
        actorType: 'user',
        actorId: userId,
        action: 'user.signed_up',
        entity: 'tenant',
        entityId: tenantId,
        ip: meta.ip,
      });
      const payload: UserSignedUpV1 = { userId, tenantId };
      await recordEvent(tx, USER_SIGNED_UP, {
        tenantId,
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
    const email = await this.repository.cancelSignupByToken(hashToken(input.token));
    if (!email) throw invalidToken();
    // The link was only ever emailed to that address, so this proves inbox ownership: give the
    // owner back the full replace allowance (M1-T0), so a squatter can't keep them blocked.
    await this.rateLimiter.reset(`signup-replace:${email}`);
    this.logger.log(`discarded an unverified account via its "this wasn't me" link (from ${ip})`);
  }

  /** Always 202; the lookup and email happen in a job (no account-state signal). */
  async resendVerification(input: EmailOnlyRequest, meta: RequestMeta): Promise<void> {
    await this.limitEmailRequests('resend', meta);
    await this.jobs.send(RESEND_VERIFICATION_JOB, { email: input.email, meta });
  }

  /** Job `identity.resend-verification` (worker). */
  async sendVerificationEmail({ email, meta }: EmailJobData, attempt = 0): Promise<void> {
    if (!(await this.allowEmail('verify', email, meta, attempt))) return;
    const user = await this.repository.findUserByEmail(email);
    if (!user || user.emailVerifiedAt) return;
    const token = await this.issueToken(user.id, 'email_verify', EMAIL_VERIFY_TTL_MS);
    await this.email.send(verifyEmailMessage(email, this.env.APP_URL, token));
  }

  async login(
    input: LoginRequest,
    meta: RequestMeta,
  ): Promise<{ token: string; response: SessionResponse }> {
    const ip = meta.ip ?? 'unknown';
    const key = `login:${ip}:${input.email}`;
    // Reserve the attempt first (atomic), then verify: a parallel burst can't exceed the limit.
    const emailKey = `login-email:${input.email}`;
    const retryAfter = Math.max(
      await this.rateLimiter.consume(`login-ip:${ip}`, LOGIN_PER_IP, LOGIN_WINDOW_MS),
      await this.rateLimiter.consume(key, LOGIN_MAX_FAILURES, LOGIN_WINDOW_MS),
      await this.rateLimiter.consume(emailKey, LOGIN_PER_EMAIL, LOGIN_WINDOW_MS),
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
      // fresh verification email instead (rate-limited in the job). Enqueued directly: the
      // request-path limit of /resend-verification would turn this into a distinct 429.
      await this.jobs.send(RESEND_VERIFICATION_JOB, { email: input.email, meta });
      throw invalidCredentials();
    }
    await Promise.all([this.rateLimiter.reset(key), this.rateLimiter.reset(emailKey)]);

    const tenantId =
      (await this.database.withContext({ userId: user.id }, (tx) =>
        this.repository.firstActiveTenantId(tx, user.id),
      )) ?? null;
    const session = await this.sessions.create({ userId: user.id, tenantId, ...meta });
    if (tenantId) {
      await this.database.withContext({ tenantId, userId: user.id }, (tx) =>
        recordAudit(tx, {
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
        recordAudit(tx, {
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

  /** Always 202; the lookup and email happen in a job (no account-state signal). */
  async forgotPassword(input: EmailOnlyRequest, meta: RequestMeta): Promise<void> {
    await this.limitEmailRequests('forgot', meta);
    await this.jobs.send(FORGOT_PASSWORD_JOB, { email: input.email, meta });
  }

  /** Job `identity.forgot-password` (worker). */
  async sendPasswordResetEmail({ email, meta }: EmailJobData, attempt = 0): Promise<void> {
    if (!(await this.allowEmail('reset', email, meta, attempt))) return;
    const user = await this.repository.findUserByEmail(email);
    if (!user) return;
    if (!user.emailVerifiedAt) {
      // Unverified: it may be someone else's pre-registration with this email. A reset would
      // hand the inbox owner that account (and its tenant name); the verify email offers
      // "this wasn't me / start over" instead.
      const token = await this.issueToken(user.id, 'email_verify', EMAIL_VERIFY_TTL_MS);
      await this.email.send(verifyEmailMessage(email, this.env.APP_URL, token));
      return;
    }
    const token = await this.issueToken(user.id, 'password_reset', PASSWORD_RESET_TTL_MS);
    await this.email.send(resetPasswordMessage(email, this.env.APP_URL, token));
  }

  /**
   * New password + every session of the user revoked + other reset links invalidated. The emailed
   * link proves the address, so an unverified email becomes verified.
   */
  async resetPassword(input: ResetPasswordRequest, meta: RequestMeta): Promise<void> {
    // Per-IP ceiling first: without it, fake links make unthrottled argon2 work (CPU DoS).
    const retryAfter = await this.rateLimiter.consume(
      `reset-ip:${meta.ip ?? 'unknown'}`,
      RESETS_PER_IP,
      LOGIN_WINDOW_MS,
    );
    if (retryAfter > 0) throw rateLimited(retryAfter);
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
  /**
   * Whether this job may send an auth email. Counted once per request: a retried attempt
   * (provider outage) must not use up the user's allowance and then silently send nothing.
   */
  private async allowEmail(
    kind: 'signup' | 'verify' | 'reset',
    email: string,
    meta: RequestMeta,
    attempt: number,
  ): Promise<boolean> {
    if (attempt > 0) return true;
    const ip = meta.ip ?? 'unknown';
    const results = await Promise.all([
      this.rateLimiter.consume(`email-${kind}:${ip}:${email}`, EMAILS_PER_ADDRESS_PER_HOUR, HOUR),
      this.rateLimiter.consume(`email-${kind}-ip:${ip}`, EMAILS_PER_IP_PER_HOUR, HOUR),
      this.rateLimiter.consume(
        `email-${kind}-addr:${email}`,
        EMAILS_PER_ADDRESS_ANY_IP_PER_HOUR,
        HOUR,
      ),
    ]);
    return results.every((retryAfter) => retryAfter === 0);
  }

  /** Per-IP ceiling on resend/forgot requests, before anything is enqueued (no job flooding). */
  private async limitEmailRequests(kind: 'resend' | 'forgot', meta: RequestMeta): Promise<void> {
    const retryAfter = await this.rateLimiter.consume(
      `${kind}-ip:${meta.ip ?? 'unknown'}`,
      EMAIL_REQUESTS_PER_IP_PER_HOUR,
      HOUR,
    );
    if (retryAfter > 0) throw rateLimited(retryAfter);
  }
}
