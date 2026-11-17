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
  dedupe: {
    legend: 'When a form, webhook or import brings in someone you already have',
    hint: 'Matched on phone number first, then email. Leads you add by hand always create a new lead.',
    reenquiry: 'Add it to their open lead',
    reenquiryHint:
      'Shows as a re-enquiry on the open lead. If all their leads are closed, a new lead is created.',
    always_new: 'Always create a new lead',
    always_newHint: 'Every enquiry becomes its own lead, linked to the same contact.',
  },
  save: 'Save',
  saved: 'Settings saved',
} as const;
