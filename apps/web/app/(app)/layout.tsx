import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell/app-shell';
import { getSession } from '@/lib/api/server';

/**
 * Every signed-in page. The session is checked on the server (GET /v1/auth/me with the browser's
 * cookie) before anything renders; signed-out visitors go to /login.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');
  return <AppShell session={session}>{children}</AppShell>;
}
