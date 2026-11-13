// Copy for the signed-in app shell and dashboard.

export const shellStrings = {
  nav: {
    main: 'Workspace',
    settings: 'Settings',
    dashboard: 'Dashboard',
    contacts: 'Contacts',
    team: 'Team',
  },
  tenantSwitcher: {
    label: 'Switch workspace',
    current: 'Current workspace',
    switched: (name: string) => `Switched to ${name}`,
  },
  userMenu: {
    label: 'Account menu',
    signOut: 'Sign out',
    role: (role: string) => `Role: ${role}`,
  },
  noTenant: {
    title: 'No active workspace',
    body: 'Your access to every workspace has been removed or disabled. Ask an owner to invite you again.',
  },
  dashboard: {
    title: (tenant: string) => `Welcome to ${tenant}`,
    body: 'Leads, calls and follow-ups will show up here.',
    emptyTitle: 'No leads yet',
    emptyBody:
      'Lead capture arrives in the next release. For now, invite your team from Settings → Team.',
  },
  roles: {
    owner: 'Owner',
    admin: 'Admin',
    manager: 'Manager',
    agent: 'Agent',
  },
} as const;
