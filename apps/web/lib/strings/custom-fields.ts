// Copy for Settings → Custom fields (M1-T2).

export const customFieldStrings = {
  title: 'Custom fields',
  description:
    'Extra details you track on contacts and leads. Your business type set these up; change them any time.',
  sections: { contact: 'Contact fields', lead: 'Lead fields' },
  empty: 'No fields yet.',
  add: 'Add field',
  addTitle: 'Add a custom field',
  editTitle: (label: string) => `Edit “${label}”`,
  columns: { label: 'Label', key: 'Key', type: 'Type', required: 'Required', actions: 'Actions' },
  types: {
    text: 'Text',
    number: 'Number',
    date: 'Date',
    select: 'Choice (one)',
    multiselect: 'Choice (many)',
    bool: 'Yes / no',
  },
  fields: {
    entity: 'Applies to',
    label: 'Label',
    key: 'Key',
    keyHint: 'Used in imports and exports. Can’t be changed later.',
    type: 'Type',
    typeHint: 'Can’t be changed later.',
    required: 'Required',
    options: 'Options (one per line)',
    existingOptions: 'Options (rename only)',
    newOptions: 'Add options (one per line)',
  },
  yes: 'Yes',
  no: 'No',
  edit: 'Edit',
  delete: 'Delete',
  save: 'Save',
  created: (label: string) => `Field “${label}” added`,
  saved: 'Field saved',
  deleted: (label: string) => `Field “${label}” deleted`,
  deleteConfirmTitle: (label: string) => `Delete “${label}”?`,
  deleteConfirmBody:
    'It disappears from forms and lists. Values already saved are kept but hidden. The key can’t be reused.',
} as const;
