import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const TONES = {
  primary: 'bg-primary/10 text-primary',
  success: 'bg-success/12 text-success-foreground',
  warning: 'bg-warning/15 text-warning-foreground',
  info: 'bg-info/12 text-info-foreground',
  danger: 'bg-destructive/10 text-destructive',
} as const;

/** A KPI tile: label, big number, a short note, and an icon in a tinted circle. */
export function StatCard({
  label,
  value,
  note,
  icon: Icon,
  tone = 'primary',
  href,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  icon: LucideIcon;
  tone?: keyof typeof TONES;
  /** Makes the whole tile a link (e.g. to the filtered list). */
  href?: string;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <span className={cn('grid size-9 place-items-center rounded-lg', TONES[tone])}>
          <Icon className="size-4.5" aria-hidden />
        </span>
      </div>
      <p className="text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl">{value}</p>
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
    </>
  );
  const className =
    'grid content-start gap-2 rounded-xl border bg-card p-4 shadow-card transition-shadow sm:p-5';
  return href ? (
    <Link
      href={href}
      className={cn(
        className,
        'hover:shadow-raised focus-visible:ring-3 focus-visible:ring-ring/40',
      )}
    >
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}
