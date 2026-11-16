import { describe, expect, it } from 'vitest';
import { defaultDueWallTime, isoToWallTime, wallTimeToIso } from './format';

describe('IST wall time ↔ ISO', () => {
  it('converts a datetime-local value as IST', () => {
    expect(wallTimeToIso('2026-11-17T10:00')).toBe('2026-11-17T04:30:00.000Z');
    expect(wallTimeToIso('2026-11-17')).toBeNull();
    expect(isoToWallTime('2026-11-17T04:30:00.000Z')).toBe('2026-11-17T10:00');
  });

  it('defaults to tomorrow 10:00 IST, by the IST date', () => {
    // 2026-11-16 20:00 UTC is already 17 Nov 01:30 in IST → tomorrow is the 18th.
    expect(defaultDueWallTime(new Date('2026-11-16T20:00:00Z'))).toBe('2026-11-18T10:00');
    expect(defaultDueWallTime(new Date('2026-11-16T05:00:00Z'))).toBe('2026-11-17T10:00');
  });
});
