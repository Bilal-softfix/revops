import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingState } from '@/components/states/states';
import { LeadsView } from '@/features/leads/leads-view';

export const metadata: Metadata = { title: 'Leads' };

export default function LeadsPage() {
  // useSearchParams (filters live in the URL) needs a Suspense boundary.
  return (
    <Suspense fallback={<LoadingState rows={8} />}>
      <LeadsView />
    </Suspense>
  );
}
