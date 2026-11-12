'use client';

import { ErrorState } from '@/components/states/states';

/** Unexpected failure inside a signed-in page: message, reference and retry (Next 16 `retry`). */
export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="mx-auto max-w-2xl">
      <ErrorState error={error} onRetry={retry} />
    </div>
  );
}
