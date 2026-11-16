import { hasPermission } from '@revops/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PipelinesView } from '@/features/pipelines/pipelines-view';
import { getSession } from '@/lib/api/server';

export const metadata: Metadata = { title: 'Pipelines' };

export default async function PipelinesPage() {
  const session = await getSession();
  // The API enforces pipeline.manage too; this just hides the page from other roles.
  if (!hasPermission(session?.tenant?.role, 'pipeline.manage')) notFound();
  return <PipelinesView />;
}
