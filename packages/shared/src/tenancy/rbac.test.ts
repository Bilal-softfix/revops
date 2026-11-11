import { describe, expect, it } from 'vitest';
import { ROLES } from './enums.js';
import { assignableRoles, canManageRole, hasPermission } from './rbac.js';

describe('RBAC map', () => {
  it.each([
    ['owner', true, true],
    ['admin', true, true],
    ['manager', false, false],
    ['agent', false, false],
  ] as const)('%s: invite=%s manage=%s, and everyone can read members', (role, invite, manage) => {
    expect(hasPermission(role, 'member.read')).toBe(true);
    expect(hasPermission(role, 'member.invite')).toBe(invite);
    expect(hasPermission(role, 'member.manage')).toBe(manage);
  });

  it('no role (no active tenant) has no permission', () => {
    expect(hasPermission(null, 'member.read')).toBe(false);
  });

  it('only owners can grant owner; admins grant admin/manager/agent; others nothing', () => {
    expect(assignableRoles('owner')).toEqual(ROLES);
    expect(assignableRoles('admin')).toEqual(['admin', 'manager', 'agent']);
    expect(assignableRoles('manager')).toEqual([]);
    expect(assignableRoles('agent')).toEqual([]);
  });

  it('admins can manage everyone but owners; managers/agents manage nobody', () => {
    expect(canManageRole('owner', 'owner')).toBe(true);
    expect(canManageRole('admin', 'owner')).toBe(false);
    expect(canManageRole('admin', 'admin')).toBe(true);
    expect(canManageRole('manager', 'agent')).toBe(false);
    expect(canManageRole('agent', 'agent')).toBe(false);
  });
});
