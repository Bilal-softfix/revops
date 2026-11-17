// Copy for Settings → Lead sources (M2-T1).

export const leadSourceStrings = {
  title: 'Lead sources',
  description:
    'Where your leads come from. Website forms and API sources get a public key; API sources also get a webhook secret.',
  empty: 'No lead sources yet.',
  newSource: 'New source',
  newSourceTitle: 'New lead source',
  fields: { name: 'Name', type: 'Type' },
  columns: {
    name: 'Name',
    type: 'Type',
    publicKey: 'Public key',
    status: 'Status',
    actions: 'Actions',
  },
  types: {
    web_form: 'Website form',
    api: 'API / webhook',
    csv: 'CSV import',
    phone: 'Phone',
    whatsapp: 'WhatsApp',
    meta: 'Meta lead ads',
    manual: 'Manual entry',
    walk_in: 'Walk-in',
  },
  active: 'Active',
  inactive: 'Paused',
  activate: 'Resume',
  deactivate: 'Pause',
  rename: 'Rename',
  renameTitle: (name: string) => `Rename “${name}”`,
  rotateKey: 'New public key',
  rotateKeyConfirm:
    'Forms and webhooks using the current key stop working right away. Update them with the new key.',
  rotateSecret: 'New webhook secret',
  rotateSecretConfirm:
    'The current secret stops working right away. Update the sending system with the new one.',
  delete: 'Delete',
  deleteConfirmTitle: (name: string) => `Delete ${name}?`,
  deleteConfirmBody:
    'New leads can’t use this source any more. Existing leads keep it for reporting.',
  copy: 'Copy',
  copied: 'Copied',
  secretTitle: 'Webhook secret',
  secretBody:
    'Copy it now and store it in the sending system — it won’t be shown again. Use it to sign each request (HMAC-SHA256).',
  secretDone: 'I’ve saved it',
  created: (name: string) => `${name} created`,
  saved: 'Saved',
  deleted: (name: string) => `${name} deleted`,
  keyRotated: 'New public key created',
  confirm: 'Continue',
  assignment: {
    label: 'Assign new leads to',
    roundRobin: 'Agents in turn (round-robin)',
    unassigned: 'Nobody (leave unassigned)',
  },
} as const;
