'use client';

import {
  type CreateTaskRequest,
  type TaskBucket,
  type UpdateTaskRequest,
  noteSchema,
  taskCountsSchema,
  taskListSchema,
  taskPageSchema,
  taskSchema,
  timelinePageSchema,
} from '@revops/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { leadKeys } from '@/features/leads/queries';
import { api } from '@/lib/api/client';
import { useSession } from '@/lib/session';

/**
 * Under leadKeys.all, so every lead mutation (stage, owner…) refreshes the timeline too; tasks
 * share a root so "My tasks" and the lead page stay in step.
 */
export const activityKeys = {
  timeline: (tenantId: string, leadId: string) =>
    [...leadKeys.all(tenantId), 'timeline', leadId] as const,
  leadTasks: (tenantId: string, leadId: string) =>
    [...leadKeys.all(tenantId), 'tasks', leadId] as const,
  myTasks: (tenantId: string) => ['tasks', tenantId] as const,
};

const TIMELINE_PAGE = 30;

export function useTimeline(leadId: string) {
  const { session } = useSession();
  return useInfiniteQuery({
    queryKey: activityKeys.timeline(session.tenant?.id ?? '', leadId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: String(TIMELINE_PAGE) });
      if (pageParam) params.set('cursor', pageParam);
      return api(`/v1/leads/${leadId}/timeline?${params.toString()}`, {
        schema: timelinePageSchema,
        signal,
      });
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useLeadTasks(leadId: string) {
  const { session } = useSession();
  return useQuery({
    queryKey: activityKeys.leadTasks(session.tenant?.id ?? '', leadId),
    queryFn: ({ signal }) => api(`/v1/leads/${leadId}/tasks`, { schema: taskListSchema, signal }),
  });
}

export function useMyTasks(bucket: TaskBucket) {
  const { session } = useSession();
  return useInfiniteQuery({
    queryKey: [...activityKeys.myTasks(session.tenant?.id ?? ''), 'list', bucket],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ bucket, limit: '50' });
      if (pageParam) params.set('cursor', pageParam);
      return api(`/v1/tasks?${params.toString()}`, { schema: taskPageSchema, signal });
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useMyTaskCounts() {
  const { session } = useSession();
  return useQuery({
    queryKey: [...activityKeys.myTasks(session.tenant?.id ?? ''), 'counts'],
    queryFn: ({ signal }) => api('/v1/tasks/counts', { schema: taskCountsSchema, signal }),
  });
}

/** Any activity write: refresh lead-scoped data (timeline, tasks) and "My tasks". */
function useActivityMutation<V, R>(fn: (vars: V, csrfToken: string) => Promise<R>) {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const tenantId = session.tenant?.id ?? '';
  return useMutation({
    mutationFn: (vars: V) => fn(vars, session.csrfToken),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: leadKeys.all(tenantId) });
      await queryClient.invalidateQueries({ queryKey: activityKeys.myTasks(tenantId) });
    },
  });
}

export const useCreateNote = () =>
  useActivityMutation(({ leadId, body }: { leadId: string; body: string }, csrfToken) =>
    api(`/v1/leads/${leadId}/notes`, {
      method: 'POST',
      body: { body },
      schema: noteSchema,
      csrfToken,
    }),
  );

export const useUpdateNote = () =>
  useActivityMutation(({ id, body }: { id: string; body: string }, csrfToken) =>
    api(`/v1/notes/${id}`, { method: 'PATCH', body: { body }, schema: noteSchema, csrfToken }),
  );

export const useDeleteNote = () =>
  useActivityMutation((id: string, csrfToken) =>
    api(`/v1/notes/${id}`, { method: 'DELETE', csrfToken }),
  );

export const useCreateTask = () =>
  useActivityMutation(({ leadId, ...body }: CreateTaskRequest & { leadId: string }, csrfToken) =>
    api(`/v1/leads/${leadId}/tasks`, { method: 'POST', body, schema: taskSchema, csrfToken }),
  );

export const useUpdateTask = () =>
  useActivityMutation(({ id, ...body }: UpdateTaskRequest & { id: string }, csrfToken) =>
    api(`/v1/tasks/${id}`, { method: 'PATCH', body, schema: taskSchema, csrfToken }),
  );

export const useDeleteTask = () =>
  useActivityMutation((id: string, csrfToken) =>
    api(`/v1/tasks/${id}`, { method: 'DELETE', csrfToken }),
  );
