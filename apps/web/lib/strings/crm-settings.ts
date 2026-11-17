// Copy for Settings → CRM settings (M1-T3b).

export const crmSettingsStrings = {
  title: 'CRM settings',
  description: 'How your team works with contacts and leads.',
  visibility: {
    legend: 'Which contacts can agents see?',
    hint: 'Owners, admins and managers always see every contact. Leads always follow assignment.',
    all: 'All contacts',
    allHint: 'Good for a counter or front desk where anyone may serve any customer.',
    assigned: 'Only their own',
    assignedHint: 'Contacts they created, or that belong to leads assigned to them.',
  },
  agentExport: {
    legend: 'Can agents export leads?',
    label: 'Let agents export their own leads as CSV',
    hint: 'Owners, admins and managers can always export. Agents only ever get the leads assigned to them.',
  },
  save: 'Save',
  saved: 'Settings saved',
} as const;
