'use client';

import { TASK_BUCKETS, type TaskBucket, taskBucketSchema } from '@revops/shared';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { EmptyState, ErrorState, LoadingState } from '@/components/states/states';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { activityStrings as s } from '@/lib/strings/activities';
import { useMyTaskCounts, useMyTasks } from './queries';
import { TaskItem } from './task-item';

/** "My tasks": overdue / today / upcoming tabs (bucket in the URL), counts on the tabs. */
export function MyTasks() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const bucket = taskBucketSchema.catch('today').parse(params.get('bucket') ?? 'today');
  const counts = useMyTaskCounts();
  const tasks = useMyTasks(bucket);
  const items = tasks.data?.pages.flatMap((p) => p.items) ?? [];
  const select = (next: TaskBucket) => router.replace(`${pathname}?bucket=${next}`);

  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{s.myTasks.title}</h1>
        <p className="text-sm text-muted-foreground">{s.myTasks.description}</p>
      </div>
      <div role="tablist" aria-label={s.myTasks.title} className="flex gap-1 border-b">
        {TASK_BUCKETS.map((b) => (
          <button
            key={b}
            type="button"
            role="tab"
            aria-selected={b === bucket}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm',
              b === bucket
                ? 'border-primary font-medium'
                : 'border-transparent text-muted-foreground',
              b === 'overdue' && (counts.data?.overdue ?? 0) > 0 && 'text-destructive',
            )}
            onClick={() => select(b)}
          >
            {s.myTasks.buckets[b]}
            {counts.data ? ` (${counts.data[b]})` : ''}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={s.myTasks.buckets[bucket]}>
        {tasks.isPending ? (
          <LoadingState rows={4} />
        ) : tasks.isError ? (
          <ErrorState error={tasks.error} onRetry={() => void tasks.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState title={s.myTasks.empty[bucket]} />
        ) : (
          <ul className="grid gap-2">
            {items.map((task) => (
              <TaskItem key={task.id} task={task} showLead />
            ))}
          </ul>
        )}
        {tasks.hasNextPage ? (
          <Button
            className="mt-3"
            variant="outline"
            size="sm"
            disabled={tasks.isFetchingNextPage}
            onClick={() => void tasks.fetchNextPage()}
          >
            {s.myTasks.loadMore}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
