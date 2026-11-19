import { hasPermission } from '@revops/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LeadSourcesView } from '@/features/lead-sources/lead-sources-view';
import { getSession } from '@/lib/api/server';

export const metadata: Metadata = { title: 'Lead sources' };

export default async function LeadSourcesPage() {
  const session = await getSession();
  // The API enforces source.manage too; this just hides the page from other roles.
  if (!hasPermission(session?.tenant?.role, 'source.manage')) notFound();
  return <LeadSourcesView />;
}
