'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { navFor } from '@/lib/nav';
import { useSession } from '@/lib/session';
import { common } from '@/lib/strings/common';
import { TenantSwitcher } from './tenant-switcher';

/** Workspace switcher + the nav items this member's role may see. */
export function Sidebar({
  className,
  onNavigate,
}: {
  className?: string;
  onNavigate?: () => void;
}) {
  const { session } = useSession();
  const pathname = usePathname();
  const sections = navFor(session.tenant?.role);
  return (
    <aside className={cn('flex-col gap-4 p-3', className)}>
      <div className="px-2 py-1 text-lg font-semibold tracking-tight">{common.appName}</div>
      <TenantSwitcher />
      <nav aria-label="Main" className="flex flex-col gap-4">
        {sections.map((section) => (
          <div key={section.label} className="grid gap-1">
            <p className="px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
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
                        'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent',
                        active && 'bg-accent font-medium',
                      )}
                    >
                      <item.icon className="size-4" aria-hidden />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
