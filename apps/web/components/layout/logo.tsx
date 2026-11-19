import { common } from '@/lib/strings/common';
import { cn } from '@/lib/utils';

/** The RevOps mark (an indigo tile with a rising signal) and wordmark. */
export function Logo({
  className,
  inverted = false,
  showName = true,
}: {
  className?: string;
  /** For dark/indigo backgrounds. */
  inverted?: boolean;
  showName?: boolean;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <span
        aria-hidden
        className={cn(
          'grid size-8 place-items-center rounded-lg shadow-sm',
          inverted ? 'bg-white/15 ring-1 ring-white/25' : 'bg-primary',
        )}
      >
        <svg viewBox="0 0 24 24" className="size-4.5" fill="none">
          <path
            d="M4 16.5 9 11l3.5 3.5L20 7"
            stroke="white"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M15 7h5v5"
            stroke="white"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      {showName ? (
        <span
          className={cn(
            'text-lg font-semibold tracking-tight',
            inverted ? 'text-white' : 'text-foreground',
          )}
        >
          {common.appName}
        </span>
      ) : null}
    </span>
  );
}
