'use client';

import { dashboardSummarySchema } from '@revops/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { useSession } from '@/lib/session';

/** Dashboard numbers; refreshed every minute while the page is open. */
export function useDashboardSummary() {
  const { session } = useSession();
  return useQuery({
    queryKey: ['dashboard', session.tenant?.id ?? '', 'summary'],
    queryFn: ({ signal }) =>
      api('/v1/dashboard/summary', { schema: dashboardSummarySchema, signal }),
    refetchInterval: 60_000,
  });
}
