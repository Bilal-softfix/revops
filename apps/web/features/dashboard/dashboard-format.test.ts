import { describe, expect, it } from 'vitest';
import { barPercent, greeting, initials, longDate, timeAgo } from './dashboard-format';

// IST = UTC+05:30.
const ist = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 19, h, m) - 330 * 60_000);

describe('greeting', () => {
  it.each([
    [4, 'Good evening'],
    [5, 'Good morning'],
    [11, 'Good morning'],
    [12, 'Good afternoon'],
    [16, 'Good afternoon'],
    [17, 'Good evening'],
    [23, 'Good evening'],
  ])('%i:00 IST → %s', (hour, expected) => {
    expect(greeting(ist(hour))).toBe(expected);
  });
});

describe('longDate', () => {
  it('uses the tenant day (IST), not UTC', () => {
    // 00:30 IST on 20 Nov is still 19 Nov in UTC.
    expect(longDate(new Date(Date.UTC(2026, 10, 19, 19, 0)))).toBe('Friday, 20 November');
  });
});

describe('timeAgo', () => {
  const now = ist(15);
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
  it.each([
    [10_000, 'just now'],
    [5 * 60_000, '5 min ago'],
    [3 * 3600_000, '3 h ago'],
    [2 * 86_400_000, '2 d ago'],
    [10 * 86_400_000, '9 Nov'],
  ])('%i ms → %s', (ms, expected) => {
    expect(timeAgo(ago(ms), now)).toBe(expected);
  });
  it('treats future times as now', () => {
    expect(timeAgo(new Date(now.getTime() + 60_000).toISOString(), now)).toBe('just now');
  });
});

describe('barPercent', () => {
  it('scales to the max with a visible minimum', () => {
    expect(barPercent(5, 10)).toBe(50);
    expect(barPercent(10, 10)).toBe(100);
    expect(barPercent(1, 1000)).toBe(4);
    expect(barPercent(0, 10)).toBe(0);
    expect(barPercent(3, 0)).toBe(0);
  });
});

describe('initials', () => {
  it('takes up to two words', () => {
    expect(initials('Asha Verma Rao')).toBe('AV');
    expect(initials('ravi')).toBe('R');
    expect(initials('  ')).toBe('?');
  });
});
