'use client';

import {
  type CreateLeadSourceRequest,
  type UpdateLeadSourceRequest,
  leadSourceSchema,
  leadSourceWithSecretSchema,
} from '@revops/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { leadKeys, useLeadSources } from '@/features/leads/queries';
import { api } from '@/lib/api/client';
import { useSession } from '@/lib/session';

/** Same cache as the lead forms' source picker, so edits show up there too. */
export { useLeadSources };

function useSourceMutation<V, R>(fn: (vars: V, csrfToken: string) => Promise<R>) {
  const { session } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: V) => fn(vars, session.csrfToken),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: leadKeys.sources(session.tenant?.id ?? '') }),
  });
}

export const useCreateLeadSource = () =>
  useSourceMutation((body: CreateLeadSourceRequest, csrfToken) =>
    api('/v1/lead-sources', {
      method: 'POST',
      body,
      schema: leadSourceWithSecretSchema,
      csrfToken,
    }),
  );

export const useUpdateLeadSource = () =>
  useSourceMutation(({ id, ...body }: UpdateLeadSourceRequest & { id: string }, csrfToken) =>
    api(`/v1/lead-sources/${id}`, { method: 'PATCH', body, schema: leadSourceSchema, csrfToken }),
  );

export const useDeleteLeadSource = () =>
  useSourceMutation((id: string, csrfToken) =>
    api(`/v1/lead-sources/${id}`, { method: 'DELETE', csrfToken }),
  );

export const useRotateKey = () =>
  useSourceMutation((id: string, csrfToken) =>
    api(`/v1/lead-sources/${id}/rotate-key`, {
      method: 'POST',
      schema: leadSourceSchema,
      csrfToken,
    }),
  );

export const useRotateSecret = () =>
  useSourceMutation((id: string, csrfToken) =>
    api(`/v1/lead-sources/${id}/rotate-secret`, {
      method: 'POST',
      schema: leadSourceWithSecretSchema,
      csrfToken,
    }),
  );
