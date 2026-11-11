'use client';

import { hasPermission } from '@revops/shared';
import Link from 'next/link';
import { EmptyState } from '@/components/states/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useSession } from '@/lib/session';
import { shellStrings as s } from '@/lib/strings/shell';

/** Placeholder home until leads land in M1: who you are here, and the next step. */
export function DashboardView() {
  const { session } = useSession();
  const tenant = session.tenant;
  if (!tenant) return null;
  return (
    <div className="mx-auto grid max-w-4xl gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{s.dashboard.title(tenant.name)}</h1>
        <Badge variant="secondary">{s.roles[tenant.role]}</Badge>
      </div>
      <p className="text-muted-foreground">{s.dashboard.body}</p>
      <EmptyState
        title={s.dashboard.emptyTitle}
        body={s.dashboard.emptyBody}
        action={
          hasPermission(tenant.role, 'member.invite') ? (
            <Button asChild variant="outline" size="sm">
              <Link href="/settings/team">{s.nav.team}</Link>
            </Button>
          ) : undefined
        }
      />
    </div>
  );
}
