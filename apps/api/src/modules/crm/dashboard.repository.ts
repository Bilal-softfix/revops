import { Injectable } from '@nestjs/common';
import {
  type SQL,
  type Tx,
  and,
  contacts,
  desc,
  eq,
  isNull,
  leadSources,
  leads,
  pipelineStages,
  sql,
} from '@revops/db';
import type { LeadScope } from './leads.repository';

/** Dashboard aggregates (tenant transaction; RLS scopes the tenant, `scope` the owner). */
@Injectable()
export class DashboardRepository {
  private visible(scope: LeadScope): SQL | undefined {
    return and(
      isNull(leads.deletedAt),
      scope.all ? undefined : eq(leads.ownerUserId, scope.userId),
    );
  }

  /** Lead counts in one pass. Dates are ISO strings (raw sql params aren't serialised from Date). */
  async counts(
    tx: Tx,
    scope: LeadScope,
    bounds: { startOfToday: Date; startOf7Days: Date; since30Days: Date },
  ) {
    const today = bounds.startOfToday.toISOString();
    const week = bounds.startOf7Days.toISOString();
    const month = bounds.since30Days.toISOString();
    const [row] = await tx
      .select({
        total: sql<number>`count(*)::int`,
        today: sql<number>`count(*) filter (where ${leads.createdAt} >= ${today})::int`,
        last7Days: sql<number>`count(*) filter (where ${leads.createdAt} >= ${week})::int`,
        open: sql<number>`count(*) filter (where ${leads.status} = 'open')::int`,
        won30: sql<number>`count(*) filter (where ${leads.status} = 'won' and ${leads.wonAt} >= ${month})::int`,
      })
      .from(leads)
      .where(this.visible(scope));
    return row ?? { total: 0, today: 0, last7Days: 0, open: 0, won30: 0 };
  }

  /** Leads created since `since`, per source (null = no source). */
  bySource(tx: Tx, scope: LeadScope, since: Date) {
    return tx
      .select({
        sourceId: leads.sourceId,
        name: leadSources.name,
        count: sql<number>`count(*)::int`,
      })
      .from(leads)
      .leftJoin(leadSources, eq(leadSources.id, leads.sourceId))
      .where(and(this.visible(scope), sql`${leads.createdAt} >= ${since.toISOString()}`))
      .groupBy(leads.sourceId, leadSources.name);
  }

  recent(tx: Tx, scope: LeadScope, limit: number) {
    return tx
      .select({
        id: leads.id,
        contactName: contacts.name,
        sourceName: leadSources.name,
        stageName: pipelineStages.name,
        status: leads.status,
        createdAt: leads.createdAt,
      })
      .from(leads)
      .innerJoin(contacts, eq(contacts.id, leads.contactId))
      .innerJoin(pipelineStages, eq(pipelineStages.id, leads.stageId))
      .leftJoin(leadSources, eq(leadSources.id, leads.sourceId))
      .where(this.visible(scope))
      .orderBy(desc(leads.createdAt), desc(leads.id))
      .limit(limit);
  }
}
