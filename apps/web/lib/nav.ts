import { type Permission, type Role, hasPermission } from '@revops/shared';
import {
  Contact,
  Handshake,
  KanbanSquare,
  LayoutDashboard,
  ListPlus,
  type LucideIcon,
  SlidersHorizontal,
  ListTodo,
  Users,
} from 'lucide-react';
import { shellStrings } from '@/lib/strings/shell';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shown only to roles with this permission (role-based navigation). */
  permission?: Permission;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

/**
 * The sidebar, as data. Later milestones add items here with the permission that guards their
 * API routes (e.g. Leads → lead.read.*); items without a permission are visible to every member.
 */
export const NAV: readonly NavSection[] = [
  {
    label: shellStrings.nav.main,
    items: [
      { href: '/dashboard', label: shellStrings.nav.dashboard, icon: LayoutDashboard },
      {
        href: '/leads',
        label: shellStrings.nav.leads,
        icon: Handshake,
        permission: 'lead.read.assigned',
      },
      {
        href: '/contacts',
        label: shellStrings.nav.contacts,
        icon: Contact,
        permission: 'lead.read.assigned',
      },
      {
        href: '/tasks',
        label: shellStrings.nav.tasks,
        icon: ListTodo,
        permission: 'lead.read.assigned',
      },
    ],
  },
  {
    label: shellStrings.nav.settings,
    items: [
      {
        href: '/settings/team',
        label: shellStrings.nav.team,
        icon: Users,
        permission: 'member.read',
      },
      {
        href: '/settings/custom-fields',
        label: shellStrings.nav.customFields,
        icon: ListPlus,
        permission: 'customfield.manage',
      },
      {
        href: '/settings/pipelines',
        label: shellStrings.nav.pipelines,
        icon: KanbanSquare,
        permission: 'pipeline.manage',
      },
      {
        href: '/settings/crm',
        label: shellStrings.nav.crmSettings,
        icon: SlidersHorizontal,
        permission: 'crm.settings.manage',
      },
    ],
  },
];

/** The sections and items a role may see; empty sections are dropped. */
export function navFor(role: Role | null | undefined): NavSection[] {
  return NAV.map((section) => ({
    ...section,
    items: section.items.filter((item) => !item.permission || hasPermission(role, item.permission)),
  })).filter((section) => section.items.length > 0);
}
