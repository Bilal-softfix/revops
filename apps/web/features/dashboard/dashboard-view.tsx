'use client';

import { type DashboardSummary, hasPermission, leadFiltersToParams } from '@revops/shared';
import {
  AlarmClock,
  ArrowRight,
  FileSpreadsheet,
  Inbox,
  Radio,
  Sparkles,
  Trophy,
  UserPlus,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/layout/page-header';
import { SectionCard } from '@/components/layout/section-card';
import { StatCard } from '@/components/layout/stat-card';
import { ErrorState, LoadingState } from '@/components/states/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useSession } from '@/lib/session';
import { shellStrings } from '@/lib/strings/shell';
import { barPercent, greeting, initials, longDate, timeAgo } from './dashboard-format';
import { useDashboardSummary } from './queries';

const s = shellStrings.dashboard;
const STATUS_BADGE = { open: 'info', won: 'success', lost: 'muted' } as const;
const BAR_COLOURS = ['bg-chart-1', 'bg-chart-2', 'bg-chart-3', 'bg-chart-4', 'bg-chart-5'];

const leadsHref = (status?: 'open' | 'won') =>
  status ? `/leads?${leadFiltersToParams({ status }).toString()}` : '/leads';

/** Home: greeting, KPI tiles, leads by source, recent leads (and "get started" when empty). */
export function DashboardView() {
  const { session } = useSession();
  const summary = useDashboardSummary();
  const tenant = session.tenant;
  if (!tenant) return null;
  const now = new Date();
  const firstName = session.user.name.split(/\s+/)[0] ?? session.user.name;

  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow={s.greeting(greeting(now), firstName, longDate(now))}
        title={s.title(tenant.name)}
        description={summary.data?.scope === 'mine' ? s.bodyMine : s.bodyAll}
        actions={
          <Button asChild variant="outline">
            <Link href="/leads">
              {s.viewLeads}
              <ArrowRight aria-hidden />
            </Link>
          </Button>
        }
      />
      {summary.isPending ? (
        <LoadingState variant="cards" />
      ) : summary.isError ? (
        <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />
      ) : (
        <DashboardBody data={summary.data} role={tenant.role} now={now} />
      )}
    </div>
  );
}

function DashboardBody({
  data,
  role,
  now,
}: {
  data: DashboardSummary;
  role: Parameters<typeof hasPermission>[0];
  now: Date;
}) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard
          label={s.kpi.newToday}
          value={data.newLeads.today.toLocaleString('en-IN')}
          note={s.kpi.newWeek(data.newLeads.last7Days)}
          icon={Sparkles}
          href={leadsHref()}
        />
        <StatCard
          label={s.kpi.open}
          value={data.openLeads.toLocaleString('en-IN')}
          note={s.kpi.openNote}
          icon={Inbox}
          tone="info"
          href={leadsHref('open')}
        />
        <StatCard
          label={s.kpi.won}
          value={data.wonLast30Days.toLocaleString('en-IN')}
          note={s.kpi.wonNote}
          icon={Trophy}
          tone="success"
          href={leadsHref('won')}
        />
        <StatCard
          label={s.kpi.overdue}
          value={data.tasks.overdue.toLocaleString('en-IN')}
          note={s.kpi.dueToday(data.tasks.today)}
          icon={AlarmClock}
          tone={data.tasks.overdue > 0 ? 'danger' : 'warning'}
          href="/tasks"
        />
      </div>

      {data.totalLeads === 0 ? <GetStarted role={role} /> : null}

      <div className={data.totalLeads === 0 ? 'hidden' : 'grid gap-4 lg:grid-cols-5'}>
        <SectionCard
          className="lg:col-span-2"
          title={s.bySource.title}
          description={s.bySource.description}
        >
          <SourceBars rows={data.bySource} />
        </SectionCard>
        <SectionCard
          className="lg:col-span-3"
          title={s.recent.title}
          description={s.recent.description}
          actions={
            <Button asChild variant="ghost" size="sm">
              <Link href="/leads">
                {s.recent.all}
                <ArrowRight aria-hidden />
              </Link>
            </Button>
          }
          bodyClassName="p-0"
        >
          {data.recentLeads.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">{s.recent.empty}</p>
          ) : (
            <ul className="divide-y">
              {data.recentLeads.map((lead) => (
                <li key={lead.id}>
                  <Link
                    href={`/leads/${lead.id}`}
                    className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-muted/50"
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                      {initials(lead.contactName)}
                    </span>
                    <span className="grid min-w-0 flex-1">
                      <span className="truncate text-sm font-medium">{lead.contactName}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {(lead.sourceName ?? s.recent.noSource) + ' · ' + lead.stageName}
                      </span>
                    </span>
                    <span className="hidden text-xs text-muted-foreground sm:inline">
                      {timeAgo(lead.createdAt, now)}
                    </span>
                    <Badge variant={STATUS_BADGE[lead.status]}>{s.status[lead.status]}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </>
  );
}

function SourceBars({ rows }: { rows: DashboardSummary['bySource'] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{s.bySource.empty}</p>;
  }
  const max = Math.max(...rows.map((r) => r.count));
  return (
    <ul className="grid gap-4">
      {rows.map((row, i) => {
        const name = row.other ? s.bySource.other : (row.name ?? s.bySource.none);
        return (
          <li key={`${row.sourceId ?? 'none'}-${row.other}`} className="grid gap-1.5">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate font-medium">{name}</span>
              <span className="text-muted-foreground tabular-nums">
                {row.count.toLocaleString('en-IN')}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full ${row.other ? 'bg-muted-foreground/40' : BAR_COLOURS[i % BAR_COLOURS.length]}`}
                style={{ width: `${barPercent(row.count, max)}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function GetStarted({ role }: { role: Parameters<typeof hasPermission>[0] }) {
  const steps = [
    hasPermission(role, 'source.manage')
      ? {
          icon: Radio,
          title: s.start.sources,
          body: s.start.sourcesBody,
          href: '/settings/lead-sources',
        }
      : null,
    hasPermission(role, 'source.manage')
      ? {
          icon: FileSpreadsheet,
          title: s.start.import,
          body: s.start.importBody,
          href: '/settings/lead-sources',
        }
      : null,
    hasPermission(role, 'lead.write')
      ? { icon: UserPlus, title: s.start.lead, body: s.start.leadBody, href: '/leads?new=1' }
      : null,
    hasPermission(role, 'member.invite')
      ? { icon: Users, title: s.start.team, body: s.start.teamBody, href: '/settings/team' }
      : null,
  ].filter((step) => step !== null);
  if (steps.length === 0) return null;
  return (
    <SectionCard title={s.start.title} description={s.start.description}>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {steps.map((step) => (
          <li key={step.title}>
            <Link
              href={step.href}
              className="group flex h-full gap-3 rounded-lg border bg-background p-4 transition-colors hover:border-primary/40 hover:bg-accent/40"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                <step.icon className="size-4.5" aria-hidden />
              </span>
              <span className="grid gap-0.5">
                <span className="text-sm font-medium group-hover:text-primary">{step.title}</span>
                <span className="text-xs text-muted-foreground">{step.body}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
