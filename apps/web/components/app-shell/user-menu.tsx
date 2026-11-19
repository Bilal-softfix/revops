'use client';

import { useQueryClient } from '@tanstack/react-query';
import { ChevronsUpDown, LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
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
import { useSession } from '@/lib/session';
import { shellStrings as s } from '@/lib/strings/shell';
import { cn } from '@/lib/utils';

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || '?'
  );
}

/** `header`: avatar button (mobile top bar). `sidebar`: account card at the sidebar's foot. */
export function UserMenu({ variant = 'header' }: { variant?: 'header' | 'sidebar' }) {
  const { session } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();

  const signOut = async () => {
    // Even if the API call fails (e.g. session already gone), leave the app.
    await api('/v1/auth/logout', { method: 'POST', csrfToken: session.csrfToken }).catch(
      () => undefined,
    );
    queryClient.clear();
    toast(s.userMenu.signedOut, { description: s.userMenu.signedOutBody });
    router.replace('/login');
    router.refresh();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {variant === 'sidebar' ? (
          <button
            type="button"
            aria-label={s.userMenu.label}
            className="flex w-full items-center gap-2.5 rounded-lg border border-sidebar-border bg-card/70 p-2 text-left shadow-card transition-colors hover:bg-card"
          >
            <Avatar className="size-8">
              <AvatarFallback className="bg-primary/12 text-xs font-semibold text-primary">
                {initials(session.user.name)}
              </AvatarFallback>
            </Avatar>
            <span className="grid min-w-0 flex-1">
              <span className="truncate text-sm font-medium">{session.user.name}</span>
              {session.tenant ? (
                <span className="truncate text-xs text-muted-foreground">
                  {s.roles[session.tenant.role]}
                </span>
              ) : null}
            </span>
            <ChevronsUpDown className="size-4 text-muted-foreground" aria-hidden />
          </button>
        ) : (
          <Button variant="ghost" className={cn('gap-2')} aria-label={s.userMenu.label}>
            <Avatar className="size-7">
              <AvatarFallback className="bg-primary/12 text-xs font-semibold text-primary">
                {initials(session.user.name)}
              </AvatarFallback>
            </Avatar>
            <span className="hidden text-sm sm:inline">{session.user.name}</span>
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={variant === 'sidebar' ? 'start' : 'end'}
        side={variant === 'sidebar' ? 'top' : 'bottom'}
        className="w-60"
      >
        <DropdownMenuLabel className="grid">
          <span className="truncate">{session.user.name}</span>
          <span className="truncate text-xs font-normal text-muted-foreground">
            {session.user.email}
          </span>
          {session.tenant ? (
            <span className="text-xs font-normal text-muted-foreground">
              {s.userMenu.role(s.roles[session.tenant.role])}
            </span>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOut aria-hidden />
          {s.userMenu.signOut}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
