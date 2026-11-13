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
