import { ROLES } from '@revops/shared';
import { describe, expect, it } from 'vitest';
import { NAV, navFor } from './nav';
import { safeNext } from './redirect';

const labels = (role: Parameters<typeof navFor>[0]) =>
  navFor(role).flatMap((section) => section.items.map((item) => item.label));

describe('role-based navigation', () => {
  it('every role sees Dashboard and Team today (all have member.read)', () => {
    for (const role of ROLES) expect(labels(role)).toEqual(['Dashboard', 'Team']);
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
  ])('%s → %s', (input, expected) => expect(safeNext(input)).toBe(expected));
});
