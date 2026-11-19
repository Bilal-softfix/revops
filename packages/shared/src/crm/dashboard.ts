import { z } from 'zod';

// Dashboard summary (UI refresh, 2026-11-19): what the signed-in member should see first.
// Role-aware like the leads list: `lead.read.all` roles count every lead, others their own.
// Days are calendar days in the tenant's timezone.

/** Sources shown by name in "Leads by source"; the rest are summed into one "other" row. */
export const DASHBOARD_TOP_SOURCES = 6;
export const DASHBOARD_RECENT_LEADS = 5;
/** Window of "Leads by source" and "Won" (days, including today). */
export const DASHBOARD_WINDOW_DAYS = 30;

export const dashboardSourceRowSchema = z.object({
  /** null = leads without a source; "other" rows have `other: true`. */
  sourceId: z.uuid().nullable(),
  name: z.string().nullable(),
  count: z.number().int(),
  other: z.boolean(),
});
export type DashboardSourceRow = z.infer<typeof dashboardSourceRowSchema>;

export const dashboardRecentLeadSchema = z.object({
  id: z.uuid(),
  contactName: z.string(),
  sourceName: z.string().nullable(),
  stageName: z.string(),
  status: z.enum(['open', 'won', 'lost']),
  createdAt: z.iso.datetime(),
});
export type DashboardRecentLead = z.infer<typeof dashboardRecentLeadSchema>;

export const dashboardSummarySchema = z.object({
  /** Whether the counts cover every lead (owner/admin/manager) or only the caller's. */
  scope: z.enum(['all', 'mine']),
  newLeads: z.object({ today: z.number().int(), last7Days: z.number().int() }),
  openLeads: z.number().int(),
  wonLast30Days: z.number().int(),
  /** Leads in the workspace the caller can see, ever (0 = show "get started"). */
  totalLeads: z.number().int(),
  tasks: z.object({ overdue: z.number().int(), today: z.number().int() }),
  /** Leads created in the last 30 days, by source, largest first. */
  bySource: z.array(dashboardSourceRowSchema),
  recentLeads: z.array(dashboardRecentLeadSchema),
});
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;

/**
 * Top `limit` sources by count (ties by name), the rest summed into one `other` row (only when
 * there is a rest). Input order doesn't matter.
 */
export function topSources(
  rows: readonly { sourceId: string | null; name: string | null; count: number }[],
  limit: number = DASHBOARD_TOP_SOURCES,
): DashboardSourceRow[] {
  const sorted = [...rows]
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count || (a.name ?? '').localeCompare(b.name ?? ''));
  const top = sorted.slice(0, limit).map((r) => ({ ...r, other: false }));
  const restCount = sorted.slice(limit).reduce((sum, r) => sum + r.count, 0);
  return restCount > 0
    ? [...top, { sourceId: null, name: null, count: restCount, other: true }]
    : top;
}
