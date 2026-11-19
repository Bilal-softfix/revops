'use client';

import {
  CSV_FILE_NAME_HEADER,
  type CreateLeadSourceRequest,
  type StartCsvImportRequest,
  type UpdateLeadSourceRequest,
  leadSourceSchema,
  leadSourceWithSecretSchema,
  csvImportListSchema,
  csvImportPreviewSchema,
  csvImportSchema,
  rejectedDeliveryListSchema,
} from '@revops/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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

/** Recent rejected webhook deliveries of an API source (owners/admins), fetched on demand. */
export function useRejectedDeliveries(sourceId: string, enabled: boolean) {
  const { session } = useSession();
  return useQuery({
    queryKey: ['lead-sources', session.tenant?.id ?? '', sourceId, 'rejected-deliveries'],
    queryFn: () =>
      api(`/v1/lead-sources/${sourceId}/rejected-deliveries`, {
        schema: rejectedDeliveryListSchema,
      }),
    enabled,
  });
}

const importKeys = (tenantId: string, sourceId: string) =>
  ['lead-sources', tenantId, sourceId, 'imports'] as const;

/** Recent imports of a CSV source; polls every 2 s while one is waiting or running. */
export function useCsvImports(sourceId: string) {
  const { session } = useSession();
  return useQuery({
    queryKey: importKeys(session.tenant?.id ?? '', sourceId),
    queryFn: ({ signal }) =>
      api(`/v1/lead-sources/${sourceId}/imports`, { schema: csvImportListSchema, signal }),
    refetchInterval: (query) =>
      query.state.data?.items.some((i) => i.status === 'queued' || i.status === 'processing')
        ? 2000
        : false,
  });
}

export function useUploadCsv(sourceId: string) {
  const { session } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) =>
      api(`/v1/lead-sources/${sourceId}/imports`, {
        method: 'POST',
        raw: {
          data: file,
          contentType: 'text/csv',
          headers: { [CSV_FILE_NAME_HEADER]: encodeURIComponent(file.name) },
        },
        schema: csvImportPreviewSchema,
        csrfToken: session.csrfToken,
      }),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: importKeys(session.tenant?.id ?? '', sourceId) }),
  });
}

export function useStartCsvImport(sourceId: string) {
  const { session } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: StartCsvImportRequest & { id: string }) =>
      api(`/v1/imports/${id}/start`, {
        method: 'POST',
        body,
        schema: csvImportSchema,
        csrfToken: session.csrfToken,
      }),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: importKeys(session.tenant?.id ?? '', sourceId) }),
  });
}

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
