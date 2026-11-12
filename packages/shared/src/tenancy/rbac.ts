import { ROLES, type Role } from './enums.js';

// Role → permission map (docs/01-architecture.md § RBAC). Data, not code: add a permission here and
// guard a route with @RequirePermission('<permission>'). Later milestones extend the list
// (lead.read.all, lead.read.assigned, routing.manage, …).

export const PERMISSIONS = [
  /** See the tenant's members (team page). */
  'member.read',
  /** Invite people; list, resend and revoke pending invitations. */
  'member.invite',
  /** Change members' roles; disable / re-enable members. */
  'member.manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  owner: ['member.read', 'member.invite', 'member.manage'],
  admin: ['member.read', 'member.invite', 'member.manage'],
  manager: ['member.read'],
  agent: ['member.read'],
};

export function hasPermission(role: Role | null | undefined, permission: Permission): boolean {
  return role ? ROLE_PERMISSIONS[role].includes(permission) : false;
}

/** Roles an actor may grant (invite with, or change someone to). Only owners create owners. */
export function assignableRoles(actor: Role): readonly Role[] {
  if (actor === 'owner') return ROLES;
  if (actor === 'admin') return ROLES.filter((role) => role !== 'owner');
  return [];
}

/** Whether an actor may change / disable a member (or invitation) that currently has `target`. */
export function canManageRole(actor: Role, target: Role): boolean {
  return hasPermission(actor, 'member.manage') && assignableRoles(actor).includes(target);
}
