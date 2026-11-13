// Copy for Contacts (M1-T1).

export const contactStrings = {
  title: 'Contacts',
  description: 'Everyone your team talks to: customers, walk-ins, enquiries.',
  searchLabel: 'Search contacts',
  searchPlaceholder: 'Name, phone or email',
  empty: 'No contacts yet.',
  emptySearch: 'No contacts match your search.',
  emptyBody: 'Add your first contact, or they will appear here as leads come in.',
  loadMore: 'Load more',
  new: 'New contact',
  createTitle: 'New contact',
  editTitle: 'Edit contact',
  save: 'Save contact',
  saved: 'Contact saved',
  created: (name: string) => `${name} added`,
  delete: 'Delete contact',
  deleteConfirmTitle: (name: string) => `Delete ${name}?`,
  deleteConfirmBody: 'The contact is hidden from everyone. Its history is kept.',
  deleted: (name: string) => `${name} deleted`,
  back: 'All contacts',
  columns: {
    name: 'Name',
    phone: 'Phone',
    email: 'Email',
    city: 'City',
    added: 'Added',
  },
  fields: {
    name: 'Name',
    phone: 'Phone',
    phoneHint: 'Any format: 98765 43210, 098765 43210, +91 98765 43210.',
    phonePreview: (formatted: string) => `Saved as ${formatted}`,
    email: 'Email (optional)',
    city: 'City (optional)',
  },
  conflict: {
    visible: 'A contact with this {field} already exists:',
    open: 'Open contact',
    hidden: (field: string, owner: string | null) =>
      owner
        ? `A contact with this ${field} already exists and is handled by ${owner}. Ask them or a manager to add you.`
        : `A contact with this ${field} already exists. Ask a manager to give you access.`,
  },
} as const;
