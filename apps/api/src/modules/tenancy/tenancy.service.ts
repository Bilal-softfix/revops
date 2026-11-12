import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  type AcceptInvitationRequest,
  type Invitation,
  type InviteRequest,
  MEMBER_JOINED,
  type Member,
  type MemberJoinedV1,
  type MemberPage,
  type MyTenantsResponse,
  type PageQuery,
  type SessionResponse,
  type UpdateMemberRequest,
  assignableRoles,
  canManageRole,
} from '@revops/shared';
import type { Tx } from '@revops/db';
import type { ApiEnv } from '@revops/shared/env';
import { API_ENV } from '../../config/env';
import { Clock } from '../../platform/clock';
import { Database } from '../../platform/database/database';
import { recordAudit, recordEvent } from '../../platform/outbox/record';
import { JobQueue } from '../../platform/queue/job-queue';
import { DomainError } from '../../platform/errors/domain-error';
import { RateLimiter } from '../../platform/rate-limit/rate-limiter';
import type { RequestMeta } from '../../platform/request-meta';
import { EmailProvider } from '../../providers/email';
import { type AuthContext, IdentityService, PasswordService, SessionService } from '../identity';
import { invitationMessage } from './emails';
import { INVITATION_EMAIL_JOB, type InvitationEmailJobData } from './job-definitions';
import {
  alreadyMember,
  cannotChangeSelf,
  forbidden,
  invalidInvitation,
  invitationDetailsRequired,
  invitationEmailMismatch,
  invitationExists,
  invitationLoginRequired,
  lastOwner,
  notFound,
} from './errors';
import { type InvitationRow, TenancyRepository, toMember } from './tenancy.repository';
import {
  hashInvitationToken,
  newInvitationToken,
  tenantOfInvitationToken,
} from './invitation-token';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
export const INVITATION_TTL_MS = 7 * DAY;
/** Invitation emails a tenant may send per day (create + resend). */
const INVITES_PER_TENANT_PER_DAY = 100;
const ACCEPTS_PER_IP = 20;
const ACCEPT_WINDOW_MS = 15 * MINUTE;

/** An authenticated caller with an active tenant (guaranteed by @RequirePermission). */
type TenantAuth = AuthContext & { tenantId: string; role: NonNullable<AuthContext['role']> };

const toInvitation = (row: InvitationRow): Invitation => ({
  id: row.id,
  email: row.email,
  role: row.role,
  expiresAt: row.expiresAt.toISOString(),
  createdAt: row.createdAt.toISOString(),
});

function uniqueViolation(error: unknown): string | undefined {
  const e = error as { code?: unknown; constraint_name?: unknown; cause?: unknown };
  const pg = (e.code ? e : e.cause) as { code?: unknown; constraint_name?: unknown } | undefined;
  if (pg?.code !== '23505') return undefined;
  return typeof pg.constraint_name === 'string' ? pg.constraint_name : '';
}

@Injectable()
export class TenancyService {
  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly database: Database,
    private readonly repository: TenancyRepository,
    private readonly identity: IdentityService,
    private readonly sessions: SessionService,
    private readonly passwords: PasswordService,
    private readonly email: EmailProvider,
    private readonly rateLimiter: RateLimiter,
    private readonly jobs: JobQueue,
    private readonly clock: Clock,
  ) {}

  // --- members ---

  async listMembers(auth: TenantAuth, query: PageQuery): Promise<MemberPage> {
    const rows = await this.database.withContext(
      { tenantId: auth.tenantId, userId: auth.userId },
      (tx) =>
        this.repository.listMembers(tx, {
          limit: query.limit + 1,
          ...(query.cursor ? { afterMembershipId: query.cursor } : {}),
        }),
    );
    const page = rows.slice(0, query.limit);
    return {
      items: page.map(toMember),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.membershipId ?? null) : null,
    };
  }

  /**
   * Change a member's role and/or disable/re-enable them. Rules (Dev decisions, M0-T5):
   * actors only touch members whose role they can grant (admins never touch owners), only grant
   * roles they may assign, never disable themselves, and the last active owner can't be demoted
   * or disabled — checked under a lock on the owner rows.
   */
  async updateMember(
    auth: TenantAuth,
    targetUserId: string,
    patch: UpdateMemberRequest,
    meta: RequestMeta,
  ): Promise<Member> {
    if (targetUserId === auth.userId && patch.status === 'disabled') throw cannotChangeSelf();
    if (patch.role && !assignableRoles(auth.role).includes(patch.role)) throw forbidden();

    return this.database.withContext(
      { tenantId: auth.tenantId, userId: auth.userId },
      async (tx) => {
        const target = await this.repository.getMember(tx, targetUserId);
        if (!target) throw notFound();
        if (!canManageRole(auth.role, target.role)) throw forbidden();

        const losesOwnership =
          target.role === 'owner' &&
          target.status === 'active' &&
          ((patch.role !== undefined && patch.role !== 'owner') || patch.status === 'disabled');
        if (losesOwnership) {
          const owners = await this.repository.lockActiveOwners(tx);
          if (owners.filter((id) => id !== targetUserId).length === 0) throw lastOwner();
        }

        await this.repository.updateMember(tx, targetUserId, patch);
        const before = { role: target.role, status: target.status };
        const after = { role: patch.role ?? target.role, status: patch.status ?? target.status };
        await recordAudit(tx, {
          tenantId: auth.tenantId,
          actorType: 'user',
          actorId: auth.userId,
          action:
            patch.status && patch.status !== target.status
              ? patch.status === 'disabled'
                ? 'member.disabled'
                : 'member.enabled'
              : 'member.role_changed',
          entity: 'membership',
          entityId: target.membershipId,
          before,
          after,
          ip: meta.ip,
        });
        return toMember({ ...target, ...after });
      },
    );
  }

  // --- invitations ---

  async listInvitations(auth: TenantAuth): Promise<{ items: Invitation[] }> {
    const rows = await this.database.withContext(
      { tenantId: auth.tenantId, userId: auth.userId },
      (tx) => this.repository.listPendingInvitations(tx, this.clock.now()),
    );
    return { items: rows.map(toInvitation) };
  }

  async invite(auth: TenantAuth, input: InviteRequest, meta: RequestMeta): Promise<Invitation> {
    if (!assignableRoles(auth.role).includes(input.role)) throw forbidden();
    await this.limitInvitationEmails(auth.tenantId);
    const now = this.clock.now();

    const row = await this.database
      .withContext({ tenantId: auth.tenantId, userId: auth.userId }, async (tx) => {
        const member = await this.repository.findMemberByEmail(tx, input.email);
        if (member && member.status === 'active') throw alreadyMember();
        // Accepting would overwrite this membership's role and status, so a disabled member is
        // only re-invitable by someone who may manage their current role (an admin can't
        // reactivate a disabled owner this way — M0 security review L3).
        if (member && !canManageRole(auth.role, member.role)) throw forbidden();
        const open = await this.repository.findOpenInvitationByEmail(tx, input.email);
        if (open && open.expiresAt > now) throw invitationExists();
        if (open) {
          // Expired: it no longer counts as pending, but still holds the open-email unique slot.
          // Supersede it (revoked + audited) so the new invitation can take its place (M1-T0).
          await this.repository.revokeInvitation(tx, open.id, now);
          await recordAudit(tx, {
            tenantId: auth.tenantId,
            actorType: 'user',
            actorId: auth.userId,
            action: 'invitation.superseded',
            entity: 'invitation',
            entityId: open.id,
            ip: meta.ip,
          });
        }
        const inserted = await this.repository.insertInvitation(tx, {
          tenantId: auth.tenantId,
          email: input.email,
          role: input.role,
          // A placeholder: the email job mints the real link (job rows never hold tokens).
          tokenHash: hashInvitationToken(newInvitationToken(auth.tenantId)),
          invitedBy: auth.userId,
          expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
        });
        await recordAudit(tx, {
          tenantId: auth.tenantId,
          actorType: 'user',
          actorId: auth.userId,
          action: 'invitation.created',
          entity: 'invitation',
          entityId: inserted.id,
          after: { role: input.role },
          ip: meta.ip,
        });
        await this.enqueueInvitationEmail(tx, auth, inserted.id);
        return inserted;
      })
      .catch((error: unknown) => {
        // Lost a race with a concurrent invite for the same email.
        if (uniqueViolation(error) === 'invitations_open_email_unique') throw invitationExists();
        throw error;
      });

    return toInvitation(row);
  }

  /** New link (the old one dies) and a fresh 7-day expiry. */
  async resend(auth: TenantAuth, invitationId: string, meta: RequestMeta): Promise<void> {
    await this.limitInvitationEmails(auth.tenantId);
    const now = this.clock.now();
    await this.database.withContext(
      { tenantId: auth.tenantId, userId: auth.userId },
      async (tx) => {
        const invitation = await this.repository.getOpenInvitation(tx, invitationId);
        if (!invitation) throw notFound();
        if (!canManageRole(auth.role, invitation.role)) throw forbidden();
        // The old link dies now; the email job mints the new one (keeping this expiry).
        await this.repository.rotateInvitation(
          tx,
          invitationId,
          hashInvitationToken(newInvitationToken(auth.tenantId)),
          new Date(now.getTime() + INVITATION_TTL_MS),
        );
        await recordAudit(tx, {
          tenantId: auth.tenantId,
          actorType: 'user',
          actorId: auth.userId,
          action: 'invitation.resent',
          entity: 'invitation',
          entityId: invitationId,
          ip: meta.ip,
        });
        await this.enqueueInvitationEmail(tx, auth, invitationId);
      },
    );
  }

  async revoke(auth: TenantAuth, invitationId: string, meta: RequestMeta): Promise<void> {
    await this.database.withContext(
      { tenantId: auth.tenantId, userId: auth.userId },
      async (tx) => {
        const invitation = await this.repository.getOpenInvitation(tx, invitationId);
        if (!invitation) throw notFound();
        if (!canManageRole(auth.role, invitation.role)) throw forbidden();
        await this.repository.revokeInvitation(tx, invitationId, this.clock.now());
        await recordAudit(tx, {
          tenantId: auth.tenantId,
          actorType: 'user',
          actorId: auth.userId,
          action: 'invitation.revoked',
          entity: 'invitation',
          entityId: invitationId,
          ip: meta.ip,
        });
      },
    );
  }

  /**
   * Accept an invitation (Dev decisions, M0-T5):
   * - the invited email has a verified account → the caller must be signed in as it; the
   *   membership is added and the session switches to the tenant;
   * - otherwise (no account, or an unverified pending one, which is discarded) → `name` +
   *   `password` create a verified account (the link proves the email) and sign it in.
   * The invitation is claimed atomically in the same transaction, so it works exactly once.
   * Returns the new session token when one was created (caller sets the cookie).
   */
  async accept(
    input: AcceptInvitationRequest,
    auth: AuthContext | undefined,
    meta: RequestMeta,
  ): Promise<{ response: SessionResponse; sessionToken?: string }> {
    const retryAfter = await this.rateLimiter.consume(
      `invite-accept-ip:${meta.ip ?? 'unknown'}`,
      ACCEPTS_PER_IP,
      ACCEPT_WINDOW_MS,
    );
    if (retryAfter > 0) {
      throw new DomainError('rate_limited', 429, 'Too many attempts — try again later', {
        headers: { 'Retry-After': String(retryAfter) },
      });
    }

    const tenantId = tenantOfInvitationToken(input.token);
    if (!tenantId) throw invalidInvitation();
    const tokenHash = hashInvitationToken(input.token);
    const now = this.clock.now();
    const invitation = await this.database.withContext({ tenantId }, (tx) =>
      this.repository.peekInvitation(tx, tokenHash, now),
    );
    if (!invitation) throw invalidInvitation();

    const existing = await this.repository.findUserByEmail(invitation.email);
    if (existing?.verified) {
      if (!auth) throw invitationLoginRequired();
      if (auth.userId !== existing.id) throw invitationEmailMismatch();
      await this.join(tenantId, existing.id, invitation, meta, auth.sessionId);
      const response = await this.identity.me({ ...auth, tenantId, role: invitation.role });
      return { response };
    }

    if (!input.name || !input.password) throw invitationDetailsRequired();
    await this.repository.discardUnverifiedByEmail(invitation.email);
    const passwordHash = await this.passwords.hash(input.password);
    const userId = randomUUID();
    await this.join(tenantId, userId, invitation, meta, undefined, {
      name: input.name,
      passwordHash,
    });
    const session = await this.sessions.create({ userId, tenantId, ...meta });
    const response = await this.identity.me({
      sessionId: session.sessionId,
      userId,
      tenantId,
      role: invitation.role,
      csrfToken: session.csrfToken,
    });
    return { response, sessionToken: session.token };
  }

  /** Claim + (new user) + membership + audit + `member.joined.v1` (+ session switch), one tx. */
  private async join(
    tenantId: string,
    userId: string,
    invitation: InvitationRow,
    meta: RequestMeta,
    switchSessionId?: string,
    newUser?: { name: string; passwordHash: string },
  ): Promise<void> {
    const now = this.clock.now();
    await this.database
      .withContext({ tenantId, userId }, async (tx) => {
        if (!(await this.repository.claimInvitation(tx, invitation.id, now))) {
          throw invalidInvitation();
        }
        if (newUser) {
          await this.repository.insertVerifiedUser(tx, {
            id: userId,
            email: invitation.email,
            ...newUser,
            now,
          });
        }
        await this.repository.upsertMembership(tx, tenantId, userId, invitation.role);
        await recordAudit(tx, {
          tenantId,
          actorType: 'user',
          actorId: userId,
          action: 'member.joined',
          entity: 'invitation',
          entityId: invitation.id,
          after: { role: invitation.role },
          ip: meta.ip,
        });
        const payload: MemberJoinedV1 = { tenantId, userId, invitationId: invitation.id };
        await recordEvent(tx, MEMBER_JOINED, {
          tenantId,
          aggregateId: userId,
          payload,
        });
        if (switchSessionId) await this.repository.setSessionTenant(tx, switchSessionId, tenantId);
      })
      .catch((error: unknown) => {
        // A signup for the same email committed between our check and insert.
        if (uniqueViolation(error) === 'users_email_unique') throw invalidInvitation();
        throw error;
      });
  }

  // --- the caller's tenants ---

  async myTenants(auth: AuthContext): Promise<MyTenantsResponse> {
    // User-only context: the self_select policies show the caller's own active memberships.
    const items = await this.database.withContext({ userId: auth.userId }, (tx) =>
      this.repository.myTenants(tx),
    );
    return { items };
  }

  /** Switch the session's active tenant — only to one of the caller's active memberships. */
  async switchTenant(auth: AuthContext, tenantId: string): Promise<SessionResponse> {
    const membership = await this.database.withContext({ userId: auth.userId }, async (tx) => {
      const mine = (await this.repository.myTenants(tx)).find((t) => t.id === tenantId);
      if (mine) await this.repository.setSessionTenant(tx, auth.sessionId, tenantId);
      return mine;
    });
    if (!membership) throw notFound();
    return this.identity.me({ ...auth, tenantId, role: membership.role });
  }

  // --- helpers ---

  private async limitInvitationEmails(tenantId: string): Promise<void> {
    const retryAfter = await this.rateLimiter.consume(
      `invite-tenant:${tenantId}`,
      INVITES_PER_TENANT_PER_DAY,
      DAY,
    );
    if (retryAfter > 0) {
      throw new DomainError('rate_limited', 429, 'Too many invitations today — try again later', {
        headers: { 'Retry-After': String(retryAfter) },
      });
    }
  }

  /** In the caller's transaction: no email for an invitation that was never committed. */
  private enqueueInvitationEmail(tx: Tx, auth: TenantAuth, invitationId: string): Promise<unknown> {
    return this.jobs.send(
      INVITATION_EMAIL_JOB,
      { tenantId: auth.tenantId, invitationId, actorUserId: auth.userId },
      { tx },
    );
  }

  /**
   * Job `tenancy.invitation-email` (worker): mints the link and emails it. Skips an invitation that
   * was accepted, revoked or expired in the meantime. Each run rotates the token, so after a retry
   * or a resend only the newest emailed link works; the expiry is kept.
   */
  async sendInvitationEmail(data: InvitationEmailJobData): Promise<void> {
    const token = newInvitationToken(data.tenantId);
    const now = this.clock.now();
    const message = await this.database.withContext(
      { tenantId: data.tenantId, userId: data.actorUserId },
      async (tx) => {
        const invitation = await this.repository.getOpenInvitation(tx, data.invitationId);
        if (!invitation || invitation.expiresAt <= now) return null;
        await this.repository.rotateInvitation(
          tx,
          invitation.id,
          hashInvitationToken(token),
          invitation.expiresAt,
        );
        return {
          to: invitation.email,
          role: invitation.role,
          tenantName: (await this.repository.getTenant(tx, data.tenantId))?.name ?? 'a workspace',
          inviterName: (await this.repository.getUserName(tx, data.actorUserId)) ?? 'A teammate',
        };
      },
    );
    if (message) {
      await this.email.send(invitationMessage({ ...message, token, appUrl: this.env.APP_URL }));
    }
  }
}
