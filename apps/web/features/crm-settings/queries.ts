'use client';

import { type UpdateCrmSettingsRequest, crmSettingsSchema } from '@revops/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { contactKeys } from '@/features/contacts/queries';
import { api } from '@/lib/api/client';
import { useSession } from '@/lib/session';

export const crmSettingsKeys = {
  all: (tenantId: string) => ['crm-settings', tenantId] as const,
};

export function useCrmSettings() {
  const { session } = useSession();
  return useQuery({
    queryKey: crmSettingsKeys.all(session.tenant?.id ?? ''),
    queryFn: ({ signal }) => api('/v1/crm/settings', { schema: crmSettingsSchema, signal }),
  });
}

export function useUpdateCrmSettings() {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const tenantId = session.tenant?.id ?? '';
  return useMutation({
    mutationFn: (body: UpdateCrmSettingsRequest) =>
      api('/v1/crm/settings', {
        method: 'PATCH',
        body,
        schema: crmSettingsSchema,
        csrfToken: session.csrfToken,
      }),
    onSuccess: (settings) => queryClient.setQueryData(crmSettingsKeys.all(tenantId), settings),
    // Visibility changes what agents' contact lists contain.
    onSettled: () => queryClient.invalidateQueries({ queryKey: contactKeys.all(tenantId) }),
  });
}
