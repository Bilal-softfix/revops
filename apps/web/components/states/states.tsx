'use client';

import { AlertCircle, Inbox, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage, errorReference } from '@/lib/api/messages';
import { common } from '@/lib/strings/common';

/**
 * Loading placeholder, announced to screen readers: `rows` bars, or `variant="cards"` (a row of
 * KPI tiles over two panels — dashboards).
 */
export function LoadingState({
  rows = 3,
  label = common.loading,
  variant = 'rows',
}: {
  rows?: number;
  label?: string;
  variant?: 'rows' | 'cards';
}) {
  return (
    <div role="status" aria-live="polite" className="space-y-3">
      <span className="sr-only">{label}</span>
      {variant === 'cards' ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-32 rounded-xl" />
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-64 rounded-xl" />
            <Skeleton className="h-64 rounded-xl" />
          </div>
        </>
      ) : (
        Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-11 w-full rounded-lg" />
        ))
      )}
    </div>
  );
}

/** Nothing to show yet, with an optional next step. */
export function EmptyState({
  title,
  body,
  action,
  icon: Icon = Inbox,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed bg-card/60 px-6 py-12 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-primary/10 text-primary">
        <Icon className="size-6" aria-hidden />
      </span>
      <div className="space-y-1">
        <p className="font-semibold">{title}</p>
        {body ? <p className="mx-auto max-w-md text-sm text-muted-foreground">{body}</p> : null}
      </div>
      {action ? <div className="pt-1">{action}</div> : null}
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
