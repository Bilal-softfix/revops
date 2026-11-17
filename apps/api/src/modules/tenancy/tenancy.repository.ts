import { Injectable } from '@nestjs/common';
import {
  type Tx,
  and,
  asc,
  eq,
  gt,
  invitations,
  isNull,
  memberships,
  sessions,
  sql,
  tenants,
  users,
} from '@revops/db';
import type { Member, Role } from '@revops/shared';
import { Database } from '../../platform/database/database';

export interface MemberRow {
  userId: string;
  name: string;
  email: string;
  role: Role;
  status: 'active' | 'disabled' | 'invited';
  joinedAt: Date;
  membershipId: string;
}

export interface InvitationRow {
  id: string;
  email: string;
  role: Role;
  expiresAt: Date;
  createdAt: Date;
  invitedBy: string | null;
}

const memberColumns = {
  userId: memberships.userId,
  name: users.name,
  email: users.email,
  role: memberships.role,
  status: memberships.status,
  joinedAt: memberships.createdAt,
  membershipId: memberships.id,
};

const invitationColumns = {
  id: invitations.id,
  email: invitations.email,
  role: invitations.role,
  expiresAt: invitations.expiresAt,
  createdAt: invitations.createdAt,
  invitedBy: invitations.invitedBy,
};

/** Members, invitations, tenant switching. Every method runs inside the caller's withContext. */
@Injectable()
export class TenancyRepository {
  constructor(private readonly database: Database) {}

  // --- context-free (SECURITY DEFINER, migration 0005) ---

  /** id + verified state of the account for `email` (expired unverified ones count as absent). */
  async findUserByEmail(email: string): Promise<{ id: string; verified: boolean } | undefined> {
    const [row] = await this.database.db.execute<{ id: string; email_verified_at: unknown }>(
      sql`select id, email_verified_at from auth_find_user_by_email(${email})`,
    );
    return row ? { id: row.id, verified: row.email_verified_at !== null } : undefined;
  }

  async discardUnverifiedByEmail(email: string): Promise<boolean> {
    const [row] = await this.database.db.execute<{ ok: boolean }>(
      sql`select auth_discard_unverified_by_email(${email}) as ok`,
    );
    return row?.ok ?? false;
  }

  // --- members (tenant context) ---

  /**
   * Page of members ordered by (joined_at, membership id). `afterMembershipId` is the last row of the
   * previous page; the comparison uses that row's exact DB values (JS Dates would lose microseconds).
   */
  async listMembers(
    tx: Tx,
    page: { limit: number; afterMembershipId?: string },
  ): Promise<MemberRow[]> {
    const after = page.afterMembershipId;
    return tx
      .select(memberColumns)
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        after
          ? sql`(${memberships.createdAt}, ${memberships.id}) > (select m.created_at, m.id from memberships m where m.id = ${after})`
          : undefined,
      )
      .orderBy(asc(memberships.createdAt), asc(memberships.id))
      .limit(page.limit);
  }

  async getMember(tx: Tx, userId: string): Promise<MemberRow | undefined> {
    const [row] = await tx
      .select(memberColumns)
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.userId, userId));
    return row;
  }

  async findMemberByEmail(tx: Tx, email: string): Promise<MemberRow | undefined> {
    const [row] = await tx
      .select(memberColumns)
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(users.email, email));
    return row;
  }

  /**
   * Locks the tenant's active owner memberships (FOR UPDATE) and returns their user ids, so two
   * concurrent demotions can't both see "another owner exists" and leave none.
   */
  async lockActiveOwners(tx: Tx): Promise<string[]> {
    const rows = await tx
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.role, 'owner'), eq(memberships.status, 'active')))
      .for('update');
    return rows.map((r) => r.userId);
  }

  async updateMember(
    tx: Tx,
    userId: string,
    patch: { role?: Role; status?: 'active' | 'disabled' },
  ): Promise<void> {
    await tx.update(memberships).set(patch).where(eq(memberships.userId, userId));
  }

  /** Adds the user to the context tenant, or reactivates a disabled membership with `role`. */
  async upsertMembership(tx: Tx, tenantId: string, userId: string, role: Role): Promise<void> {
    await tx
      .insert(memberships)
      .values({ tenantId, userId, role, status: 'active' })
      .onConflictDoUpdate({
        target: [memberships.tenantId, memberships.userId],
        set: { role, status: 'active' },
      });
  }

  async getTenant(tx: Tx, tenantId: string): Promise<{ name: string } | undefined> {
    const [row] = await tx
      .select({ name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    return row;
  }

  // --- invitations (tenant context) ---

  /** Pending = not accepted, not revoked and not expired (M1-T0: expired ones aren't pending). */
  async listPendingInvitations(tx: Tx, now: Date): Promise<InvitationRow[]> {
    return tx
      .select(invitationColumns)
      .from(invitations)
      .where(
        and(
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
          gt(invitations.expiresAt, now),
        ),
      )
      .orderBy(asc(invitations.createdAt));
  }

  /**
   * The open (not accepted, not revoked) invitation for an email — possibly expired. It holds the
   * invitations_open_email_unique slot until it is revoked or superseded.
   */
  async findOpenInvitationByEmail(tx: Tx, email: string): Promise<InvitationRow | undefined> {
    const [row] = await tx
      .select(invitationColumns)
      .from(invitations)
      .where(
        and(
          eq(invitations.email, email),
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
        ),
      );
    return row;
  }

  async getOpenInvitation(tx: Tx, id: string): Promise<InvitationRow | undefined> {
    const [row] = await tx
      .select(invitationColumns)
      .from(invitations)
      .where(
        and(eq(invitations.id, id), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)),
      );
    return row;
  }

  async insertInvitation(
    tx: Tx,
    invitation: {
      tenantId: string;
      email: string;
      role: Role;
      tokenHash: string;
      invitedBy: string;
      expiresAt: Date;
    },
  ): Promise<InvitationRow> {
    const [row] = await tx.insert(invitations).values(invitation).returning(invitationColumns);
    if (!row) throw new Error('invitation insert returned no row');
    return row;
  }

  /** New link + expiry; the old link stops working. */
  async rotateInvitation(tx: Tx, id: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await tx.update(invitations).set({ tokenHash, expiresAt }).where(eq(invitations.id, id));
  }

  async revokeInvitation(tx: Tx, id: string, now: Date): Promise<void> {
    await tx.update(invitations).set({ revokedAt: now }).where(eq(invitations.id, id));
  }

  /** A live (open, unexpired) invitation by token hash, without using it up. */
  async peekInvitation(tx: Tx, tokenHash: string, now: Date): Promise<InvitationRow | undefined> {
    const [row] = await tx
      .select(invitationColumns)
      .from(invitations)
      .where(
        and(
          eq(invitations.tokenHash, tokenHash),
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
          gt(invitations.expiresAt, now),
        ),
      );
    return row;
  }

  /** Atomically marks a live invitation accepted (single use); false if it was not live anymore. */
  async claimInvitation(tx: Tx, id: string, now: Date): Promise<boolean> {
    const rows = await tx
      .update(invitations)
      .set({ acceptedAt: now })
      .where(
        and(
          eq(invitations.id, id),
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
          gt(invitations.expiresAt, now),
        ),
      )
      .returning({ id: invitations.id });
    return rows.length === 1;
  }

  // --- users / sessions ---

  async insertVerifiedUser(
    tx: Tx,
    user: { id: string; email: string; name: string; passwordHash: string; now: Date },
  ): Promise<void> {
    const { now, ...values } = user;
    await tx.insert(users).values({ ...values, emailVerifiedAt: now });
  }

  async getUserName(tx: Tx, userId: string): Promise<string | undefined> {
    const [row] = await tx.select({ name: users.name }).from(users).where(eq(users.id, userId));
    return row?.name;
  }

  async getUserEmail(tx: Tx, userId: string): Promise<string | undefined> {
    const [row] = await tx.select({ email: users.email }).from(users).where(eq(users.id, userId));
    return row?.email;
  }

  /** The user's active memberships of active tenants — needs a user-only context (self_select). */
  async myTenants(tx: Tx): Promise<{ id: string; name: string; slug: string; role: Role }[]> {
    return tx
      .select({ id: tenants.id, name: tenants.name, slug: tenants.slug, role: memberships.role })
      .from(memberships)
      .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
      .where(and(eq(memberships.status, 'active'), eq(tenants.status, 'active')))
      .orderBy(asc(tenants.name));
  }

  async setSessionTenant(tx: Tx, sessionId: string, tenantId: string): Promise<void> {
    await tx.update(sessions).set({ activeTenantId: tenantId }).where(eq(sessions.id, sessionId));
  }
}

/** For callers that shape API responses. */
export function toMember(row: MemberRow): Member {
  return {
    userId: row.userId,
    name: row.name,
    email: row.email,
    role: row.role,
    status: row.status === 'disabled' ? 'disabled' : 'active',
    joinedAt: row.joinedAt.toISOString(),
  };
}
