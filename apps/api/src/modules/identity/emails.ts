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
      'Confirm your email address to finish setting up your account:',
      link.toString(),
      '',
      'The link expires in 24 hours. If you didn’t sign up, ignore this email.',
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
