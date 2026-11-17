import { describe, expect, it } from 'vitest';
import {
  cleanFilters,
  dayEnd,
  dayOf,
  dayStart,
  filtersFromParams,
  paramsFromFilters,
} from './lead-filters';

const P = '11111111-1111-4111-8111-111111111111';
const S = '22222222-2222-4222-8222-222222222222';

describe('lead filters in the URL', () => {
  it('round-trips every filter kind and the layout', () => {
    const filters = {
      pipelineId: P,
      stageIds: [S],
      owner: 'me' as const,
      status: 'open' as const,
      q: 'asha',
      createdFrom: dayStart('2026-11-01'),
      customFields: { issue: ['screen'], estimate_inr: { min: 100 }, under_warranty: true },
    };
    const parsed = filtersFromParams(new URLSearchParams(paramsFromFilters(filters, 'board')));
    expect(parsed).toEqual({ filters, layout: 'board' });
  });

  it('drops invalid params instead of failing', () => {
    expect(filtersFromParams(new URLSearchParams('pipelineId=nope&layout=x'))).toEqual({
      filters: {},
      layout: 'list',
    });
  });

  it('cleanFilters removes empty values', () => {
    expect(
      cleanFilters({
        q: '',
        stageIds: [],
        owner: undefined,
        customFields: { a: undefined },
      } as never),
    ).toEqual({});
  });

  it('IST day bounds: from = start of day, to = start of next day', () => {
    expect(dayStart('2026-11-16')).toBe('2026-11-16T00:00:00+05:30');
    expect(dayEnd('2026-12-31')).toBe('2027-01-01T00:00:00+05:30');
    expect(dayOf(dayStart('2026-11-16'), 'from')).toBe('2026-11-16');
    expect(dayOf(dayEnd('2026-11-16'), 'to')).toBe('2026-11-16');
  });
});
