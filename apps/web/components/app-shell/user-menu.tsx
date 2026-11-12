'use client';

import { useQueryClient } from '@tanstack/react-query';
import { LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
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

export function UserMenu() {
  const { session } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();

  const signOut = async () => {
    // Even if the API call fails (e.g. session already gone), leave the app.
    await api('/v1/auth/logout', { method: 'POST', csrfToken: session.csrfToken }).catch(
      () => undefined,
    );
    queryClient.clear();
    router.replace('/login');
    router.refresh();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="gap-2" aria-label={s.userMenu.label}>
          <Avatar className="size-7">
            <AvatarFallback>{initials(session.user.name)}</AvatarFallback>
          </Avatar>
          <span className="hidden text-sm sm:inline">{session.user.name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
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
