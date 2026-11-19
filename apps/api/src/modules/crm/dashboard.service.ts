import { Injectable } from '@nestjs/common';
import {
  DASHBOARD_RECENT_LEADS,
  DASHBOARD_WINDOW_DAYS,
  DEFAULT_TIMEZONE,
  type DashboardSummary,
  dayBounds,
  topSources,
} from '@revops/shared';
import { Clock } from '../../platform/clock';
import { ActivitiesRepository } from './activities.repository';
import { type CrmAuth, CrmService } from './crm.service';
import { DashboardRepository } from './dashboard.repository';
import { LeadsService } from './leads.service';

const DAY = 24 * 3600_000;

/**
 * Dashboard summary (UI refresh): lead counts, leads by source, recent leads and my task counts,
 * in one tenant transaction. Visibility is the leads list's (`LeadsService.scope`); task counts are
 * the caller's own, exactly as on My tasks. Days are tenant-local (Asia/Kolkata until tenants
 * choose a timezone).
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly crm: CrmService,
    private readonly repository: DashboardRepository,
    private readonly activities: ActivitiesRepository,
    private readonly leads: LeadsService,
    private readonly clock: Clock,
  ) {}

  summary(auth: CrmAuth): Promise<DashboardSummary> {
    const scope = this.leads.scope(auth);
    const now = this.clock.now();
    const { startOfToday, startOfTomorrow } = dayBounds(now, DEFAULT_TIMEZONE);
    const startOf7Days = dayBounds(
      new Date(now.getTime() - 6 * DAY),
      DEFAULT_TIMEZONE,
    ).startOfToday;
    const since30Days = dayBounds(
      new Date(now.getTime() - (DASHBOARD_WINDOW_DAYS - 1) * DAY),
      DEFAULT_TIMEZONE,
    ).startOfToday;
    return this.crm.withCrm(auth, async (tx) => {
      const counts = await this.repository.counts(tx, scope, {
        startOfToday,
        startOf7Days,
        since30Days,
      });
      const sources = await this.repository.bySource(tx, scope, since30Days);
      const recent = await this.repository.recent(tx, scope, DASHBOARD_RECENT_LEADS);
      const tasks = await this.activities.myTaskCounts(tx, scope, auth.userId, {
        now,
        startOfTomorrow,
      });
      return {
        scope: scope.all ? 'all' : 'mine',
        newLeads: { today: counts.today, last7Days: counts.last7Days },
        openLeads: counts.open,
        wonLast30Days: counts.won30,
        totalLeads: counts.total,
        tasks: { overdue: tasks.overdue, today: tasks.today },
        bySource: topSources(sources),
        recentLeads: recent.map((r) => ({
          id: r.id,
          contactName: r.contactName,
          sourceName: r.sourceName,
          stageName: r.stageName,
          status: r.status,
          createdAt: r.createdAt.toISOString(),
        })),
      };
    });
  }
}
