'use client';

import type { Lead, LeadBoard as Board, LeadFilters, Pipeline } from '@revops/shared';
import { formatPhone } from '@revops/shared';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { SimpleSelect } from '@/components/form/simple-select';
import { ErrorState, LoadingState } from '@/components/states/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/api/messages';
import { formatPaise } from '@/lib/money';
import { cn } from '@/lib/utils';
import { leadStrings as s } from '@/lib/strings/leads';
import { fetchStagePage, useLeadBoard } from './queries';
import { useStageChange } from './use-stage-change';

const DRAG_TYPE = 'application/x-revops-lead';

/**
 * Kanban for one pipeline: a column per stage with its count. Drag a card onto a column to move
 * it (native HTML5 drag and drop: no extra dependency); every card also has a "Move to" select,
 * so the same move works with a keyboard or on touch screens.
 */
const CATEGORY_DOT = {
  open: 'bg-info',
  won: 'bg-success',
  lost: 'bg-muted-foreground/50',
} as const;

/** "Asha Verma" → "AV". */
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || '?';

export function LeadBoard({ pipeline, filters }: { pipeline: Pipeline; filters: LeadFilters }) {
  const board = useLeadBoard({ ...filters, pipelineId: pipeline.id });
  const { change, dialog } = useStageChange();
  const [over, setOver] = useState<string | null>(null);
  // Extra pages loaded per column ("Load more"), reset when the board refetches.
  const [more, setMore] = useState<Record<string, { items: Lead[]; cursor: string | null }>>({});
  const [loadedFor, setLoadedFor] = useState<Board | undefined>(undefined);
  if (board.data !== loadedFor) {
    setLoadedFor(board.data);
    setMore({});
  }

  if (board.isPending) return <LoadingState rows={6} />;
  if (board.isError) return <ErrorState error={board.error} onRetry={() => void board.refetch()} />;

  const byId = new Map<string, Lead>();
  for (const column of board.data.columns) {
    for (const lead of [...column.items, ...(more[column.stageId]?.items ?? [])]) {
      byId.set(lead.id, lead);
    }
  }
  const move = (lead: Lead, stageId: string) => {
    const stage = pipeline.stages.find((x) => x.id === stageId);
    if (stage) void change(lead, pipeline, stage);
  };

  return (
    <>
      <div
        className="relative -mx-1 flex min-w-0 gap-4 overflow-x-auto px-1 pb-3"
        data-testid="lead-board"
      >
        {pipeline.stages.map((stage) => {
          const column = board.data.columns.find((c) => c.stageId === stage.id);
          const extra = more[stage.id];
          const items = [...(column?.items ?? []), ...(extra?.items ?? [])];
          const cursor = extra ? extra.cursor : (column?.nextCursor ?? null);
          return (
            <section
              key={stage.id}
              aria-label={stage.name}
              data-testid={`column-${stage.name}`}
              className={cn(
                'relative flex max-h-[calc(100vh-15rem)] min-h-40 w-72 shrink-0 flex-col gap-2 overflow-y-auto rounded-xl border bg-muted/50 p-2.5',
                over === stage.id && 'bg-accent/60 ring-2 ring-primary',
              )}
              onDragOver={(event) => {
                if (event.dataTransfer.types.includes(DRAG_TYPE)) {
                  event.preventDefault();
                  setOver(stage.id);
                }
              }}
              onDragLeave={() => setOver((current) => (current === stage.id ? null : current))}
              onDrop={(event) => {
                event.preventDefault();
                setOver(null);
                const lead = byId.get(event.dataTransfer.getData(DRAG_TYPE));
                if (lead) move(lead, stage.id);
              }}
            >
              <header className="sticky -top-2.5 z-10 -mx-2.5 -mt-2.5 flex items-center justify-between gap-2 rounded-t-xl bg-muted/95 px-3.5 pt-3 pb-2 backdrop-blur">
                <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                  <span
                    aria-hidden
                    className={cn('size-2 shrink-0 rounded-full', CATEGORY_DOT[stage.category])}
                  />
                  <span className="truncate">{stage.name}</span>
                </h3>
                <Badge variant="muted">{s.board.count(column?.count ?? 0)}</Badge>
              </header>
              {items.map((lead) => (
                <article
                  key={lead.id}
                  draggable
                  data-testid={`card-${lead.contact.name}`}
                  onDragStart={(event) => {
                    event.dataTransfer.setData(DRAG_TYPE, lead.id);
                    event.dataTransfer.effectAllowed = 'move';
                  }}
                  className="relative grid cursor-grab gap-2 rounded-lg border bg-card p-3 text-sm shadow-card transition-shadow hover:shadow-raised active:cursor-grabbing"
                >
                  <div className="flex items-start gap-2.5">
                    <span
                      aria-hidden
                      className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary"
                    >
                      {initials(lead.contact.name)}
                    </span>
                    <div className="grid min-w-0 flex-1">
                      <Link
                        href={`/leads/${lead.id}`}
                        className="truncate font-medium hover:text-primary"
                      >
                        {lead.contact.name}
                      </Link>
                      <span className="truncate text-xs text-muted-foreground">
                        {formatPhone(lead.contact.phoneE164) || lead.contact.email}
                      </span>
                    </div>
                    {lead.valuePaise !== null ? (
                      <span className="text-xs font-semibold tabular-nums">
                        {formatPaise(lead.valuePaise)}
                      </span>
                    ) : null}
                  </div>
                  <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span className="truncate">{lead.owner?.name ?? s.unassigned}</span>
                    {lead.source ? (
                      <span className="truncate rounded bg-muted px-1.5 py-0.5">
                        {lead.source.name}
                      </span>
                    ) : null}
                  </span>
                  <SimpleSelect
                    label={s.board.moveTo(lead.contact.name)}
                    hideLabel
                    value={lead.stageId}
                    options={pipeline.stages.map((x) => ({ value: x.id, label: x.name }))}
                    onChange={(stageId) => move(lead, stageId)}
                  />
                </article>
              ))}
              {cursor ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    void fetchStagePage({ ...filters, pipelineId: pipeline.id }, stage.id, cursor)
                      .then((page) =>
                        setMore((all) => ({
                          ...all,
                          [stage.id]: {
                            items: [...(all[stage.id]?.items ?? []), ...page.items],
                            cursor: page.nextCursor,
                          },
                        })),
                      )
                      .catch((error: unknown) => toast.error(errorMessage(error)))
                  }
                >
                  {s.loadMore}
                </Button>
              ) : null}
            </section>
          );
        })}
      </div>
      {dialog}
    </>
  );
}
