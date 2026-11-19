import { describe, expect, it } from 'vitest';
import { formatDuration } from './duration';

const at = (seconds: number) => new Date(Date.UTC(2026, 10, 17) + seconds * 1000).toISOString();
const from = at(0);

describe('formatDuration', () => {
  it.each([
    [0, '0 s'],
    [45, '45 s'],
    [60, '1 min'],
    [7 * 60 + 29, '7 min'],
    [3600, '1 h'],
    [3 * 3600 + 5 * 60, '3 h 5 min'],
    [86400, '1 d'],
    [2 * 86400 + 4 * 3600 + 59, '2 d 4 h'],
    [-30, '0 s'],
  ])('%i s → %s', (seconds, text) => {
    expect(formatDuration(from, at(seconds))).toBe(text);
  });
});
