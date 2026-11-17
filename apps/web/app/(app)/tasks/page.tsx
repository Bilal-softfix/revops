import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingState } from '@/components/states/states';
import { MyTasks } from '@/features/activities/my-tasks';

export const metadata: Metadata = { title: 'My tasks' };

export default function TasksPage() {
  // useSearchParams (the bucket lives in the URL) needs a Suspense boundary.
  return (
    <Suspense fallback={<LoadingState rows={6} />}>
      <MyTasks />
    </Suspense>
  );
}
