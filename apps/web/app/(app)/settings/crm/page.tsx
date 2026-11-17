import { hasPermission } from '@revops/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CrmSettingsView } from '@/features/crm-settings/crm-settings-view';
import { getSession } from '@/lib/api/server';

export const metadata: Metadata = { title: 'CRM settings' };

export default async function CrmSettingsPage() {
  const session = await getSession();
  // The API enforces crm.settings.manage too; this just hides the page from other roles.
  if (!hasPermission(session?.tenant?.role, 'crm.settings.manage')) notFound();
  return <CrmSettingsView />;
}
