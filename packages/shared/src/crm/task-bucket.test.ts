import { describe, expect, it } from 'vitest';
import { type TaskBucket, dayBounds, taskBucket } from './activities.js';

const IST = 'Asia/Kolkata';
const at = (iso: string) => new Date(iso);
// IST = UTC+5:30, so local midnight of 17 Nov is 2026-11-16T18:30:00Z.
const NOW_2345 = at('2026-11-16T18:15:00Z');
const NOW_0000 = at('2026-11-16T18:30:00Z');
const NOW_0015 = at('2026-11-16T18:45:00Z');
const MIDNIGHT_16_17 = at('2026-11-16T18:30:00Z');
const MIDNIGHT_17_18 = at('2026-11-17T18:30:00Z');
const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);

describe('dayBounds around the IST day boundary', () => {
  it('at 23:45 IST today ends in 15 minutes', () => {
    const b = dayBounds(NOW_2345, IST);
    expect(b.startOfToday).toEqual(at('2026-11-15T18:30:00Z'));
    expect(b.startOfTomorrow).toEqual(MIDNIGHT_16_17);
  });

  it('at exactly 00:00 IST the new day has already started (now == startOfToday)', () => {
    const b = dayBounds(NOW_0000, IST);
    expect(b.startOfToday).toEqual(NOW_0000);
    expect(b.startOfTomorrow).toEqual(MIDNIGHT_17_18);
  });

  it('one millisecond before 00:00 IST still belongs to the previous day', () => {
    const b = dayBounds(plus(NOW_0000, -1), IST);
    expect(b.startOfToday).toEqual(at('2026-11-15T18:30:00Z'));
    expect(b.startOfTomorrow).toEqual(NOW_0000);
  });

  it('at 00:15 IST the day is the new one', () => {
    const b = dayBounds(NOW_0015, IST);
    expect(b.startOfToday).toEqual(MIDNIGHT_16_17);
    expect(b.startOfTomorrow).toEqual(MIDNIGHT_17_18);
  });
});

type Case = [label: string, due: Date, expected: TaskBucket];

describe('taskBucket at 23:45 IST (18:15Z)', () => {
  const cases: Case[] = [
    ['1s before now', plus(NOW_2345, -1000), 'overdue'],
    ['1ms before now', plus(NOW_2345, -1), 'overdue'],
    ['exactly now', NOW_2345, 'today'],
    ['1ms after now', plus(NOW_2345, 1), 'today'],
    ['1ms before next midnight', plus(MIDNIGHT_16_17, -1), 'today'],
    ['exactly next midnight', MIDNIGHT_16_17, 'upcoming'],
    ['1ms after next midnight', plus(MIDNIGHT_16_17, 1), 'upcoming'],
    ['a week out', plus(NOW_2345, 7 * 24 * 3_600_000), 'upcoming'],
  ];
  it.each(cases)('%s', (_label, due, expected) => {
    expect(taskBucket(due, NOW_2345, IST)).toBe(expected);
  });
});

describe('taskBucket at exactly 00:00 IST (18:30Z)', () => {
  const cases: Case[] = [
    ['1ms before now (23:59:59.999 yesterday)', plus(NOW_0000, -1), 'overdue'],
    ['due at 00:00 that same instant', NOW_0000, 'today'],
    ['1ms after now', plus(NOW_0000, 1), 'today'],
    ['1ms before the next midnight', plus(MIDNIGHT_17_18, -1), 'today'],
    ['exactly the next midnight', MIDNIGHT_17_18, 'upcoming'],
    ['1ms after the next midnight', plus(MIDNIGHT_17_18, 1), 'upcoming'],
  ];
  it.each(cases)('%s', (_label, due, expected) => {
    expect(taskBucket(due, NOW_0000, IST)).toBe(expected);
  });
});

describe('taskBucket at 00:15 IST (18:45Z)', () => {
  const cases: Case[] = [
    ['1ms before now', plus(NOW_0015, -1), 'overdue'],
    ['at 00:00 (15 minutes ago)', MIDNIGHT_16_17, 'overdue'],
    ['exactly now', NOW_0015, 'today'],
    ['1ms after now', plus(NOW_0015, 1), 'today'],
    ['1ms before next midnight', plus(MIDNIGHT_17_18, -1), 'today'],
    ['exactly next midnight', MIDNIGHT_17_18, 'upcoming'],
    ['1ms after next midnight', plus(MIDNIGHT_17_18, 1), 'upcoming'],
  ];
  it.each(cases)('%s', (_label, due, expected) => {
    expect(taskBucket(due, NOW_0015, IST)).toBe(expected);
  });
});

describe('taskBucket as the clock crosses midnight IST', () => {
  it('a task due 23:50 is today at 23:45 and overdue at 00:00 and 00:15', () => {
    const due = at('2026-11-16T18:20:00Z');
    expect(taskBucket(due, NOW_2345, IST)).toBe('today');
    expect(taskBucket(due, NOW_0000, IST)).toBe('overdue');
    expect(taskBucket(due, NOW_0015, IST)).toBe('overdue');
  });

  it('a task due 00:00 sharp is upcoming at 23:45, today at 00:00, overdue at 00:15', () => {
    expect(taskBucket(MIDNIGHT_16_17, NOW_2345, IST)).toBe('upcoming');
    expect(taskBucket(MIDNIGHT_16_17, NOW_0000, IST)).toBe('today');
    expect(taskBucket(MIDNIGHT_16_17, NOW_0015, IST)).toBe('overdue');
  });

  it('a task due 00:10 is upcoming at 23:45 and becomes today at 00:00', () => {
    const due = at('2026-11-16T18:40:00Z');
    expect(taskBucket(due, NOW_2345, IST)).toBe('upcoming');
    expect(taskBucket(due, NOW_0000, IST)).toBe('today');
  });

  it('a task due tomorrow 23:59 stays upcoming at 23:45 but is today at 00:00', () => {
    const due = at('2026-11-17T18:29:00Z');
    expect(taskBucket(due, NOW_2345, IST)).toBe('upcoming');
    expect(taskBucket(due, NOW_0000, IST)).toBe('today');
  });
});

describe('taskBucket in other time zones', () => {
  it('uses the zone, not UTC, to decide where "today" ends', () => {
    const now = at('2026-11-16T20:00:00Z'); // 01:30 on 17 Nov in IST, 20:00 on 16 Nov in UTC
    const due = at('2026-11-16T23:00:00Z');
    expect(taskBucket(due, now, IST)).toBe('today');
    expect(taskBucket(due, now, 'UTC')).toBe('today');
    expect(taskBucket(at('2026-11-17T00:00:00Z'), now, 'UTC')).toBe('upcoming');
    expect(taskBucket(at('2026-11-17T00:00:00Z'), now, IST)).toBe('today');
  });
});
