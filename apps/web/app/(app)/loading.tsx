import { LoadingState } from '@/components/states/states';

/** Shown while a signed-in page's server work streams in. */
export default function Loading() {
  return (
    <div className="mx-auto max-w-4xl">
      <LoadingState rows={4} />
    </div>
  );
}
