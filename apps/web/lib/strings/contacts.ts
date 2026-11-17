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
  deleteConfirmBody:
    'The contact is hidden from everyone. Its history is kept. A contact that still has leads can’t be deleted — delete or move its leads first.',
  deleted: (name: string) => `${name} deleted`,
  back: 'All contacts',
  merge: {
    open: 'Merge duplicate',
    title: (name: string) => `Merge a duplicate into ${name}`,
    description:
      'Find the duplicate contact. Its leads, notes, tasks and history move here, then it is removed.',
    searchLabel: 'Search contacts',
    searchPlaceholder: 'Name, phone or email',
    candidates: 'Matching contacts',
    noMatches: 'No other contacts match.',
    mergingFrom: (name: string) => `Merging ${name} into this contact. Choose what to keep:`,
    nothingToPick: 'Nothing differs — everything here is kept.',
    consequence: 'Numbers that aren’t kept are saved as alternate numbers. This can’t be undone.',
    fields: { name: 'Name', phone: 'Phone', email: 'Email', city: 'City' },
    empty: '(empty)',
    back: 'Pick another',
    submit: 'Merge contacts',
    done: (name: string) => `${name} merged`,
  },
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
    phoneHint: 'Phone or email required. Any format: 98765 43210, +91 98765 43210.',
    phonePreview: (formatted: string) => `Saved as ${formatted}`,
    email: 'Email',
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
