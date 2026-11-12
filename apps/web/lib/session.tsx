'use client';

import {
  type Permission,
  type SessionResponse,
  hasPermission,
  sessionResponseSchema,
} from '@revops/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, createContext, useCallback, useContext, useMemo } from 'react';
import { api } from '@/lib/api/client';

export const SESSION_KEY = ['session'] as const;

interface SessionContextValue {
  session: SessionResponse;
  /** Replace the cached session (after login / tenant switch), and refetch tenant-scoped data. */
  setSession: (next: SessionResponse) => Promise<void>;
  can: (permission: Permission) => boolean;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/**
 * The signed-in session for client components. Seeded by the (app) layout's server-side /me
 * call, then kept in TanStack Query so a tenant switch updates every consumer at once.
 */
export function SessionProvider({
  initial,
  children,
}: {
  initial: SessionResponse;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: SESSION_KEY,
    queryFn: ({ signal }) => api('/v1/auth/me', { schema: sessionResponseSchema, signal }),
    initialData: initial,
    staleTime: 60_000,
  });
  const session = data ?? initial;

  const setSession = useCallback(
    async (next: SessionResponse) => {
      queryClient.setQueryData(SESSION_KEY, next);
      // Everything else is scoped to the previous tenant/user.
      await queryClient.invalidateQueries({
        predicate: (q) => q.queryKey[0] !== SESSION_KEY[0],
      });
    },
    [queryClient],
  );

  const value = useMemo<SessionContextValue>(
    () => ({
      session,
      setSession,
      can: (permission) => hasPermission(session.tenant?.role, permission),
    }),
    [session, setSession],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside <SessionProvider>');
  return value;
}
