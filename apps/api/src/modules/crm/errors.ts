import type { ContactConflict } from '@revops/shared';
import { DomainError } from '../../platform/errors/domain-error';

export const crmNotFound = () => new DomainError('not_found', 404, 'Not found');

/**
 * 409 for a duplicate phone/email. `conflict.contact` is only present when the caller may see
 * the existing contact; otherwise they learn just that it exists and who is working it.
 */
export const contactExists = (conflict: ContactConflict) =>
  new DomainError(
    'contact_exists',
    409,
    conflict.field === 'phone'
      ? 'A contact with this phone number already exists'
      : 'A contact with this email already exists',
    { extensions: { conflict } },
  );

/** 409 when deleting a contact that still has live leads (M2-T0, Dev decision). */
export const contactHasLeads = (leadCount: number) =>
  new DomainError(
    'contact_has_leads',
    409,
    `This contact has ${leadCount} ${leadCount === 1 ? 'lead' : 'leads'} — delete them or move them to another contact first`,
    { extensions: { leadCount } },
  );

/** 409 when the contact a lead was about to link to was deleted in the meantime. */
export const contactGone = () =>
  new DomainError('contact_gone', 409, 'That contact was just deleted — reload and try again');

/** 409 when a lead changed pipeline between reading it and locking it (concurrent move). */
export const leadMoved = () =>
  new DomainError('lead_moved', 409, 'This lead was just moved — reload and try again');
