'use client';

import {
  type InviteRequest,
  type UpdateMemberRequest,
  invitationSchema,
  memberPageSchema,
  memberSchema,
} from '@revops/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from '@/lib/api/client';
import { useSession } from '@/lib/session';

const invitationListSchema = z.object({ items: z.array(invitationSchema) });

/** Keys include the tenant, so a tenant switch never shows the previous workspace's data. */
export const teamKeys = {
  members: (tenantId: string) => ['members', tenantId] as const,
  invitations: (tenantId: string) => ['invitations', tenantId] as const,
};

const PAGE_SIZE = 50;

export function useMembers() {
  const { session } = useSession();
  const tenantId = session.tenant?.id ?? '';
  return useInfiniteQuery({
    queryKey: teamKeys.members(tenantId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => {
      const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (pageParam) query.set('cursor', pageParam);
      return api(`/v1/members?${query.toString()}`, { schema: memberPageSchema, signal });
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useInvitations(enabled: boolean) {
  const { session } = useSession();
  return useQuery({
    queryKey: teamKeys.invitations(session.tenant?.id ?? ''),
    queryFn: ({ signal }) => api('/v1/invitations', { schema: invitationListSchema, signal }),
    enabled,
  });
}

function useTeamMutation<V, R>(fn: (vars: V, csrfToken: string) => Promise<R>) {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const tenantId = session.tenant?.id ?? '';
  return useMutation({
    mutationFn: (vars: V) => fn(vars, session.csrfToken),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: teamKeys.members(tenantId) }),
        queryClient.invalidateQueries({ queryKey: teamKeys.invitations(tenantId) }),
      ]),
  });
}

export const useInvite = () =>
  useTeamMutation((body: InviteRequest, csrfToken) =>
    api('/v1/invitations', { method: 'POST', body, schema: invitationSchema, csrfToken }),
  );

export const useUpdateMember = () =>
  useTeamMutation(({ userId, ...body }: UpdateMemberRequest & { userId: string }, csrfToken) =>
    api(`/v1/members/${userId}`, { method: 'PATCH', body, schema: memberSchema, csrfToken }),
  );

export const useResendInvitation = () =>
  useTeamMutation((id: string, csrfToken) =>
    api(`/v1/invitations/${id}/resend`, { method: 'POST', csrfToken }),
  );

export const useRevokeInvitation = () =>
  useTeamMutation((id: string, csrfToken) =>
    api(`/v1/invitations/${id}`, { method: 'DELETE', csrfToken }),
  );
