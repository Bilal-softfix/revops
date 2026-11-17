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
  /** Work with own/assigned leads and the CRM setup they need (pipelines, sources, fields). */
  'lead.read.assigned',
  /** See every lead and contact in the tenant (not just own/assigned). */
  'lead.read.all',
  /** Create leads and edit / move the leads the member can see. */
  'lead.write',
  /** Choose or change a lead's owner (else a creator owns their own leads). */
  'lead.assign',
  /** Delete (soft) leads. */
  'lead.delete',
  /** Bulk actions on leads: bulk assign and bulk stage move (M1-T6). */
  'lead.bulk',
  /**
   * Export leads as CSV — the leads the member can see (M1-T6). Agents don't have it; a tenant can
   * let them export their own leads with the CRM setting `allowAgentExport`.
   */
  'lead.export',
  /** Create and edit contacts the member can see. */
  'contact.write',
  /** Delete (soft) contacts. */
  'contact.delete',
  /** Change the tenant's CRM settings (e.g. agent contact visibility). */
  'crm.settings.manage',
  /** Create, edit and delete custom field definitions. */
  'customfield.manage',
  /** Create, edit, reorder and delete pipelines and their stages. */
  'pipeline.manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  owner: [
    'member.read',
    'member.invite',
    'member.manage',
    'lead.read.assigned',
    'lead.read.all',
    'lead.write',
    'lead.assign',
    'lead.delete',
    'lead.bulk',
    'lead.export',
    'contact.write',
    'contact.delete',
    'crm.settings.manage',
    'customfield.manage',
    'pipeline.manage',
  ],
  admin: [
    'member.read',
    'member.invite',
    'member.manage',
    'lead.read.assigned',
    'lead.read.all',
    'lead.write',
    'lead.assign',
    'lead.delete',
    'lead.bulk',
    'lead.export',
    'contact.write',
    'contact.delete',
    'crm.settings.manage',
    'customfield.manage',
    'pipeline.manage',
  ],
  manager: [
    'member.read',
    'lead.read.assigned',
    'lead.read.all',
    'lead.write',
    'lead.assign',
    'lead.delete',
    'lead.bulk',
    'lead.export',
    'contact.write',
    'contact.delete',
  ],
  agent: ['member.read', 'lead.read.assigned', 'lead.write', 'contact.write'],
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
