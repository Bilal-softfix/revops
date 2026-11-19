'use client';

import type { TimelineEventType, TimelineItem } from '@revops/shared';
import {
  ArrowRightLeft,
  CheckSquare,
  MessageSquare,
  PhoneCall,
  Repeat,
  Sparkles,
  StickyNote,
  UserCheck,
  type LucideIcon,
  BadgeCheck,
} from 'lucide-react';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { FormError } from '@/components/form/text-field';
import { EmptyState, ErrorState, LoadingState } from '@/components/states/states';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/api/messages';
import { formatDateTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import { activityStrings as s } from '@/lib/strings/activities';
import { useCreateNote, useDeleteNote, useTimeline, useUpdateNote } from './queries';

/** Icon and tint per event type (the timeline's left rail). */
const EVENT_STYLE: Record<TimelineEventType, { icon: LucideIcon; tint: string }> = {
  created: { icon: Sparkles, tint: 'bg-primary/10 text-primary' },
  re_enquiry: { icon: Repeat, tint: 'bg-info/12 text-info-foreground' },
  stage_changed: { icon: ArrowRightLeft, tint: 'bg-secondary text-secondary-foreground' },
  assignment: { icon: UserCheck, tint: 'bg-info/12 text-info-foreground' },
  note: { icon: StickyNote, tint: 'bg-warning/15 text-warning-foreground' },
  task: { icon: CheckSquare, tint: 'bg-success/12 text-success-foreground' },
  call: { icon: PhoneCall, tint: 'bg-success/12 text-success-foreground' },
  message: { icon: MessageSquare, tint: 'bg-info/12 text-info-foreground' },
  qualification: { icon: BadgeCheck, tint: 'bg-primary/10 text-primary' },
};

const textareaClass =
  'min-h-24 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive';

/** Who did it: a member's name, or System / AI assistant. */
function actorName(item: TimelineItem): string {
  if (item.actor.type === 'system') return s.timeline.system;
  if (item.actor.type === 'ai') return s.timeline.ai;
  return item.actor.user?.name || s.timeline.someone;
}

/** What happened, in words (built from the snapshot data, so renamed stages read as they were). */
export function describe(item: TimelineItem): string {
  const d = item.data;
  switch (item.type) {
    case 'created':
      return (
        s.timeline.created(d.pipeline?.name ?? '', d.stage?.name ?? '') +
        (d.source ? s.timeline.viaSource(d.source.name) : '')
      );
    case 're_enquiry':
      return s.timeline.reenquiry + (d.source ? s.timeline.viaSource(d.source.name) : '');
    case 'stage_changed':
      if (d.reason === 'stage_deleted') {
        return s.timeline.stageDeleted(d.fromStage?.name ?? '', d.stage?.name ?? '');
      }
      if (d.fromPipeline && d.pipeline) {
        return s.timeline.pipelineChanged(
          d.fromPipeline.name,
          d.fromStage?.name ?? '',
          d.pipeline.name,
          d.stage?.name ?? '',
        );
      }
      return s.timeline.stageChanged(d.fromStage?.name ?? '', d.stage?.name ?? '');
    case 'assignment':
      if (!d.owner) return s.timeline.unassigned;
      return d.fromOwner
        ? s.timeline.reassigned(d.fromOwner.name, d.owner.name)
        : s.timeline.assigned(d.owner.name);
    case 'note':
      return s.timeline.note;
    case 'task':
      return d.action === 'reopened'
        ? s.timeline.taskReopened(d.title ?? '')
        : s.timeline.taskCompleted(d.title ?? '');
    default:
      return item.summary ?? s.timeline.other;
  }
}

/** The lead's history, newest first, with a note composer on top (M1-T5). */
export function LeadTimeline({ leadId }: { leadId: string }) {
  const timeline = useTimeline(leadId);
  const items = timeline.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <section
      className="grid content-start gap-4 self-start rounded-xl border bg-card p-5 shadow-card"
      aria-labelledby="timeline-heading"
    >
      <h2 id="timeline-heading" className="text-base font-semibold">
        {s.timeline.title}
      </h2>
      <NoteComposer leadId={leadId} />
      {timeline.isPending ? (
        <LoadingState rows={4} />
      ) : timeline.isError ? (
        <ErrorState error={timeline.error} onRetry={() => void timeline.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState title={s.timeline.empty} />
      ) : (
        <ol className="relative grid content-start gap-5 pt-1" aria-label={s.timeline.title}>
          <span aria-hidden className="absolute top-2 bottom-2 left-4 w-px bg-border" />
          {items.map((item) => (
            <TimelineEntry key={item.id} item={item} />
          ))}
        </ol>
      )}
      {timeline.hasNextPage ? (
        <div>
          <Button
            variant="outline"
            size="sm"
            disabled={timeline.isFetchingNextPage}
            onClick={() => void timeline.fetchNextPage()}
          >
            {s.timeline.loadMore}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function TimelineEntry({ item }: { item: TimelineItem }) {
  const style = EVENT_STYLE[item.type] ?? EVENT_STYLE.created;
  return (
    <li className="relative flex gap-3 text-sm" data-type={item.type}>
      <span
        aria-hidden
        className={`relative z-10 grid size-8 shrink-0 place-items-center rounded-full ring-4 ring-card ${style.tint}`}
      >
        <style.icon className="size-4" />
      </span>
      <div className="grid min-w-0 flex-1 gap-1 pt-1">
        <p>
          <span className="font-medium">{actorName(item)}</span> {describe(item)}
        </p>
        {item.data.lostReason ? (
          <p className="text-muted-foreground">{s.timeline.lostReason(item.data.lostReason)}</p>
        ) : null}
        {item.note ? (
          <div className="rounded-lg border bg-muted/40 p-3">
            <NoteBody note={item.note} />
          </div>
        ) : null}
        <time dateTime={item.occurredAt} className="text-xs text-muted-foreground">
          {formatDateTime(item.occurredAt)}
          {item.note?.editedAt ? ` · ${s.timeline.edited}` : ''}
        </time>
      </div>
    </li>
  );
}

function NoteComposer({ leadId }: { leadId: string }) {
  const id = useId();
  const create = useCreateNote();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!body.trim()) return;
        setError(null);
        create.mutate(
          { leadId, body },
          {
            onSuccess: () => {
              setBody('');
              toast.success(s.notes.added);
            },
            onError: (e) => setError(errorMessage(e)),
          },
        );
      }}
    >
      <label htmlFor={id} className="sr-only">
        {s.notes.label}
      </label>
      <FormError message={error} />
      <textarea
        id={id}
        className={textareaClass}
        placeholder={s.notes.placeholder}
        value={body}
        maxLength={10_000}
        onChange={(e) => setBody(e.target.value)}
      />
      <div>
        <Button type="submit" size="sm" disabled={create.isPending || !body.trim()}>
          {s.notes.add}
        </Button>
      </div>
    </form>
  );
}

function NoteBody({ note }: { note: NonNullable<TimelineItem['note']> }) {
  const { session, can } = useSession();
  const update = useUpdateNote();
  const remove = useDeleteNote();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.body);
  const [error, setError] = useState<string | null>(null);
  const mine = note.author?.id === session.user.id;
  const canDelete = mine || can('lead.delete');

  if (editing) {
    return (
      <form
        className="grid gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          update.mutate(
            { id: note.id, body: draft },
            {
              onSuccess: () => setEditing(false),
              onError: (e) => setError(errorMessage(e)),
            },
          );
        }}
      >
        <FormError message={error} />
        <textarea
          aria-label={s.notes.edit}
          className={textareaClass}
          value={draft}
          maxLength={10_000}
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={update.isPending || !draft.trim()}>
            {s.notes.save}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
            {s.notes.cancel}
          </Button>
        </div>
      </form>
    );
  }
  return (
    <div className="grid gap-1">
      <p className="whitespace-pre-wrap break-words">{note.body}</p>
      {mine || canDelete ? (
        <div className="flex gap-2">
          {mine ? (
            <Button
              size="sm"
              variant="link"
              className="h-auto px-0"
              onClick={() => {
                setDraft(note.body);
                setEditing(true);
              }}
            >
              {s.notes.edit}
            </Button>
          ) : null}
          {canDelete ? (
            <Button
              size="sm"
              variant="link"
              className="h-auto px-0 text-destructive"
              disabled={remove.isPending}
              onClick={() => {
                if (!window.confirm(s.notes.confirmDelete)) return;
                remove.mutate(note.id, {
                  onSuccess: () => toast.success(s.notes.deleted),
                  onError: (e) => toast.error(errorMessage(e)),
                });
              }}
            >
              {s.notes.delete}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
