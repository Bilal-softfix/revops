import { Injectable } from '@nestjs/common';
import {
  type SQL,
  type Tx,
  and,
  asc,
  contacts,
  desc,
  eq,
  inArray,
  isNull,
  leadSources,
  leads,
  memberships,
  or,
  pipelineStages,
  pipelines,
  sql,
  users,
} from '@revops/db';
import type { CustomFieldDef, LeadFilters, Role, StageCategory } from '@revops/shared';

/**
 * Which leads a member may see — built in ONE place and applied to every lead query (M1-T4).
 * `lead.read.all` roles: every lead. Others: leads they own (unassigned leads are invisible).
 */
export type LeadScope = { all: true } | { all: false; userId: string };

export type LeadRow = typeof leads.$inferSelect;

/** A lead row with what its API shape needs from other tables. */
export interface LeadRecord {
  lead: LeadRow;
  contact: { id: string; name: string; phoneE164: string | null; email: string | null };
  owner: { id: string; name: string } | null;
  source: { id: string; name: string } | null;
}

export type StageRow = typeof pipelineStages.$inferSelect;

const likeEscape = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);
const json = (value: unknown) => sql`${JSON.stringify(value)}::jsonb`;

/** SQL for leads and saved-view-independent lookups; tenant transaction (RLS) from the caller. */
@Injectable()
export class LeadsRepository {
  private visible(scope: LeadScope): SQL | undefined {
    return scope.all ? undefined : eq(leads.ownerUserId, scope.userId);
  }

  /**
   * WHERE conditions for the shared lead filters. `defs` are the tenant's active lead fields
   * (the service has already checked every custom-field filter against them).
   */
  private filterConditions(
    filters: LeadFilters,
    me: string,
    defs: readonly CustomFieldDef[],
  ): (SQL | undefined)[] {
    const out: (SQL | undefined)[] = [];
    if (filters.pipelineId) out.push(eq(leads.pipelineId, filters.pipelineId));
    if (filters.stageIds) out.push(inArray(leads.stageId, filters.stageIds));
    if (filters.status) out.push(eq(leads.status, filters.status));
    if (filters.owner === 'unassigned') out.push(isNull(leads.ownerUserId));
    else if (filters.owner) {
      out.push(eq(leads.ownerUserId, filters.owner === 'me' ? me : filters.owner));
    }
    if (filters.sourceId) out.push(eq(leads.sourceId, filters.sourceId));
    if (filters.createdFrom) out.push(sql`${leads.createdAt} >= ${filters.createdFrom}`);
    if (filters.createdTo) out.push(sql`${leads.createdAt} < ${filters.createdTo}`);
    if (filters.q) {
      const text = `%${likeEscape(filters.q)}%`;
      const digits = filters.q.replace(/\D/g, '').replace(/^0+/, '');
      out.push(
        or(
          sql`${contacts.name} ilike ${text}`,
          sql`${contacts.email}::text ilike ${text}`,
          digits.length >= 3 ? sql`${contacts.phoneE164} like ${`%${digits}%`}` : undefined,
        ),
      );
    }
    for (const [key, value] of Object.entries(filters.customFields ?? {})) {
      const def = defs.find((d) => d.key === key);
      if (!def) continue;
      const field = sql`${leads.customFields} -> ${key}`;
      const text = sql`${leads.customFields} ->> ${key}`;
      if (typeof value === 'boolean') {
        out.push(sql`${leads.customFields} @> ${json({ [key]: value })}`);
      } else if (typeof value === 'string') {
        if (def.type === 'text') out.push(sql`${text} ilike ${`%${likeEscape(value)}%`}`);
        else if (def.type === 'multiselect') {
          out.push(sql`${leads.customFields} @> ${json({ [key]: [value] })}`);
        } else out.push(sql`${leads.customFields} @> ${json({ [key]: value })}`);
      } else if (Array.isArray(value)) {
        // select: any of; multiselect: has any of.
        out.push(
          or(
            ...value.map((v) =>
              def.type === 'multiselect'
                ? sql`${leads.customFields} @> ${json({ [key]: [v] })}`
                : sql`${leads.customFields} @> ${json({ [key]: v })}`,
            ),
          ),
        );
      } else if (def.type === 'number') {
        const n = sql`(case when jsonb_typeof(${field}) = 'number' then (${text})::numeric end)`;
        if (value.min !== undefined) out.push(sql`${n} >= ${value.min}`);
        if (value.max !== undefined) out.push(sql`${n} <= ${value.max}`);
      } else {
        // date: ISO YYYY-MM-DD strings compare correctly as text.
        if (value.min !== undefined) out.push(sql`${text} >= ${String(value.min)}`);
        if (value.max !== undefined) out.push(sql`${text} <= ${String(value.max)}`);
      }
    }
    return out;
  }

  private baseQuery(tx: Tx) {
    return tx
      .select({
        lead: leads,
        contact: {
          id: contacts.id,
          name: contacts.name,
          phoneE164: contacts.phoneE164,
          email: contacts.email,
        },
        ownerId: users.id,
        ownerName: users.name,
        sourceId: leadSources.id,
        sourceName: leadSources.name,
      })
      .from(leads)
      .innerJoin(contacts, eq(contacts.id, leads.contactId))
      .leftJoin(users, eq(users.id, leads.ownerUserId))
      .leftJoin(leadSources, eq(leadSources.id, leads.sourceId));
  }

  private toRecord(row: {
    lead: LeadRow;
    contact: LeadRecord['contact'];
    ownerId: string | null;
    ownerName: string | null;
    sourceId: string | null;
    sourceName: string | null;
  }): LeadRecord {
    return {
      lead: row.lead,
      contact: row.contact,
      owner: row.ownerId ? { id: row.ownerId, name: row.ownerName ?? '' } : null,
      source: row.sourceId ? { id: row.sourceId, name: row.sourceName ?? '' } : null,
    };
  }

  /** Newest first; keyset cursor on (created_at, id). */
  async list(
    tx: Tx,
    scope: LeadScope,
    me: string,
    filters: LeadFilters,
    defs: readonly CustomFieldDef[],
    page: { limit: number; cursor?: string | undefined },
  ): Promise<LeadRecord[]> {
    const conditions = [
      isNull(leads.deletedAt),
      this.visible(scope),
      ...this.filterConditions(filters, me, defs),
      page.cursor
        ? sql`(${leads.createdAt}, ${leads.id}) < (select l.created_at, l.id from leads l where l.id = ${page.cursor})`
        : undefined,
    ];
    const rows = await this.baseQuery(tx)
      .where(and(...conditions))
      .orderBy(desc(leads.createdAt), desc(leads.id))
      .limit(page.limit);
    return rows.map((r) => this.toRecord(r));
  }

  /** Matching (visible) leads per stage of a pipeline, for the board's column counts. */
  async countByStage(
    tx: Tx,
    scope: LeadScope,
    me: string,
    filters: LeadFilters,
    defs: readonly CustomFieldDef[],
  ): Promise<Map<string, number>> {
    const rows = await tx
      .select({ stageId: leads.stageId, n: sql<number>`count(*)::int` })
      .from(leads)
      .innerJoin(contacts, eq(contacts.id, leads.contactId))
      .where(
        and(
          isNull(leads.deletedAt),
          this.visible(scope),
          ...this.filterConditions(filters, me, defs),
        ),
      )
      .groupBy(leads.stageId);
    return new Map(rows.map((r) => [r.stageId, r.n]));
  }

  async findVisible(tx: Tx, scope: LeadScope, id: string): Promise<LeadRecord | undefined> {
    const [row] = await this.baseQuery(tx).where(
      and(eq(leads.id, id), isNull(leads.deletedAt), this.visible(scope)),
    );
    return row ? this.toRecord(row) : undefined;
  }

  /** Locks a visible lead row for a state change (stage, owner). */
  async lockVisible(tx: Tx, scope: LeadScope, id: string): Promise<LeadRow | undefined> {
    const [row] = await tx
      .select()
      .from(leads)
      .where(and(eq(leads.id, id), isNull(leads.deletedAt), this.visible(scope)))
      .for('update');
    return row;
  }

  /**
   * Locks the visible, non-deleted leads among `ids` for a bulk state change — in id order, so
   * concurrent bulk requests over overlapping selections can't deadlock (M1-T6).
   */
  async lockVisibleMany(tx: Tx, scope: LeadScope, ids: readonly string[]): Promise<LeadRow[]> {
    if (ids.length === 0) return [];
    return tx
      .select()
      .from(leads)
      .where(and(inArray(leads.id, [...ids]), isNull(leads.deletedAt), this.visible(scope)))
      .orderBy(asc(leads.id))
      .for('update');
  }

  async insert(
    tx: Tx,
    values: {
      tenantId: string;
      contactId: string;
      pipelineId: string;
      stageId: string;
      status: StageCategory;
      ownerUserId: string | null;
      sourceId: string | null;
      valuePaise: bigint | null;
      attribution: Record<string, unknown>;
      customFields: Record<string, unknown>;
      wonAt: Date | null;
      lostAt: Date | null;
      lostReason: string | null;
      createdBy: string;
    },
  ): Promise<LeadRow> {
    const [row] = await tx.insert(leads).values(values).returning();
    if (!row) throw new Error('lead insert returned nothing');
    return row;
  }

  async update(
    tx: Tx,
    id: string,
    patch: Partial<
      Pick<
        LeadRow,
        | 'ownerUserId'
        | 'sourceId'
        | 'valuePaise'
        | 'attribution'
        | 'pipelineId'
        | 'stageId'
        | 'status'
        | 'wonAt'
        | 'lostAt'
        | 'lostReason'
      >
    >,
    customFields: Record<string, unknown> = {},
  ): Promise<void> {
    // Custom fields merge in SQL (no lost update); null in the patch removes the key.
    const set = Object.fromEntries(Object.entries(customFields).filter(([, v]) => v !== null));
    const clear = Object.keys(customFields).filter((k) => customFields[k] === null);
    const merged =
      clear.length > 0
        ? sql`(${leads.customFields} || ${json(set)}) - array[${sql.join(
            clear.map((key) => sql`${key}`),
            sql`, `,
          )}]::text[]`
        : sql`${leads.customFields} || ${json(set)}`;
    await tx
      .update(leads)
      .set({
        ...patch,
        ...(Object.keys(customFields).length > 0 ? { customFields: merged } : {}),
        updatedAt: new Date(),
      })
      .where(eq(leads.id, id));
  }

  /** The same patch on many leads (bulk actions); one statement. */
  async updateMany(
    tx: Tx,
    ids: readonly string[],
    patch: Partial<
      Pick<
        LeadRow,
        'ownerUserId' | 'pipelineId' | 'stageId' | 'status' | 'wonAt' | 'lostAt' | 'lostReason'
      >
    >,
  ): Promise<void> {
    if (ids.length === 0) return;
    await tx
      .update(leads)
      .set({ ...patch, updatedAt: new Date() })
      .where(inArray(leads.id, [...ids]));
  }

  async softDelete(tx: Tx, id: string, now: Date): Promise<void> {
    await tx.update(leads).set({ deletedAt: now, updatedAt: now }).where(eq(leads.id, id));
  }

  // ---- lookups the service validates against (all RLS-scoped to the tenant) ----

  /**
   * An active pipeline (by id, else the default). `lock: true` takes FOR SHARE on its row before
   * a lead is written into it: pipeline and stage deletes hold FOR UPDATE on that row, so either
   * the delete waits for the write (and then sees the lead), or the write waits and then finds
   * the pipeline gone (deleted_at is re-checked after the wait). Lead writes take this lock
   * BEFORE locking lead rows — the order the deletes use — so the two can't deadlock.
   */
  async activePipeline(
    tx: Tx,
    id: string | undefined,
    options: { lock?: boolean } = {},
  ): Promise<{ id: string; name: string } | undefined> {
    const query = tx
      .select({ id: pipelines.id, name: pipelines.name })
      .from(pipelines)
      .where(
        and(isNull(pipelines.deletedAt), id ? eq(pipelines.id, id) : eq(pipelines.isDefault, true)),
      )
      .limit(1);
    const [row] = options.lock ? await query.for('share') : await query;
    return row;
  }

  async stagesOf(tx: Tx, pipelineId: string): Promise<StageRow[]> {
    return tx
      .select()
      .from(pipelineStages)
      .where(eq(pipelineStages.pipelineId, pipelineId))
      .orderBy(asc(pipelineStages.position), asc(pipelineStages.createdAt));
  }

  /** A stage of an active (non-deleted) pipeline, by id. */
  async activeStage(tx: Tx, id: string): Promise<StageRow | undefined> {
    const [row] = await tx
      .select({ stage: pipelineStages })
      .from(pipelineStages)
      .innerJoin(pipelines, eq(pipelines.id, pipelineStages.pipelineId))
      .where(and(eq(pipelineStages.id, id), isNull(pipelines.deletedAt)))
      .limit(1);
    return row?.stage;
  }

  async pipelineName(tx: Tx, id: string): Promise<string> {
    const [row] = await tx
      .select({ name: pipelines.name })
      .from(pipelines)
      .where(eq(pipelines.id, id));
    return row?.name ?? '';
  }

  /** id → name for stages (timeline snapshots). */
  async stageNames(tx: Tx, ids: readonly string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await tx
      .select({ id: pipelineStages.id, name: pipelineStages.name })
      .from(pipelineStages)
      .where(inArray(pipelineStages.id, [...ids]));
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  /** id → name for pipelines (timeline snapshots). */
  async pipelineNames(tx: Tx, ids: readonly string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await tx
      .select({ id: pipelines.id, name: pipelines.name })
      .from(pipelines)
      .where(inArray(pipelines.id, [...ids]));
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  /** The member's role if they are an active member of this tenant. */
  async activeMemberRole(tx: Tx, userId: string): Promise<Role | undefined> {
    const [row] = await tx
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.status, 'active')))
      .limit(1);
    return row?.role;
  }

  /** id → name for users (timeline snapshots). */
  async userNames(tx: Tx, ids: readonly string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await tx
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, [...ids]));
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  async isActiveMember(tx: Tx, userId: string): Promise<boolean> {
    const [row] = await tx
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.status, 'active')))
      .limit(1);
    return Boolean(row);
  }

  async sourceExists(tx: Tx, id: string): Promise<boolean> {
    const [row] = await tx
      .select({ id: leadSources.id })
      .from(leadSources)
      .where(eq(leadSources.id, id))
      .limit(1);
    return Boolean(row);
  }
}
