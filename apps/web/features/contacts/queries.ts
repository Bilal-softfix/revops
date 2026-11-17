'use client';

import {
  type CreateContactRequest,
  type UpdateContactRequest,
  contactPageSchema,
  contactSchema,
} from '@revops/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { useSession } from '@/lib/session';

/** Keys include the tenant, so a tenant switch never shows another workspace's contacts. */
export const contactKeys = {
  all: (tenantId: string) => ['contacts', tenantId] as const,
  list: (tenantId: string, q: string) => ['contacts', tenantId, 'list', q] as const,
  one: (tenantId: string, id: string) => ['contacts', tenantId, 'one', id] as const,
};

const PAGE = 25;

export function useContacts(q: string) {
  const { session } = useSession();
  const tenantId = session.tenant?.id ?? '';
  return useInfiniteQuery({
    queryKey: contactKeys.list(tenantId, q),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => {
      const query = new URLSearchParams({ limit: String(PAGE) });
      if (q) query.set('q', q);
      if (pageParam) query.set('cursor', pageParam);
      return api(`/v1/contacts?${query.toString()}`, { schema: contactPageSchema, signal });
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useContact(id: string) {
  const { session } = useSession();
  return useQuery({
    queryKey: contactKeys.one(session.tenant?.id ?? '', id),
    queryFn: ({ signal }) => api(`/v1/contacts/${id}`, { schema: contactSchema, signal }),
  });
}

function useContactMutation<V, R>(fn: (vars: V, csrfToken: string) => Promise<R>) {
  const { session } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: V) => fn(vars, session.csrfToken),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: contactKeys.all(session.tenant?.id ?? '') }),
  });
}

export const useCreateContact = () =>
  useContactMutation((body: CreateContactRequest, csrfToken) =>
    api('/v1/contacts', { method: 'POST', body, schema: contactSchema, csrfToken }),
  );

export const useUpdateContact = (id: string) =>
  useContactMutation((body: UpdateContactRequest, csrfToken) =>
    api(`/v1/contacts/${id}`, { method: 'PATCH', body, schema: contactSchema, csrfToken }),
  );

export const useDeleteContact = (id: string) =>
  useContactMutation((_: void, csrfToken) =>
    api(`/v1/contacts/${id}`, { method: 'DELETE', csrfToken }),
  );
