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
    'Copy it now and store it in the sending system — it won’t be shown again. Use it to sign each request (HMAC-SHA256), or send it as X-Webhook-Token in simple-token mode.',
  secretDone: 'I’ve saved it',
  created: (name: string) => `${name} created`,
  saved: 'Saved',
  deleted: (name: string) => `${name} deleted`,
  keyRotated: 'New public key created',
  confirm: 'Continue',
  form: {
    open: 'Form settings',
    title: (name: string) => `Website form · ${name}`,
    description:
      'Paste the code into your website. Only the websites listed below may send leads to this form.',
    origins: 'Allowed websites (one per line)',
    originsHint: 'Exactly as in the address bar, e.g. https://www.example.com — no page path.',
    captcha: 'Require a captcha',
    captchaHint:
      'Add a Cloudflare Turnstile widget inside your form; the code sends its token for you.',
    mapping: 'Field names (optional)',
    mappingHint:
      'Only if your form uses other names: “form field = name | phone | email | city | lead.<field key>”. name, phone, email, city, mobile and full_name work without this.',
    mappingBadLines: (lines: number[]) =>
      `Can’t read line ${lines.join(', ')} of the field names — use “form field = target”.`,
    snippet: 'Code for your website',
    copySnippet: 'Copy code',
    snippetHint: 'Leads arrive in RevOps with the visitor’s campaign details (UTM, gclid, fbclid).',
  },
  webhook: {
    url: 'Webhook URL',
    signing:
      'POST JSON like {"id":"<your unique id>","name":…,"phone":…,"email":…}. Sign each request with the webhook secret: header X-RevOps-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">. The same id twice creates one lead.',
    tokenUsage:
      'POST JSON like {"id":"<your unique id>","name":…,"phone":…,"email":…} with the webhook secret in the header X-Webhook-Token. The same id twice creates one lead.',
    auth: {
      label: 'Authentication',
      hmac: 'Signed requests (HMAC) — recommended',
      token: 'Simple token (less secure) — for Zapier, Make',
      tokenWarning:
        'Less secure: the secret itself travels with every request and a captured request can be replayed. Use it only for tools that can’t sign requests, and rotate the secret if it leaks.',
    },
    rejected: {
      open: 'Rejected deliveries',
      close: 'Hide rejected deliveries',
      title: 'Rejected deliveries (last 7 days)',
      hint: 'Requests that failed authentication. Up to 20 per hour are kept, first 16 KB each — they were not checked, so treat the content as untrusted.',
      empty: 'No rejected deliveries.',
      truncated: '(cut at 16 KB)',
      reasons: {
        signature_missing: 'No signature header',
        signature_malformed: 'Signature header unreadable',
        signature_stale: 'Signature too old or clock off (over 5 minutes)',
        signature_mismatch: 'Wrong signature (wrong secret or changed body)',
        token_missing: 'No X-Webhook-Token header',
        token_mismatch: 'Wrong token',
      } as Record<string, string>,
    },
  },
  imports: {
    open: 'Import CSV',
    title: (name: string) => `Import CSV · ${name}`,
    description:
      'Upload a .csv file (up to 10 MB, 50,000 rows) with column names in the first row. Each row needs a phone number or email.',
    file: 'CSV file',
    upload: 'Upload',
    uploading: 'Uploading…',
    mappingTitle: 'Match the columns',
    mappingHint:
      'Choose where each column goes. Columns set to “Ignore” are not imported. The first 20 rows are shown.',
    ignore: 'Ignore',
    targets: { name: 'Name', phone: 'Phone', email: 'Email', city: 'City' },
    leadField: (label: string) => `Lead field: ${label}`,
    needContact: 'Match a phone or email column to continue.',
    start: (rows: number) => `Import ${rows.toLocaleString('en-IN')} rows`,
    started: 'Import started — it runs in the background.',
    recent: 'Recent imports',
    none: 'No imports yet.',
    status: {
      uploaded: 'Not started',
      queued: 'Waiting',
      processing: 'Importing',
      completed: 'Done',
      failed: 'Failed',
    },
    progress: (done: number, total: number) =>
      `${done.toLocaleString('en-IN')} of ${total.toLocaleString('en-IN')} rows`,
    summary: (c: { created: number; reenquiry: number; duplicate: number; failed: number }) =>
      [
        `${c.created.toLocaleString('en-IN')} new`,
        `${c.reenquiry.toLocaleString('en-IN')} re-enquiries`,
        `${c.duplicate.toLocaleString('en-IN')} already imported`,
        `${c.failed.toLocaleString('en-IN')} not imported`,
      ].join(' · '),
    errorReport: 'Download rows not imported',
    failedReasons: {
      file_missing: 'The uploaded file was lost — upload it again.',
      source_deleted: 'The source was deleted.',
    } as Record<string, string>,
  },
  assignment: {
    label: 'Assign new leads to',
    roundRobin: 'Agents in turn (round-robin)',
    unassigned: 'Nobody (leave unassigned)',
  },
} as const;
