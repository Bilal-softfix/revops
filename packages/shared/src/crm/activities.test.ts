import { describe, expect, it } from 'vitest';
import {
  createNoteRequestSchema,
  createTaskRequestSchema,
  dayBounds,
  myTasksQuerySchema,
  updateTaskRequestSchema,
} from './activities.js';

describe('dayBounds', () => {
  it('Asia/Kolkata: midnight IST is 18:30 UTC the day before', () => {
    // 2026-11-16 23:00 IST = 17:30 UTC.
    const b = dayBounds(new Date('2026-11-16T17:30:00Z'), 'Asia/Kolkata');
    expect(b.startOfToday.toISOString()).toBe('2026-11-15T18:30:00.000Z');
    expect(b.startOfTomorrow.toISOString()).toBe('2026-11-16T18:30:00.000Z');
  });

  it('Asia/Kolkata: just after IST midnight is already the next day', () => {
    // 2026-11-17 00:10 IST = 2026-11-16 18:40 UTC.
    const b = dayBounds(new Date('2026-11-16T18:40:00Z'), 'Asia/Kolkata');
    expect(b.startOfToday.toISOString()).toBe('2026-11-16T18:30:00.000Z');
  });

  it('handles month/year ends and UTC', () => {
    const b = dayBounds(new Date('2026-12-31T20:00:00Z'), 'Asia/Kolkata'); // 1 Jan 01:30 IST
    expect(b.startOfToday.toISOString()).toBe('2026-12-31T18:30:00.000Z');
    expect(b.startOfTomorrow.toISOString()).toBe('2027-01-01T18:30:00.000Z');
    const utc = dayBounds(new Date('2026-03-01T00:00:00Z'), 'UTC');
    expect(utc.startOfToday.toISOString()).toBe('2026-03-01T00:00:00.000Z');
  });

  it('DST zones get their real local midnight', () => {
    // New York, 2026-03-08 is the spring-forward day (midnight is still EST, -05:00).
    const b = dayBounds(new Date('2026-03-08T15:00:00Z'), 'America/New_York');
    expect(b.startOfToday.toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(b.startOfTomorrow.toISOString()).toBe('2026-03-09T04:00:00.000Z');
  });
});

describe('notes and tasks', () => {
  it('a note needs a non-blank body', () => {
    expect(createNoteRequestSchema.safeParse({ body: '   ' }).success).toBe(false);
    expect(createNoteRequestSchema.parse({ body: ' Called, busy ' }).body).toBe('Called, busy');
  });

  it('a task needs a title and a due date with an offset; type defaults to followup', () => {
    const ok = createTaskRequestSchema.parse({
      title: 'Call back',
      dueAt: '2026-11-17T10:00:00+05:30',
    });
    expect(ok.type).toBe('followup');
    expect(createTaskRequestSchema.safeParse({ title: 'x', dueAt: 'tomorrow' }).success).toBe(
      false,
    );
    expect(createTaskRequestSchema.safeParse({ dueAt: '2026-11-17T10:00:00Z' }).success).toBe(
      false,
    );
    expect(updateTaskRequestSchema.safeParse({}).success).toBe(false);
    expect(updateTaskRequestSchema.safeParse({ status: 'done' }).success).toBe(true);
  });

  it('My tasks defaults to today', () => {
    expect(myTasksQuerySchema.parse({})).toEqual({ bucket: 'today', limit: 50 });
    expect(myTasksQuerySchema.safeParse({ bucket: 'later' }).success).toBe(false);
  });
});
