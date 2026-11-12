'use client';

import { type ComponentProps, useId } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** Label + input + hint + error, wired for screen readers. Spread react-hook-form's register(). */
export function TextField({
  label,
  hint,
  error,
  ...input
}: ComponentProps<typeof Input> & { label: string; hint?: string; error?: string | undefined }) {
  const id = useId();
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        {...input}
      />
      {hint && !error ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Form-level error banner (API errors that aren't about one field). */
export function FormError({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {message}
    </p>
  );
}
