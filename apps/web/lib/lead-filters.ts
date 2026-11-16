import { type LeadFilters, leadFiltersToParams, leadQuerySchema } from '@revops/shared';

// Lead filters live in the URL (shareable, survive reloads): the same encoding the API takes.

export type LeadLayout = 'list' | 'board';

/** URL search params → filters + layout. Anything invalid is dropped rather than erroring. */
export function filtersFromParams(params: URLSearchParams): {
  filters: LeadFilters;
  layout: LeadLayout;
} {
  const layout: LeadLayout = params.get('layout') === 'board' ? 'board' : 'list';
  const raw = Object.fromEntries(
    [...params.entries()].filter(([key]) => key !== 'layout' && key !== 'view'),
  );
  const parsed = leadQuerySchema.safeParse(raw);
  return { filters: parsed.success ? parsed.data.filters : {}, layout };
}

export function paramsFromFilters(filters: LeadFilters, layout: LeadLayout): string {
  const params = leadFiltersToParams(filters);
  if (layout === 'board') params.set('layout', 'board');
  return params.toString();
}

/** Drops undefined / empty values so URLs and saved views stay clean. */
export function cleanFilters(filters: LeadFilters): LeadFilters {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === '') continue;
    if (key === 'customFields') {
      const cf = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined),
      );
      if (Object.keys(cf).length > 0) out[key] = cf;
      continue;
    }
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return out;
}

// Day boundaries in the tenant's timezone (Asia/Kolkata, UTC+05:30, no DST).
const IST = '+05:30';

/** "2026-11-16" → the instant that day starts in IST. */
export const dayStart = (day: string) => `${day}T00:00:00${IST}`;

/** "2026-11-16" → the instant the NEXT day starts in IST (exclusive upper bound). */
export function dayEnd(day: string): string {
  const next = new Date(`${day}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return dayStart(next.toISOString().slice(0, 10));
}

/** Inverse for the date inputs: the IST day an instant bound refers to. */
export function dayOf(bound: string | undefined, kind: 'from' | 'to'): string {
  if (!bound) return '';
  const local = new Date(new Date(bound).getTime() + 5.5 * 3_600_000); // shift to IST
  if (kind === 'to') local.setUTCDate(local.getUTCDate() - 1);
  return local.toISOString().slice(0, 10);
}
