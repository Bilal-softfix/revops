import { Injectable } from '@nestjs/common';
import {
  type Tx,
  and,
  asc,
  authTokens,
  eq,
  isNull,
  memberships,
  sessions,
  sql,
  tenants,
  users,
} from '@revops/db';
import type { AuthTenant, Role } from '@revops/shared';
import { Database } from '../../platform/database/database';

function pgCode(error: unknown): unknown {
  const e = error as { code?: unknown; cause?: { code?: unknown } };
  return e.code ?? e.cause?.code;
}

export type AuthTokenPurpose = 'email_verify' | 'password_reset';

export interface LoginLookup {
  id: string;
  passwordHash: string | null;
  emailVerifiedAt: Date | null;
}

export interface LiveSession {
  sessionId: string;
  userId: string;
  activeTenantId: string | null;
  lastSeenAt: Date;
}

/** All identity SQL. Context-free lookups use the SECURITY DEFINER functions (migration 0003). */
@Injectable()
export class IdentityRepository {
  constructor(private readonly database: Database) {}

  // --- context-free lookups (SECURITY DEFINER) ---

  async findUserByEmail(email: string): Promise<LoginLookup | undefined> {
    const [row] = await this.database.db.execute<{
      id: string;
      password_hash: string | null;
      email_verified_at: string | null;
    }>(sql`select * from auth_find_user_by_email(${email})`);
    return row
      ? {
          id: row.id,
          passwordHash: row.password_hash,
          emailVerifiedAt: row.email_verified_at ? new Date(row.email_verified_at) : null,
        }
      : undefined;
  }

  async findLiveSession(tokenHash: string): Promise<LiveSession | undefined> {
    const [row] = await this.database.db.execute<{
      session_id: string;
      user_id: string;
      active_tenant_id: string | null;
      last_seen_at: string;
    }>(sql`select * from auth_session_lookup(${tokenHash})`);
    return row
      ? {
          sessionId: row.session_id,
          userId: row.user_id,
          activeTenantId: row.active_tenant_id,
          lastSeenAt: new Date(row.last_seen_at),
        }
      : undefined;
  }

  /**
   * Verifies the user's email if `tokenHash` is a live verify link of theirs and the account is
   * still unverified and unexpired — one transaction (no race with a concurrent discard).
   */
  async verifyEmail(tokenHash: string, userId: string): Promise<boolean> {
    const [row] = await this.database.db.execute<{ ok: boolean }>(
      sql`select auth_verify_email(${tokenHash}, ${userId}::uuid) as ok`,
    );
    return row?.ok ?? false;
  }

  /**
   * Consumes a reset link and, in the same transaction, sets the password, marks the email
   * verified, revokes every session and spends every other link. Returns the user id, or null if
   * the link isn't live (incl. losing a race for it).
   */
  async resetPassword(tokenHash: string, passwordHash: string): Promise<string | null> {
    try {
      const [row] = await this.database.db.execute<{ user_id: string | null }>(
        sql`select auth_reset_password(${tokenHash}, ${passwordHash}) as user_id`,
      );
      return row?.user_id ?? null;
    } catch (error) {
      if (pgCode(error) === 'P0001') return null; // link spent by a concurrent reset
      throw error;
    }
  }

  /** Owner + password hash of a live verify token of a live unverified account. Doesn't consume. */
  async peekVerifyToken(
    tokenHash: string,
  ): Promise<{ userId: string; passwordHash: string | null } | undefined> {
    const [row] = await this.database.db.execute<{ user_id: string; password_hash: string | null }>(
      sql`select * from auth_peek_verify_token(${tokenHash})`,
    );
    return row ? { userId: row.user_id, passwordHash: row.password_hash } : undefined;
  }

  /** Deletes the unverified (pending or expired) account for `email`, with its tenant. */
  async discardUnverifiedByEmail(email: string): Promise<boolean> {
    const [row] = await this.database.db.execute<{ ok: boolean }>(
      sql`select auth_discard_unverified_by_email(${email}) as ok`,
    );
    return row?.ok ?? false;
  }

  /** Deletes the unverified account a live verify token belongs to ("this wasn't me"). */
  /**
   * "This wasn't me / start over": discards the unverified account a verify link belongs to and
   * returns its email (lower-cased), or null if the link isn't valid. Atomic (auth_cancel_signup).
   */
  async cancelSignupByToken(tokenHash: string): Promise<string | null> {
    const [row] = await this.database.db.execute<{ email: string | null }>(
      sql`select auth_cancel_signup(${tokenHash}) as email`,
    );
    return row?.email ?? null;
  }

  /** Deletes every unverified account past the 48 h cutoff; returns how many. */
  async purgeExpiredUnverified(): Promise<number> {
    const [row] = await this.database.db.execute<{ n: number }>(
      sql`select auth_purge_expired_unverified() as n`,
    );
    return row?.n ?? 0;
  }

  // --- in-context writes/reads (caller opens withContext) ---

  async insertUser(
    tx: Tx,
    user: { id: string; email: string; name: string; passwordHash: string },
  ): Promise<void> {
    await tx.insert(users).values(user);
  }

  async insertTenant(
    tx: Tx,
    tenant: { id: string; name: string; slug: string; industryTemplate: string },
  ): Promise<void> {
    await tx.insert(tenants).values(tenant);
  }

  async insertMembership(
    tx: Tx,
    membership: { tenantId: string; userId: string; role: Role },
  ): Promise<void> {
    await tx.insert(memberships).values({ ...membership, status: 'active' });
  }

  async insertAuthToken(
    tx: Tx,
    token: { userId: string; purpose: AuthTokenPurpose; tokenHash: string; expiresAt: Date },
  ): Promise<void> {
    await tx.insert(authTokens).values(token);
  }

  async getUser(tx: Tx, userId: string) {
    const [row] = await tx
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        emailVerifiedAt: users.emailVerifiedAt,
      })
      .from(users)
      .where(eq(users.id, userId));
    return row;
  }

  /** Active membership of the context user in the context tenant. */
  async getActiveMembership(
    tx: Tx,
    tenantId: string,
    userId: string,
  ): Promise<AuthTenant | undefined> {
    const [row] = await tx
      .select({ id: tenants.id, name: tenants.name, slug: tenants.slug, role: memberships.role })
      .from(memberships)
      .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
      .where(
        and(
          eq(memberships.tenantId, tenantId),
          eq(memberships.userId, userId),
          eq(memberships.status, 'active'),
          eq(tenants.status, 'active'),
        ),
      );
    return row;
  }

  /** First active membership — needs a user-only context (self_select policies). */
  async firstActiveTenantId(tx: Tx, userId: string): Promise<string | undefined> {
    const [row] = await tx
      .select({ tenantId: memberships.tenantId })
      .from(memberships)
      .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
      .where(
        and(
          eq(memberships.userId, userId),
          eq(memberships.status, 'active'),
          eq(tenants.status, 'active'),
        ),
      )
      .orderBy(asc(memberships.createdAt))
      .limit(1);
    return row?.tenantId;
  }

  async insertSession(
    tx: Tx,
    session: {
      userId: string;
      tokenHash: string;
      activeTenantId: string | null;
      ip: string | null;
      userAgent: string | null;
      now: Date;
      expiresAt: Date;
    },
  ): Promise<string> {
    const { now, ...values } = session;
    const [row] = await tx
      .insert(sessions)
      .values({ ...values, createdAt: now, lastSeenAt: now })
      .returning({ id: sessions.id });
    if (!row) throw new Error('session insert returned no row');
    return row.id;
  }

  async touchSession(tx: Tx, sessionId: string, now: Date): Promise<void> {
    await tx.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, sessionId));
  }

  async revokeSession(tx: Tx, sessionId: string, now: Date): Promise<void> {
    await tx
      .update(sessions)
      .set({ revokedAt: now })
      .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
  }
}
