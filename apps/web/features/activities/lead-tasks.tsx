'use client';

import { TASK_TYPES, type Lead, type TaskType } from '@revops/shared';
import { useState } from 'react';
import { toast } from 'sonner';
import { SimpleSelect } from '@/components/form/simple-select';
import { FormError, TextField } from '@/components/form/text-field';
import { EmptyState, ErrorState, LoadingState } from '@/components/states/states';
import { Button } from '@/components/ui/button';
import { useMembers } from '@/features/team/queries';
import { errorMessage } from '@/lib/api/messages';
import { ApiError } from '@/lib/api/problem';
import { defaultDueWallTime, wallTimeToIso } from '@/lib/format';
import { useSession } from '@/lib/session';
import { activityStrings as s } from '@/lib/strings/activities';
import { useCreateTask, useLeadTasks } from './queries';
import { TaskItem } from './task-item';

/** The lead page's task panel: open tasks first, then done; inline "add task" form. */
export function LeadTasks({ lead }: { lead: Lead }) {
  const tasks = useLeadTasks(lead.id);
  const [adding, setAdding] = useState(false);
  return (
    <section className="grid gap-3 rounded-md border p-4" aria-labelledby="tasks-heading">
      <div className="flex items-center justify-between gap-2">
        <h2 id="tasks-heading" className="text-lg font-medium">
          {s.tasks.title}
        </h2>
        {adding ? null : (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            {s.tasks.add}
          </Button>
        )}
      </div>
      {adding ? <NewTaskForm lead={lead} onDone={() => setAdding(false)} /> : null}
      {tasks.isPending ? (
        <LoadingState rows={2} />
      ) : tasks.isError ? (
        <ErrorState error={tasks.error} onRetry={() => void tasks.refetch()} />
      ) : tasks.data.items.length === 0 ? (
        <EmptyState title={s.tasks.empty} />
      ) : (
        <ul className="grid gap-2" aria-label={s.tasks.title}>
          {tasks.data.items.map((task) => (
            <TaskItem key={task.id} task={task} />
          ))}
        </ul>
      )}
    </section>
  );
}

function NewTaskForm({ lead, onDone }: { lead: Lead; onDone: () => void }) {
  const { session, can } = useSession();
  const create = useCreateTask();
  const canAssign = can('lead.assign');
  // Only members who can open the lead: read-all roles, or the lead's owner (API enforces it).
  const members = (useMembers().data?.pages.flatMap((p) => p.items) ?? []).filter(
    (m) => m.status === 'active' && (m.role !== 'agent' || m.userId === lead.owner?.id),
  );
  const [title, setTitle] = useState('');
  const [type, setType] = useState<TaskType>('followup');
  const [due, setDue] = useState(defaultDueWallTime());
  const [assignee, setAssignee] = useState(session.user.id);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const submit = () => {
    setErrors({});
    setFormError(null);
    const dueAt = wallTimeToIso(due);
    if (!title.trim()) return setErrors({ title: 'required' });
    if (!dueAt) return setErrors({ dueAt: 'required' });
    create.mutate(
      {
        leadId: lead.id,
        title,
        type,
        dueAt,
        ...(canAssign && assignee !== session.user.id ? { assigneeUserId: assignee } : {}),
      },
      {
        onSuccess: () => {
          toast.success(s.tasks.created);
          onDone();
        },
        onError: (error) => {
          if (error instanceof ApiError && Object.keys(error.fieldErrors).length > 0) {
            setErrors(error.fieldErrors);
          } else setFormError(errorMessage(error));
        },
      },
    );
  };

  return (
    <form
      noValidate
      aria-label={s.tasks.addTitle}
      className="grid gap-3 rounded-md bg-muted/40 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <FormError message={formError} />
      <TextField
        label={s.tasks.titleLabel}
        placeholder={s.tasks.titlePlaceholder}
        value={title}
        maxLength={200}
        error={errors.title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <SimpleSelect
        label={s.tasks.type}
        value={type}
        options={TASK_TYPES.map((t) => ({ value: t, label: s.tasks.types[t] }))}
        onChange={(v) => setType(v as TaskType)}
      />
      <TextField
        label={s.tasks.due}
        type="datetime-local"
        value={due}
        error={errors.dueAt}
        onChange={(e) => setDue(e.target.value)}
      />
      {canAssign ? (
        <SimpleSelect
          label={s.tasks.assignee}
          value={assignee}
          options={members.map((m) => ({ value: m.userId, label: m.name }))}
          error={errors.assigneeUserId}
          onChange={setAssignee}
        />
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={create.isPending}>
          {s.tasks.create}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          {s.notes.cancel}
        </Button>
      </div>
    </form>
  );
}
