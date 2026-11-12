'use client';

import { myTenantsResponseSchema, sessionResponseSchema } from '@revops/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, ChevronsUpDown } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { api } from '@/lib/api/client';
import { errorMessage } from '@/lib/api/messages';
import { useSession } from '@/lib/session';
import { common } from '@/lib/strings/common';
import { shellStrings as s } from '@/lib/strings/shell';

export const TENANTS_KEY = ['tenants'] as const;

/** Lists the user's active workspaces; switching re-scopes the session (POST /v1/session/tenant). */
export function TenantSwitcher() {
  const { session, setSession } = useSession();
  const router = useRouter();
  const tenants = useQuery({
    queryKey: TENANTS_KEY,
    queryFn: ({ signal }) => api('/v1/tenants', { schema: myTenantsResponseSchema, signal }),
  });
  const switchTenant = useMutation({
    mutationFn: (tenantId: string) =>
      api('/v1/session/tenant', {
        method: 'POST',
        body: { tenantId },
        schema: sessionResponseSchema,
        csrfToken: session.csrfToken,
      }),
    onSuccess: async (next) => {
      await setSession(next);
      if (next.tenant) toast.success(s.tenantSwitcher.switched(next.tenant.name));
      router.push('/dashboard');
      router.refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const current = session.tenant;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="w-full justify-between"
          aria-label={s.tenantSwitcher.label}
          disabled={switchTenant.isPending}
        >
          <span className="truncate">{current?.name ?? s.noTenant.title}</span>
          <ChevronsUpDown className="size-4 opacity-60" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel>{s.tenantSwitcher.label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {tenants.isPending ? (
          <DropdownMenuItem disabled>{common.loading}</DropdownMenuItem>
        ) : tenants.isError ? (
          <DropdownMenuItem onSelect={() => void tenants.refetch()}>
            {errorMessage(tenants.error)} — {common.retry}
          </DropdownMenuItem>
        ) : (
          tenants.data.items.map((tenant) => (
            <DropdownMenuItem
              key={tenant.id}
              disabled={tenant.id === current?.id}
              onSelect={() => switchTenant.mutate(tenant.id)}
            >
              <span className="flex-1 truncate">{tenant.name}</span>
              <span className="text-xs text-muted-foreground">{s.roles[tenant.role]}</span>
              {tenant.id === current?.id ? <Check className="size-4" aria-hidden /> : null}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
