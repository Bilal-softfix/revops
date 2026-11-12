import type { EmailMessage } from '../../providers/email';

// All user-facing copy for identity emails lives here (future Hindi i18n: one place per feature).

export function verifyEmailMessage(to: string, appUrl: string, token: string): EmailMessage {
  const link = new URL('/verify-email', appUrl);
  link.searchParams.set('token', token);
  return {
    to,
    subject: 'Verify your email for RevOps',
    text: [
      'Welcome to RevOps!',
      '',
      'Confirm your email address to finish setting up your account (you’ll need the password',
      'you signed up with):',
      link.toString(),
      '',
      'The link expires in 24 hours. If you didn’t sign up, open the link and choose',
      '“This wasn’t me” — the account will be deleted.',
    ].join('\n'),
  };
}

/**
 * A new signup for this email was refused because its pending (unverified) sign-up has been
 * replaced too often today — possibly someone else squatting the address. The link opens the
 * verify page, whose "This wasn't me — start over" deletes that pending sign-up and frees the
 * address again (M1-T0).
 */
export function startOverMessage(to: string, appUrl: string, token: string): EmailMessage {
  const link = new URL('/verify-email', appUrl);
  link.searchParams.set('token', token);
  return {
    to,
    subject: 'Finish or start over your RevOps sign-up',
    text: [
      'Someone (hopefully you) tried to sign up to RevOps with this email address, but an',
      'unfinished sign-up for it already exists.',
      '',
      'Open this link:',
      link.toString(),
      '',
      '- If that sign-up is yours, enter its password to verify your email.',
      '- If it isn’t, or you don’t remember the password, choose “This wasn’t me — start over”.',
      '  It is deleted and you can sign up again straight away.',
      '',
      'The link expires in 24 hours.',
    ].join('\n'),
  };
}

/** Signup with an email that already has a verified account: nothing is created. */
export function accountExistsMessage(to: string, appUrl: string): EmailMessage {
  return {
    to,
    subject: 'You already have a RevOps account',
    text: [
      'Someone (hopefully you) tried to sign up to RevOps with this email address,',
      'but you already have an account. Nothing was changed.',
      '',
      `Sign in: ${new URL('/login', appUrl).toString()}`,
      `Forgot your password? ${new URL('/forgot-password', appUrl).toString()}`,
      '',
      'If this wasn’t you, you can ignore this email.',
    ].join('\n'),
  };
}

export function resetPasswordMessage(to: string, appUrl: string, token: string): EmailMessage {
  const link = new URL('/reset-password', appUrl);
  link.searchParams.set('token', token);
  return {
    to,
    subject: 'Reset your RevOps password',
    text: [
      'Someone (hopefully you) asked to reset your RevOps password.',
      '',
      'Choose a new password here:',
      link.toString(),
      '',
      'The link expires in 1 hour and works once. Resetting signs you out everywhere.',
      'If you didn’t ask for this, ignore this email — your password stays the same.',
    ].join('\n'),
  };
}
