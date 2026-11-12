import { describe, expect, it } from 'vitest';
import { maskDeep, maskEmail, maskPhone, maskPii } from './mask';

describe('PII masking', () => {
  it.each([
    ['asha@example.com', 'a***@example.com'],
    ['x@y.in', 'x***@y.in'],
    ['not-an-email', '***'],
  ])('maskEmail(%s) → %s', (input, out) => expect(maskEmail(input)).toBe(out));

  it('masks E.164 phones as +91******3210 (CLAUDE.md rule 7)', () => {
    expect(maskPhone('+919876543210')).toBe('+91******3210');
    expect(maskPhone('+14155550123')).toBe('+14*****0123');
  });

  it('masks every email and phone inside free text, leaving the rest', () => {
    expect(
      maskPii('signup a.b+c@mail.example.co.in from +919876543210, then ops@revops.in; id 42'),
    ).toBe('signup a***@mail.example.co.in from +91******3210, then o***@revops.in; id 42');
  });

  it('leaves non-PII alone (uuids, short numbers, urls without emails)', () => {
    const text = 'tenant 00000000-0000-4000-8000-00000000d3e0 status 202 http://localhost:3000/x';
    expect(maskPii(text)).toBe(text);
  });

  it('maskDeep masks nested strings, keeps other types, survives cycles', () => {
    const cyclic: Record<string, unknown> = { to: 'ravi@example.in', n: 3, ok: true };
    cyclic.self = cyclic;
    const out = maskDeep({ user: cyclic, list: ['+919876543210'] }) as {
      user: Record<string, unknown>;
      list: string[];
    };
    expect(out.user.to).toBe('r***@example.in');
    expect(out.user.n).toBe(3);
    expect(out.user.self).toBe('[truncated]');
    expect(out.list).toEqual(['+91******3210']);
  });
});
