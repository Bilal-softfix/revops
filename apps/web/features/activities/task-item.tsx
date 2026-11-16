'use client';

import type { Task } from '@revops/shared';
import { Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/api/messages';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { activityStrings as s } from '@/lib/strings/activities';
import { useDeleteTask, useUpdateTask } from './queries';

/** One task: done checkbox, title, type, due date (red when overdue), assignee; optional lead link. */
export function TaskItem({ task, showLead = false }: { task: Task; showLead?: boolean }) {
  // Rendered-at time for the overdue flag (a lazy initializer keeps render pure).
  const [now] = useState(() => Date.now());
  const update = useUpdateTask();
  const remove = useDeleteTask();
  const done = task.status === 'done';
  const overdue = !done && Date.parse(task.dueAt) < now;
  return (
    <li className="flex items-start gap-3 rounded-md border p-3 text-sm" data-task-id={task.id}>
      <input
        type="checkbox"
        className="mt-0.5 size-4 accent-primary"
        checked={done}
        disabled={update.isPending}
        aria-label={done ? s.tasks.reopen(task.title) : s.tasks.complete(task.title)}
        onChange={() =>
          update.mutate(
            { id: task.id, status: done ? 'open' : 'done' },
            { onError: (e) => toast.error(errorMessage(e)) },
          )
        }
      />
      <div className="grid min-w-0 flex-1 gap-1">
        <p className={cn('font-medium break-words', done && 'text-muted-foreground line-through')}>
          {task.title}
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="secondary">{s.tasks.types[task.type]}</Badge>
          <span className={cn(overdue && 'font-medium text-destructive')}>
            {overdue ? `${s.tasks.overdue} · ` : ''}
            {s.tasks.dueOn(formatDateTime(task.dueAt))}
          </span>
          {task.assignee ? <span>· {task.assignee.name}</span> : null}
          {showLead ? (
            <span>
              ·{' '}
              <Link href={`/leads/${task.lead.id}`} className="underline">
                {task.lead.contactName}
              </Link>
            </span>
          ) : null}
        </div>
      </div>
      {showLead ? null : (
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          aria-label={s.tasks.delete}
          disabled={remove.isPending}
          onClick={() =>
            remove.mutate(task.id, {
              onSuccess: () => toast.success(s.tasks.deleted),
              onError: (e) => toast.error(errorMessage(e)),
            })
          }
        >
          <Trash2 className="size-4" aria-hidden />
        </Button>
      )}
    </li>
  );
}
