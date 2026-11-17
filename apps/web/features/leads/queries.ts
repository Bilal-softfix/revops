'use client';

import {
  type BulkAssignLeadsRequest,
  type BulkChangeLeadStageRequest,
  type ChangeLeadStageRequest,
  type CreateLeadRequest,
  type CreateLeadViewRequest,
  type LeadFilters,
  type UpdateLeadRequest,
  bulkLeadResultSchema,
  leadBoardSchema,
  leadFiltersToParams,
  leadPageSchema,
  leadSchema,
  leadSourceListSchema,
  leadViewListSchema,
  leadViewSchema,
} from '@revops/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { contactKeys } from '@/features/contacts/queries';
import { api } from '@/lib/api/client';
import { useSession } from '@/lib/session';

/** Keys include the tenant, so a tenant switch never shows another workspace's leads. */
export const leadKeys = {
  all: (tenantId: string) => ['leads', tenantId] as const,
  list: (tenantId: string, filters: LeadFilters) => ['leads', tenantId, 'list', filters] as const,
  board: (tenantId: string, filters: LeadFilters) => ['leads', tenantId, 'board', filters] as const,
  one: (tenantId: string, id: string) => ['leads', tenantId, 'one', id] as const,
  views: (tenantId: string) => ['lead-views', tenantId] as const,
  sources: (tenantId: string) => ['lead-sources', tenantId] as const,
};

const PAGE = 50;

export function useLeads(filters: LeadFilters, enabled = true) {
  const { session } = useSession();
  return useInfiniteQuery({
    queryKey: leadKeys.list(session.tenant?.id ?? '', filters),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => {
      const params = leadFiltersToParams(filters);
      params.set('limit', String(PAGE));
      if (pageParam) params.set('cursor', pageParam);
      return api(`/v1/leads?${params.toString()}`, { schema: leadPageSchema, signal });
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
  });
}

/** One board per pipeline; `filters.pipelineId` must be set. Stage filters don't apply. */
export function useLeadBoard(filters: LeadFilters, enabled = true) {
  const { session } = useSession();
  return useQuery({
    queryKey: leadKeys.board(session.tenant?.id ?? '', filters),
    queryFn: ({ signal }) => {
      const { stageIds: _stageIds, ...rest } = filters;
      const params = leadFiltersToParams(rest);
      return api(`/v1/leads/board?${params.toString()}`, { schema: leadBoardSchema, signal });
    },
    enabled: enabled && Boolean(filters.pipelineId),
  });
}

/** More cards for one board column (the board returns the first page of each). */
export function fetchStagePage(filters: LeadFilters, stageId: string, cursor: string) {
  const { stageIds: _stageIds, ...rest } = filters;
  const params = leadFiltersToParams({ ...rest, stageIds: [stageId] });
  params.set('cursor', cursor);
  params.set('limit', String(PAGE));
  return api(`/v1/leads?${params.toString()}`, { schema: leadPageSchema });
}

export function useLead(id: string) {
  const { session } = useSession();
  return useQuery({
    queryKey: leadKeys.one(session.tenant?.id ?? '', id),
    queryFn: ({ signal }) => api(`/v1/leads/${id}`, { schema: leadSchema, signal }),
  });
}

export function useLeadSources() {
  const { session } = useSession();
  return useQuery({
    queryKey: leadKeys.sources(session.tenant?.id ?? ''),
    queryFn: ({ signal }) => api('/v1/lead-sources', { schema: leadSourceListSchema, signal }),
    staleTime: 5 * 60_000,
  });
}

function useLeadMutation<V, R>(fn: (vars: V, csrfToken: string) => Promise<R>) {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const tenantId = session.tenant?.id ?? '';
  return useMutation({
    mutationFn: (vars: V) => fn(vars, session.csrfToken),
    onSuccess: (result) => {
      // Lead-returning mutations update the detail cache at once (no flash of the old stage).
      const lead = leadSchema.safeParse(result);
      if (lead.success) queryClient.setQueryData(leadKeys.one(tenantId, lead.data.id), lead.data);
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: leadKeys.all(tenantId) });
      // A new lead may create or link a contact (and agents see contacts of their leads).
      await queryClient.invalidateQueries({ queryKey: contactKeys.all(tenantId) });
    },
  });
}

export const useCreateLead = () =>
  useLeadMutation((body: CreateLeadRequest, csrfToken) =>
    api('/v1/leads', { method: 'POST', body, schema: leadSchema, csrfToken }),
  );

export const useUpdateLead = () =>
  useLeadMutation(({ id, ...body }: UpdateLeadRequest & { id: string }, csrfToken) =>
    api(`/v1/leads/${id}`, { method: 'PATCH', body, schema: leadSchema, csrfToken }),
  );

export const useChangeLeadStage = () =>
  useLeadMutation(({ id, ...body }: ChangeLeadStageRequest & { id: string }, csrfToken) =>
    api(`/v1/leads/${id}/stage`, { method: 'POST', body, schema: leadSchema, csrfToken }),
  );

export const useDeleteLead = () =>
  useLeadMutation((id: string, csrfToken) =>
    api(`/v1/leads/${id}`, { method: 'DELETE', csrfToken }),
  );

/** Bulk assign (M1-T6); `ownerUserId: null` unassigns. */
export const useBulkAssignLeads = () =>
  useLeadMutation((body: BulkAssignLeadsRequest, csrfToken) =>
    api('/v1/leads/bulk-assign', {
      method: 'POST',
      body,
      schema: bulkLeadResultSchema,
      csrfToken,
    }),
  );

/** Bulk stage move (M1-T6). */
export const useBulkChangeLeadStage = () =>
  useLeadMutation((body: BulkChangeLeadStageRequest, csrfToken) =>
    api('/v1/leads/bulk-stage', { method: 'POST', body, schema: bulkLeadResultSchema, csrfToken }),
  );

export function useLeadViews() {
  const { session } = useSession();
  return useQuery({
    queryKey: leadKeys.views(session.tenant?.id ?? ''),
    queryFn: ({ signal }) => api('/v1/lead-views', { schema: leadViewListSchema, signal }),
  });
}

function useViewMutation<V, R>(fn: (vars: V, csrfToken: string) => Promise<R>) {
  const { session } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: V) => fn(vars, session.csrfToken),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: leadKeys.views(session.tenant?.id ?? '') }),
  });
}

export const useCreateLeadView = () =>
  useViewMutation((body: CreateLeadViewRequest, csrfToken) =>
    api('/v1/lead-views', { method: 'POST', body, schema: leadViewSchema, csrfToken }),
  );

export const useDeleteLeadView = () =>
  useViewMutation((id: string, csrfToken) =>
    api(`/v1/lead-views/${id}`, { method: 'DELETE', csrfToken }),
  );
