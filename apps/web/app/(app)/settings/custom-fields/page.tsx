import { hasPermission } from '@revops/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CustomFieldsView } from '@/features/custom-fields/custom-fields-view';
import { getSession } from '@/lib/api/server';

export const metadata: Metadata = { title: 'Custom fields' };

export default async function CustomFieldsPage() {
  const session = await getSession();
  // The API enforces customfield.manage too; this just hides the page from other roles.
  if (!hasPermission(session?.tenant?.role, 'customfield.manage')) notFound();
  return <CustomFieldsView />;
}
