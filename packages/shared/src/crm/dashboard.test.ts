import { describe, expect, it } from 'vitest';
import { topSources } from './dashboard.js';

const row = (name: string | null, count: number) => ({
  sourceId: name ? `00000000-0000-4000-8000-${String(count).padStart(12, '0')}` : null,
  name,
  count,
});

describe('topSources', () => {
  it('sorts by count then name and keeps everything under the limit', () => {
    expect(topSources([row('B', 2), row('A', 2), row('C', 5)]).map((r) => r.name)).toEqual([
      'C',
      'A',
      'B',
    ]);
  });

  it('sums the rest into one "other" row and drops zero counts', () => {
    const result = topSources([row('A', 9), row('B', 8), row('C', 1), row('D', 2), row('E', 0)], 2);
    expect(result).toEqual([
      expect.objectContaining({ name: 'A', count: 9, other: false }),
      expect.objectContaining({ name: 'B', count: 8, other: false }),
      { sourceId: null, name: null, count: 3, other: true },
    ]);
  });

  it('keeps "no source" leads as their own row', () => {
    expect(topSources([row(null, 4)])).toEqual([
      { sourceId: null, name: null, count: 4, other: false },
    ]);
  });
});
