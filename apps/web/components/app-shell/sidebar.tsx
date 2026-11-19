'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Logo } from '@/components/layout/logo';
import { navFor } from '@/lib/nav';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import { TenantSwitcher } from './tenant-switcher';
import { UserMenu } from './user-menu';

/** Logo, workspace switcher, the nav items this member's role may see, and the account card. */
export function Sidebar({
  className,
  onNavigate,
  showAccount = true,
}: {
  className?: string;
  onNavigate?: () => void;
  /** The account card at the bottom (off in the mobile drawer: the header has the menu). */
  showAccount?: boolean;
}) {
  const { session } = useSession();
  const pathname = usePathname();
  const sections = navFor(session.tenant?.role);
  return (
    <aside
      className={cn(
        'flex-col gap-5 border-sidebar-border bg-sidebar px-3 py-4 text-sidebar-foreground',
        className,
      )}
    >
      <Link href="/dashboard" onClick={onNavigate} className="px-2">
        <Logo />
      </Link>
      <TenantSwitcher />
      <nav aria-label="Main" className="flex flex-1 flex-col gap-5 overflow-y-auto">
        {sections.map((section) => (
          <div key={section.label} className="grid gap-1">
            <p className="px-2.5 text-[11px] font-semibold tracking-wider text-muted-foreground/80 uppercase">
              {section.label}
            </p>
            <ul className="grid gap-0.5">
              {section.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors',
                        active
                          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                          : 'text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
                      )}
                    >
                      {active ? (
                        <span
                          aria-hidden
                          className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-sidebar-primary"
                        />
                      ) : null}
                      <item.icon
                        className={cn(
                          'size-4.5 shrink-0',
                          active
                            ? 'text-sidebar-primary'
                            : 'text-muted-foreground group-hover:text-sidebar-foreground',
                        )}
                        aria-hidden
                      />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      {showAccount ? <UserMenu variant="sidebar" /> : null}
    </aside>
  );
}
