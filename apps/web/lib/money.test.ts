import { describe, expect, it } from 'vitest';
import { formatPaise, paiseToRupeesInput, rupeesToPaise } from './money';

describe('money (paise ⇄ rupees)', () => {
  it.each([
    ['2499.50', 249_950],
    ['2499.5', 249_950],
    ['₹2,499', 249_900],
    ['0.01', 1],
    ['  100 ', 10_000],
    ['', null],
  ])('%j → %j paise', (input, paise) => {
    expect(rupeesToPaise(input)).toBe(paise);
  });

  it.each(['abc', '1.234', '-5', '1e5', '1.2.3'])('%j is invalid', (input) => {
    expect(rupeesToPaise(input)).toBeUndefined();
  });

  it('formats in Indian grouping and round-trips the input value', () => {
    expect(formatPaise(12_345_678_900)).toBe('₹12,34,56,789');
    expect(formatPaise(null)).toBe('—');
    expect(paiseToRupeesInput(249_950)).toBe('2499.50');
    expect(paiseToRupeesInput(10_000)).toBe('100');
    expect(rupeesToPaise(paiseToRupeesInput(249_905))).toBe(249_905);
  });
});
