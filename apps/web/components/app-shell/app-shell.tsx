'use client';

import type { SessionResponse } from '@revops/shared';
import { Menu } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { EmptyState } from '@/components/states/states';
import { Button } from '@/components/ui/button';
import { SessionProvider, useSession } from '@/lib/session';
import { shellStrings } from '@/lib/strings/shell';
import { Sidebar } from './sidebar';
import { UserMenu } from './user-menu';

export function AppShell({ session, children }: { session: SessionResponse; children: ReactNode }) {
  return (
    <SessionProvider initial={session}>
      <Shell>{children}</Shell>
    </SessionProvider>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <div className="flex min-h-screen">
      <Sidebar className="hidden w-64 shrink-0 border-r md:flex" />
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-black/30"
            onClick={() => setMobileOpen(false)}
          />
          <Sidebar
            className="relative z-10 flex h-full w-64 border-r bg-background"
            onNavigate={() => setMobileOpen(false)}
          />
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between gap-2 border-b px-4">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label="Open menu"
            onClick={() => setMobileOpen(true)}
          >
            <Menu />
          </Button>
          <span className="truncate text-sm text-muted-foreground md:hidden">
            {session.tenant?.name}
          </span>
          <div className="ml-auto">
            <UserMenu />
          </div>
        </header>
        <main className="flex-1 p-4 md:p-8">
          {session.tenant ? (
            children
          ) : (
            <EmptyState title={shellStrings.noTenant.title} body={shellStrings.noTenant.body} />
          )}
        </main>
      </div>
    </div>
  );
}
