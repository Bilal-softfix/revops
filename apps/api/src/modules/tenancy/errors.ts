import type { TenancyErrorCode } from '@revops/shared';
import { DomainError } from '../../platform/errors/domain-error';

const error = (code: TenancyErrorCode, status: number, title: string, detail?: string) =>
  new DomainError(code, status, title, detail ? { detail } : {});

export const forbidden = () => error('forbidden', 403, 'You don’t have permission to do that');
export const noActiveTenant = () =>
  error('no_active_tenant', 403, 'Choose a workspace first', 'Your session has no active tenant.');
export const notFound = () => error('not_found', 404, 'Not found');
export const lastOwner = () =>
  error(
    'last_owner',
    409,
    'A workspace needs at least one active owner',
    'Make someone else an owner first.',
  );
export const cannotChangeSelf = () =>
  error('cannot_change_self', 409, 'You can’t disable yourself');
export const alreadyMember = () =>
  error('already_member', 409, 'This person is already a member of the workspace');
export const invitationExists = () =>
  error(
    'invitation_exists',
    409,
    'There is already a pending invitation for this email',
    'Resend or revoke it instead.',
  );
export const invalidInvitation = () =>
  error('invalid_invitation', 400, 'This invitation is invalid, expired or already used');
export const invitationLoginRequired = () =>
  error(
    'invitation_login_required',
    401,
    'Sign in to accept this invitation',
    'This email already has an account: sign in as it, then open the link again.',
  );
export const invitationEmailMismatch = () =>
  error(
    'invitation_email_mismatch',
    403,
    'This invitation is for a different email',
    'Sign out and sign in with the invited email address.',
  );
export const invitationDetailsRequired = () =>
  error(
    'invitation_details_required',
    400,
    'Choose your name and password to accept',
    'Send `name` and `password` with the token.',
  );
