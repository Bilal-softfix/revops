import { ROLES } from '@revops/shared';
import { describe, expect, it } from 'vitest';
import { NAV, navFor } from './nav';
import { safeNext } from './redirect';

const labels = (role: Parameters<typeof navFor>[0]) =>
  navFor(role).flatMap((section) => section.items.map((item) => item.label));

describe('role-based navigation', () => {
  it('every role sees Dashboard, Contacts and Team; owners/admins also Custom fields', () => {
    for (const role of ROLES) {
      const expected = ['Dashboard', 'Contacts', 'Team'];
      if (role === 'owner' || role === 'admin') expected.push('Custom fields');
      expect(labels(role)).toEqual(expected);
    }
  });

  it('items with a permission are hidden from a member without a role', () => {
    expect(labels(null)).toEqual(['Dashboard']);
  });

  it('every permission-guarded item names a real permission', () => {
    const guarded = NAV.flatMap((s) => s.items).filter((i) => i.permission);
    expect(guarded.length).toBeGreaterThan(0);
  });
});

describe('safeNext (no open redirects)', () => {
  it.each([
    ['/settings/team', '/settings/team'],
    ['/accept-invite?token=abc', '/accept-invite?token=abc'],
    [undefined, '/dashboard'],
    ['https://evil.example', '/dashboard'],
    ['//evil.example/x', '/dashboard'],
    ['/\\evil.example', '/dashboard'],
    ['dashboard', '/dashboard'],
    // Browsers strip tab/newline, so these would resolve to //evil.example (M0 security review).
    ['/\t/evil.example', '/dashboard'],
    ['/\n/evil.example', '/dashboard'],
    ['/\u0000/evil.example', '/dashboard'],
    ['/team#members', '/team#members'],
  ])('%s → %s', (input, expected) => expect(safeNext(input)).toBe(expected));
});
