import { describe, expect, it } from 'vitest';
import { createContactRequestSchema, updateContactRequestSchema } from './contacts.js';

describe('contact requests: phone OR email', () => {
  it.each([
    ['phone only', { name: 'A', phone: '98765 43210' }],
    ['email only', { name: 'A', email: 'A@Example.com' }],
    ['both', { name: 'A', phone: '98765 43210', email: 'a@example.com' }],
  ])('accepts %s', (_label, body) => {
    expect(createContactRequestSchema.safeParse(body).success).toBe(true);
  });

  it('rejects neither, with the error on the phone field', () => {
    const result = createContactRequestSchema.safeParse({ name: 'A', city: 'Pune' });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => [i.path.join('.'), i.message])).toEqual([
      ['phone', 'Enter a phone number or an email (at least one)'],
    ]);
  });

  it('normalises: phone to E.164, email lower-case', () => {
    expect(
      createContactRequestSchema.parse({ name: 'A', phone: '098765 43210', email: 'A@X.IN' }),
    ).toMatchObject({ phone: '+919876543210', email: 'a@x.in' });
  });

  it('PATCH may clear the phone (the API checks a phone or email remains)', () => {
    expect(updateContactRequestSchema.parse({ phone: null })).toEqual({ phone: null });
  });
});
