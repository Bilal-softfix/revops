'use client';

import {
  type LeadFilters,
  type Member,
  type Pipeline,
  customFieldsForPipeline,
  formatPhone,
} from '@revops/shared';
import { KanbanSquare, List, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { SimpleSelect } from '@/components/form/simple-select';
import { PageHeader } from '@/components/layout/page-header';
import { FormError, TextField } from '@/components/form/text-field';
import { EmptyState, ErrorState, LoadingState } from '@/components/states/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useCustomFields } from '@/features/custom-fields/queries';
import { usePipelines } from '@/features/pipelines/queries';
import { useMembers } from '@/features/team/queries';
import { errorMessage } from '@/lib/api/messages';
import { formatDate } from '@/lib/format';
import { type LeadLayout, filtersFromParams, paramsFromFilters } from '@/lib/lead-filters';
import { formatPaise } from '@/lib/money';
import { useSession } from '@/lib/session';
import { common } from '@/lib/strings/common';
import { leadStrings as s } from '@/lib/strings/leads';
import { BulkActionBar } from './bulk-actions';
import { ExportLeadsButton } from './export-button';
import { LeadBoard } from './lead-board';
import { LeadFiltersBar } from './lead-filters';
import { LeadForm } from './lead-form';
import {
  useCreateLeadView,
  useDeleteLeadView,
  useLeadSources,
  useLeadViews,
  useLeads,
} from './queries';

/** Order-insensitive comparison of two filter objects. */
function sameFilters(a: LeadFilters, b: LeadFilters): boolean {
  const canon = (value: unknown): unknown =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value)
            .filter(([, v]) => v !== undefined)
            .sort(([x], [y]) => x.localeCompare(y))
            .map(([k, v]) => [k, canon(v)]),
        )
      : value;
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b));
}

const categoryVariant = { open: 'info', won: 'success', lost: 'muted' } as const;

/** "Asha Verma" → "AV". */
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || '?';

/** Leads (M1-T4): list or board, filters in the URL, private saved views, new lead. */
export function LeadsView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { filters, layout } = filtersFromParams(new URLSearchParams(searchParams.toString()));
  const { can } = useSession();
  const pipelines = usePipelines();
  const sources = useLeadSources().data?.items ?? [];
  const members = (useMembers().data?.pages.flatMap((p) => p.items) ?? []).filter(
    (m) => m.status === 'active',
  );
  const allDefs = useCustomFields('lead').data?.items ?? [];
  // `?new=1` (the header's quick "Add lead") opens the form once, then leaves the URL clean.
  const [creating, setCreating] = useState(() => searchParams.get('new') === '1');
  useEffect(() => {
    if (searchParams.get('new') !== '1') return;
    const rest = new URLSearchParams(searchParams.toString());
    rest.delete('new');
    const query = rest.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }, [searchParams, router, pathname]);

  const navigate = (next: LeadFilters, nextLayout: LeadLayout = layout) => {
    const query = paramsFromFilters(next, nextLayout);
    router.replace(query ? `${pathname}?${query}` : pathname);
  };

  if (pipelines.isPending) return <LoadingState rows={8} />;
  if (pipelines.isError) {
    return <ErrorState error={pipelines.error} onRetry={() => void pipelines.refetch()} />;
  }
  const items = pipelines.data.items;
  const boardPipeline =
    items.find((p) => p.id === filters.pipelineId) ?? items.find((p) => p.isDefault) ?? items[0];
  const filterPipelineId = layout === 'board' ? boardPipeline?.id : filters.pipelineId;
  const defs = filterPipelineId ? customFieldsForPipeline(allDefs, filterPipelineId) : allDefs;
  const effective: LeadFilters =
    layout === 'board' ? { ...filters, pipelineId: boardPipeline?.id } : filters;

  return (
    <div className="grid min-w-0 gap-6">
      <PageHeader
        title={s.title}
        description={s.description}
        actions={
          <>
            <div
              role="group"
              aria-label={s.layoutLabel}
              className="flex rounded-lg border bg-muted/60 p-0.5"
            >
              {(['list', 'board'] as const).map((l) => {
                const Icon = l === 'list' ? List : KanbanSquare;
                return (
                  <Button
                    key={l}
                    variant="ghost"
                    size="sm"
                    aria-pressed={layout === l}
                    className={
                      layout === l
                        ? 'bg-card text-foreground shadow-card hover:bg-card'
                        : 'text-muted-foreground'
                    }
                    onClick={() => navigate(filters, l)}
                  >
                    <Icon aria-hidden />
                    {s.layouts[l]}
                  </Button>
                );
              })}
            </div>
            <SavedViews filters={filters} layout={layout} onApply={(f, l) => navigate(f, l)} />
            <ExportLeadsButton filters={effective} />
            {can('lead.write') ? (
              <Button onClick={() => setCreating(true)}>
                <Plus aria-hidden />
                {s.new}
              </Button>
            ) : null}
          </>
        }
      />
      <LeadFiltersBar
        filters={effective}
        onChange={(f) => navigate(f)}
        pipelines={items}
        sources={sources}
        members={members}
        defs={defs}
        canSeeAll={can('lead.read.all')}
        showStage={layout === 'list'}
      />
      {layout === 'board' && boardPipeline ? (
        <LeadBoard pipeline={boardPipeline} filters={effective} />
      ) : (
        <LeadList
          // A new filter set starts with an empty selection.
          key={JSON.stringify(filters)}
          filters={filters}
          pipelines={items}
          members={members}
          canBulk={can('lead.bulk')}
        />
      )}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{s.createTitle}</DialogTitle>
            <DialogDescription>{s.description}</DialogDescription>
          </DialogHeader>
          {creating ? (
            <LeadForm
              pipelines={items}
              initialPipelineId={filterPipelineId}
              onCancel={() => setCreating(false)}
              onCreated={(lead) => {
                toast.success(s.created(lead.contact.name));
                setCreating(false);
                router.push(`/leads/${lead.id}`);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LeadList({
  filters,
  pipelines,
  members,
  canBulk,
}: {
  filters: LeadFilters;
  pipelines: readonly Pipeline[];
  members: readonly Member[];
  /** Row checkboxes + the bulk action bar (M1-T6). */
  canBulk: boolean;
}) {
  const leads = useLeads(filters);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  if (leads.isPending) return <LoadingState rows={8} />;
  if (leads.isError) return <ErrorState error={leads.error} onRetry={() => void leads.refetch()} />;
  const rows = leads.data.pages.flatMap((p) => p.items);
  if (rows.length === 0) {
    return <EmptyState title={Object.keys(filters).length > 0 ? s.empty : s.emptyAll} />;
  }
  const stageName = (pipelineId: string, stageId: string) =>
    pipelines.find((p) => p.id === pipelineId)?.stages.find((x) => x.id === stageId)?.name ?? '—';
  // Only leads still on screen count as selected (a refetch may drop some).
  const selected = rows.filter((l) => picked.has(l.id));
  const allPicked = selected.length === rows.length;
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const pipelineIds = new Set(selected.map((l) => l.pipelineId));
  return (
    <div className="grid gap-3">
      {canBulk ? (
        <BulkActionBar
          selectedIds={selected.map((l) => l.id)}
          pipelines={pipelines}
          members={members}
          defaultPipelineId={pipelineIds.size === 1 ? [...pipelineIds][0] : undefined}
          onDone={() => setPicked(new Set())}
        />
      ) : null}
      <div className="overflow-x-auto rounded-xl border bg-card shadow-card">
        <Table>
          <TableHeader>
            <TableRow>
              {canBulk ? (
                <TableHead className="w-10">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    aria-label={s.bulk.selectAll}
                    checked={allPicked}
                    ref={(el) => {
                      if (el) el.indeterminate = selected.length > 0 && !allPicked;
                    }}
                    onChange={() =>
                      setPicked(allPicked ? new Set() : new Set(rows.map((l) => l.id)))
                    }
                  />
                </TableHead>
              ) : null}
              <TableHead>{s.columns.contact}</TableHead>
              <TableHead>{s.columns.stage}</TableHead>
              <TableHead>{s.columns.owner}</TableHead>
              <TableHead>{s.columns.source}</TableHead>
              <TableHead className="text-right">{s.columns.value}</TableHead>
              <TableHead>{s.columns.created}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((lead) => (
              <TableRow
                key={lead.id}
                data-testid={`lead-${lead.contact.name}`}
                data-state={picked.has(lead.id) ? 'selected' : undefined}
              >
                {canBulk ? (
                  <TableCell>
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      aria-label={s.bulk.select(lead.contact.name)}
                      checked={picked.has(lead.id)}
                      onChange={() => toggle(lead.id)}
                    />
                  </TableCell>
                ) : null}
                <TableCell>
                  <div className="flex items-center gap-3">
                    <span
                      aria-hidden
                      className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary"
                    >
                      {initials(lead.contact.name)}
                    </span>
                    <div className="grid">
                      <Link
                        href={`/leads/${lead.id}`}
                        className="font-medium hover:text-primary hover:underline"
                      >
                        {lead.contact.name}
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        {formatPhone(lead.contact.phoneE164) || lead.contact.email}
                      </span>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={categoryVariant[lead.status]}>
                    {stageName(lead.pipelineId, lead.stageId)}
                  </Badge>
                </TableCell>
                <TableCell className={lead.owner ? undefined : 'text-muted-foreground'}>
                  {lead.owner?.name ?? s.unassigned}
                </TableCell>
                <TableCell>{lead.source?.name ?? s.noSource}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {formatPaise(lead.valuePaise)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDate(lead.createdAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {leads.hasNextPage ? (
        <div>
          <Button
            variant="outline"
            disabled={leads.isFetchingNextPage}
            onClick={() => void leads.fetchNextPage()}
          >
            {s.loadMore}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function SavedViews({
  filters,
  layout,
  onApply,
}: {
  filters: LeadFilters;
  layout: LeadLayout;
  onApply: (filters: LeadFilters, layout: LeadLayout) => void;
}) {
  const views = useLeadViews();
  const create = useCreateLeadView();
  const remove = useDeleteLeadView();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const items = views.data?.items ?? [];
  // The view whose filters are on screen (none once the filters change), so re-picking a view
  // after clearing filters applies it again.
  const current = items.find((v) => v.layout === layout && sameFilters(v.filters, filters));
  const selected = current?.id ?? '';

  return (
    <div className="flex items-end gap-1">
      <SimpleSelect
        label={s.views.label}
        hideLabel
        className="w-48"
        value={selected}
        noneLabel={s.views.none}
        options={items.map((v) => ({ value: v.id, label: v.name }))}
        onChange={(id) => {
          const view = items.find((v) => v.id === id);
          if (view) onApply(view.filters, view.layout);
        }}
      />
      {current ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={s.views.delete(current.name)}
          onClick={() =>
            void remove
              .mutateAsync(current.id)
              .then(() => toast.success(s.views.deleted))
              .catch((e: unknown) => toast.error(errorMessage(e)))
          }
        >
          <Trash2 aria-hidden />
        </Button>
      ) : null}
      <Button variant="outline" onClick={() => setSaving(true)}>
        {s.views.save}
      </Button>
      <Dialog open={saving} onOpenChange={setSaving}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{s.views.saveTitle}</DialogTitle>
            <DialogDescription>{s.views.hint}</DialogDescription>
          </DialogHeader>
          <form
            noValidate
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              setError(null);
              create
                .mutateAsync({ name: name.trim(), layout, filters })
                .then((view) => {
                  toast.success(s.views.saved(view.name));
                  setSaving(false);
                  setName('');
                })
                .catch((e: unknown) => setError(errorMessage(e)));
            }}
          >
            <FormError message={error} />
            <TextField
              label={s.views.name}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setSaving(false)}>
                {common.cancel}
              </Button>
              <Button type="submit" disabled={create.isPending || !name.trim()}>
                {s.views.save}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
