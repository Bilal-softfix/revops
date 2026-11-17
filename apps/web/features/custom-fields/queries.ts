'use client';

import {
  type CreateCustomFieldRequest,
  type CustomFieldEntity,
  type UpdateCustomFieldRequest,
  customFieldDefListSchema,
  customFieldDefSchema,
} from '@revops/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { useSession } from '@/lib/session';

export const customFieldKeys = {
  all: (tenantId: string) => ['custom-fields', tenantId] as const,
  entity: (tenantId: string, entity: CustomFieldEntity) =>
    ['custom-fields', tenantId, entity] as const,
};

/** Active definitions of one entity, in display order. */
export function useCustomFields(entity: CustomFieldEntity) {
  const { session } = useSession();
  return useQuery({
    queryKey: customFieldKeys.entity(session.tenant?.id ?? '', entity),
    queryFn: ({ signal }) =>
      api(`/v1/custom-fields?entity=${entity}`, { schema: customFieldDefListSchema, signal }),
    staleTime: 60_000,
  });
}

function useFieldMutation<V, R>(fn: (vars: V, csrfToken: string) => Promise<R>) {
  const { session } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: V) => fn(vars, session.csrfToken),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: customFieldKeys.all(session.tenant?.id ?? '') }),
  });
}

export const useCreateCustomField = () =>
  useFieldMutation((body: CreateCustomFieldRequest, csrfToken) =>
    api('/v1/custom-fields', { method: 'POST', body, schema: customFieldDefSchema, csrfToken }),
  );

export const useUpdateCustomField = () =>
  useFieldMutation(({ id, ...body }: UpdateCustomFieldRequest & { id: string }, csrfToken) =>
    api(`/v1/custom-fields/${id}`, {
      method: 'PATCH',
      body,
      schema: customFieldDefSchema,
      csrfToken,
    }),
  );

export const useDeleteCustomField = () =>
  useFieldMutation((id: string, csrfToken) =>
    api(`/v1/custom-fields/${id}`, { method: 'DELETE', csrfToken }),
  );
