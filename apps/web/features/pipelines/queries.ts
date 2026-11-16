'use client';

import {
  type CreatePipelineRequest,
  type CreateStageRequest,
  type UpdatePipelineRequest,
  type UpdateStageRequest,
  pipelineListSchema,
  pipelineSchema,
} from '@revops/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { customFieldKeys } from '@/features/custom-fields/queries';
import { api } from '@/lib/api/client';
import { useSession } from '@/lib/session';

/** Keys include the tenant, so a tenant switch never shows another workspace's pipelines. */
export const pipelineKeys = {
  all: (tenantId: string) => ['pipelines', tenantId] as const,
};

/** Active pipelines with their stages, in order (every role may read them). */
export function usePipelines() {
  const { session } = useSession();
  return useQuery({
    queryKey: pipelineKeys.all(session.tenant?.id ?? ''),
    queryFn: ({ signal }) => api('/v1/pipelines', { schema: pipelineListSchema, signal }),
    staleTime: 60_000,
  });
}

function usePipelineMutation<V, R>(fn: (vars: V, csrfToken: string) => Promise<R>) {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const tenantId = session.tenant?.id ?? '';
  return useMutation({
    mutationFn: (vars: V) => fn(vars, session.csrfToken),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: pipelineKeys.all(tenantId) });
      // Lead fields list the pipelines they apply to.
      await queryClient.invalidateQueries({ queryKey: customFieldKeys.all(tenantId) });
    },
  });
}

export const useCreatePipeline = () =>
  usePipelineMutation((body: CreatePipelineRequest, csrfToken) =>
    api('/v1/pipelines', { method: 'POST', body, schema: pipelineSchema, csrfToken }),
  );

export const useUpdatePipeline = () =>
  usePipelineMutation(({ id, ...body }: UpdatePipelineRequest & { id: string }, csrfToken) =>
    api(`/v1/pipelines/${id}`, { method: 'PATCH', body, schema: pipelineSchema, csrfToken }),
  );

export const useDeletePipeline = () =>
  usePipelineMutation((id: string, csrfToken) =>
    api(`/v1/pipelines/${id}`, { method: 'DELETE', csrfToken }),
  );

export const useReorderPipelines = () =>
  usePipelineMutation((pipelineIds: string[], csrfToken) =>
    api('/v1/pipelines/order', {
      method: 'PUT',
      body: { pipelineIds },
      schema: pipelineListSchema,
      csrfToken,
    }),
  );

export const useAddStage = () =>
  usePipelineMutation(
    ({ pipelineId, ...body }: CreateStageRequest & { pipelineId: string }, csrfToken) =>
      api(`/v1/pipelines/${pipelineId}/stages`, {
        method: 'POST',
        body,
        schema: pipelineSchema,
        csrfToken,
      }),
  );

export const useUpdateStage = () =>
  usePipelineMutation(
    (
      {
        pipelineId,
        stageId,
        ...body
      }: UpdateStageRequest & { pipelineId: string; stageId: string },
      csrfToken,
    ) =>
      api(`/v1/pipelines/${pipelineId}/stages/${stageId}`, {
        method: 'PATCH',
        body,
        schema: pipelineSchema,
        csrfToken,
      }),
  );

export const useReorderStages = () =>
  usePipelineMutation(
    ({ pipelineId, stageIds }: { pipelineId: string; stageIds: string[] }, csrfToken) =>
      api(`/v1/pipelines/${pipelineId}/stages/order`, {
        method: 'PUT',
        body: { stageIds },
        schema: pipelineSchema,
        csrfToken,
      }),
  );

/** Without `moveTo`, a stage with leads answers 409 `stage_has_leads` (count + allowed targets). */
export const useDeleteStage = () =>
  usePipelineMutation(
    (
      { pipelineId, stageId, moveTo }: { pipelineId: string; stageId: string; moveTo?: string },
      csrfToken,
    ) =>
      api(`/v1/pipelines/${pipelineId}/stages/${stageId}${moveTo ? `?moveTo=${moveTo}` : ''}`, {
        method: 'DELETE',
        schema: pipelineSchema,
        csrfToken,
      }),
  );
