// Shared UI copy (English for MVP; one file per feature so Hindi i18n can replace them later).

export const common = {
  appName: 'RevOps',
  loading: 'Loading…',
  retry: 'Try again',
  cancel: 'Cancel',
  save: 'Save',
  close: 'Close',
  back: 'Back',
  unexpected: 'Something went wrong.',
  unexpectedDetail: 'Please try again. If it keeps happening, contact support with this reference:',
  network: 'Can’t reach RevOps. Check your connection and try again.',
  notFoundTitle: 'Page not found',
  notFoundBody: 'The page you’re looking for doesn’t exist or you don’t have access to it.',
  goHome: 'Go to dashboard',
} as const;

/** Messages for API problem `code`s that a user can act on. Unknown codes fall back to `title`. */
export const errorMessages: Record<string, string> = {
  invalid_credentials: 'Incorrect email or password.',
  verification_failed:
    'That link or password didn’t work. Check the password, or request a new link.',
  invalid_token: 'This link is invalid or has expired. Request a new one.',
  rate_limited: 'Too many attempts. Please wait a few minutes and try again.',
  unauthenticated: 'Your session has ended. Please sign in again.',
  csrf_invalid: 'Your session needs a refresh. Reload the page and try again.',
  forbidden: 'You don’t have permission to do that.',
  no_active_tenant: 'You’re not an active member of any workspace.',
  not_found: 'That item no longer exists.',
  last_owner: 'A workspace needs at least one active owner.',
  cannot_change_self: 'You can’t change your own role or status.',
  already_member: 'That person is already a member of this workspace.',
  invitation_exists: 'There’s already a pending invitation for that email.',
  invalid_invitation: 'This invitation is invalid, expired or already used.',
  invitation_login_required: 'You already have an account. Sign in to accept this invitation.',
  invitation_email_mismatch:
    'You’re signed in with a different email than the one invited. Sign out and sign in as the invited person.',
  invitation_details_required: 'Enter your name and a password to create your account.',
  api_unavailable: 'RevOps is temporarily unavailable. Try again shortly.',
};
