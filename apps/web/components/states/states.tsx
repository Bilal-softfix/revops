'use client';

import { AlertCircle, Inbox } from 'lucide-react';
import type { ReactNode } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage, errorReference } from '@/lib/api/messages';
import { common } from '@/lib/strings/common';

/** Loading placeholder: `rows` grey bars, announced to screen readers. */
export function LoadingState({
  rows = 3,
  label = common.loading,
}: {
  rows?: number;
  label?: string;
}) {
  return (
    <div role="status" aria-live="polite" className="space-y-3">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

/** Nothing to show yet, with an optional next step. */
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center">
      <Inbox className="size-8 text-muted-foreground" aria-hidden />
      <p className="font-medium">{title}</p>
      {body ? <p className="max-w-md text-sm text-muted-foreground">{body}</p> : null}
      {action}
    </div>
  );
}

/** A failed load: user-facing message, support reference and a retry button. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const reference = errorReference(error);
  return (
    <Alert variant="destructive" role="alert">
      <AlertCircle aria-hidden />
      <AlertTitle>{errorMessage(error)}</AlertTitle>
      <AlertDescription>
        {reference ? (
          <p>
            {common.unexpectedDetail} <code className="text-xs">{reference}</code>
          </p>
        ) : null}
        {onRetry ? (
          <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
            {common.retry}
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
