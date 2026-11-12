import { DEFAULT_TIMEZONE } from '@revops/shared';

/** Dates show in the tenant's timezone (CLAUDE.md); tenants don't carry one yet → Asia/Kolkata. */
export function formatDate(iso: string, timeZone: string = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone }).format(new Date(iso));
}
