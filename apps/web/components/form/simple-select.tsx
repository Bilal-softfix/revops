'use client';

import { useId } from 'react';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

const NONE = '__none__';

/**
 * Label + select over `{ value, label }` options. `noneLabel` adds a first option meaning "not
 * set" (reported as ''), because Radix Select can't hold an empty value.
 */
export function SimpleSelect({
  label,
  value,
  options,
  onChange,
  noneLabel,
  hideLabel = false,
  disabled = false,
  error,
  className,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  noneLabel?: string;
  hideLabel?: boolean;
  disabled?: boolean;
  error?: string | undefined;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn('grid gap-1.5', className)}>
      <Label htmlFor={id} className={hideLabel ? 'sr-only' : undefined}>
        {label}
      </Label>
      <Select
        value={value === '' && noneLabel ? NONE : value}
        onValueChange={(v) => onChange(v === NONE ? '' : v)}
        disabled={disabled}
      >
        <SelectTrigger
          id={id}
          className="w-full"
          aria-label={hideLabel ? label : undefined}
          aria-invalid={error ? true : undefined}
        >
          <SelectValue placeholder={noneLabel} />
        </SelectTrigger>
        <SelectContent>
          {noneLabel ? <SelectItem value={NONE}>{noneLabel}</SelectItem> : null}
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
