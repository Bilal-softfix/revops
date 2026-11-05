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
