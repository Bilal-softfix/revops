import { describe, expect, it } from 'vitest';
import { formatPhone, maskE164, normalizePhone, phoneSchema } from './phone.js';

describe('normalizePhone (M1-T1: Indian formats → E.164)', () => {
  it.each([
    ['09876543210', '+919876543210'],
    ['+91 98765 43210', '+919876543210'],
    ['98765-43210', '+919876543210'],
    ['0091 98765 43210', '+919876543210'],
    ['+919876543210', '+919876543210'],
    ['919876543210', '+919876543210'],
    ['98765.43210', '+919876543210'],
    ['(98765) 43210', '+919876543210'],
    ['  9876543210  ', '+919876543210'],
    ['+91-98765-43210', '+919876543210'],
    ['022-2345 6789', '+912223456789'],
    ['080 4123 4567', '+918041234567'],
    ['+1 415 555 0123', '+14155550123'],
    ['+44 20 7946 0958', '+442079460958'],
  ])('%s → %s', (input, e164) => expect(normalizePhone(input)).toBe(e164));

  it.each(['12345', 'abc', '', '+91 98765', '9'.repeat(40), '+999 123'])('rejects %j', (input) =>
    expect(normalizePhone(input)).toBeNull(),
  );

  it('phoneSchema outputs E.164 and gives a friendly error', () => {
    expect(phoneSchema.parse('098765 43210')).toBe('+919876543210');
    const bad = phoneSchema.safeParse('12');
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.message).toMatch(/valid phone number/);
  });

  it('formatPhone groups for display', () => {
    expect(formatPhone('+919876543210')).toBe('+91 98765 43210');
    expect(formatPhone(null)).toBe('');
  });

  it('maskE164 keeps the country code and last four digits', () => {
    expect(maskE164('+919876543210')).toBe('+91******3210');
  });
});
