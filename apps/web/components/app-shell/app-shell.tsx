'use client';

import type { SessionResponse } from '@revops/shared';
import { Menu, Plus } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { EmptyState } from '@/components/states/states';
import { Logo } from '@/components/layout/logo';
import { Button } from '@/components/ui/button';
import { navFor } from '@/lib/nav';
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
  const { session, can } = useSession();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const current = navFor(session.tenant?.role)
    .flatMap((section) => section.items.map((item) => ({ ...item, section: section.label })))
    .find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
  const onLeads = pathname === '/leads' || pathname.startsWith('/leads/');
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar className="sticky top-0 hidden h-screen w-64 shrink-0 border-r md:flex" />
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-slate-950/40 backdrop-blur-[2px]"
            onClick={() => setMobileOpen(false)}
          />
          <Sidebar
            className="relative z-10 flex h-full w-72 border-r shadow-xl"
            onNavigate={() => setMobileOpen(false)}
            showAccount={false}
          />
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b bg-background/80 px-4 backdrop-blur-md md:px-8">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label="Open menu"
            onClick={() => setMobileOpen(true)}
          >
            <Menu />
          </Button>
          <Link href="/dashboard" className="md:hidden">
            <Logo showName={false} />
          </Link>
          <p className="hidden min-w-0 items-center gap-1.5 truncate text-sm md:flex">
            <span className="text-muted-foreground">{session.tenant?.name}</span>
            {current ? (
              <>
                <span className="text-muted-foreground/50" aria-hidden>
                  /
                </span>
                <span className="font-medium">{current.label}</span>
              </>
            ) : null}
          </p>
          <div className="ml-auto flex items-center gap-2">
            {session.tenant && can('lead.write') && !onLeads ? (
              <Button asChild size="sm" className="shadow-sm">
                <Link href="/leads?new=1">
                  <Plus aria-hidden />
                  {shellStrings.quickAddLead}
                </Link>
              </Button>
            ) : null}
            <div className="md:hidden">
              <UserMenu />
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 p-4 md:p-8">
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
