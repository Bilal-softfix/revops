import { DEFAULT_TIMEZONE } from '@revops/shared';

/** Dates show in the tenant's timezone (CLAUDE.md); tenants don't carry one yet → Asia/Kolkata. */
export function formatDate(iso: string, timeZone: string = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone }).format(new Date(iso));
}

export function formatDateTime(iso: string, timeZone: string = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(iso));
}

/**
 * `<input type="datetime-local">` value (wall time in the tenant timezone) → ISO with offset.
 * Asia/Kolkata has no DST, so its fixed +05:30 offset is exact.
 */
export function wallTimeToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  return new Date(`${value}:00+05:30`).toISOString();
}

/** ISO → `datetime-local` value in IST (inverse of wallTimeToIso). */
export function isoToWallTime(iso: string): string {
  const ist = new Date(new Date(iso).getTime() + 330 * 60_000);
  return ist.toISOString().slice(0, 16);
}

/** Default due time for a new task: tomorrow 10:00 IST. */
export function defaultDueWallTime(now: Date = new Date()): string {
  const ist = new Date(now.getTime() + 330 * 60_000);
  ist.setUTCDate(ist.getUTCDate() + 1);
  return `${ist.toISOString().slice(0, 10)}T10:00`;
}
