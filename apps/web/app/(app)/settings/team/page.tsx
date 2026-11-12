import { hasPermission } from '@revops/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { TeamView } from '@/features/team/team-view';
import { getSession } from '@/lib/api/server';

export const metadata: Metadata = { title: 'Team' };

export default async function TeamPage() {
  const session = await getSession();
  // The API enforces this too; here it just hides the page from roles without access.
  if (!hasPermission(session?.tenant?.role, 'member.read')) notFound();
  return <TeamView />;
}
