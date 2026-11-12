// Copy for the signed-out pages (login, signup, verify, reset, accept invite).

export const authStrings = {
  email: 'Work email',
  password: 'Password',
  newPassword: 'New password',
  passwordHint: 'At least 12 characters.',
  name: 'Your name',
  tenantName: 'Business name',
  login: {
    title: 'Sign in to RevOps',
    submit: 'Sign in',
    forgot: 'Forgot password?',
    noAccount: 'New to RevOps?',
    signupLink: 'Create an account',
    unverifiedHint:
      'If you haven’t verified your email yet, we’ve sent a fresh verification link to your inbox.',
  },
  signup: {
    title: 'Create your RevOps account',
    submit: 'Create account',
    haveAccount: 'Already have an account?',
    loginLink: 'Sign in',
    sentTitle: 'Check your email',
    sentBody: (email: string) =>
      `We’ve sent a link to ${email}. Open it within 24 hours to verify your email and finish setting up. If the address already has an account, we’ve emailed instructions instead.`,
    resend: 'Resend the email',
    resent: 'If the email needs verifying, a new link is on its way.',
  },
  verify: {
    title: 'Verify your email',
    body: 'Enter the password you chose when you signed up to confirm this email is yours.',
    submit: 'Verify email',
    doneTitle: 'Email verified',
    doneBody: 'Your account is ready. Sign in to continue.',
    notMe: 'This wasn’t me — start over',
    notMeConfirmTitle: 'Delete this sign-up?',
    notMeConfirmBody:
      'If you didn’t sign up, or want to start over, we’ll delete this unverified account and its workspace. Nothing else is affected.',
    notMeConfirm: 'Delete sign-up',
    deletedTitle: 'Sign-up deleted',
    deletedBody: 'The unverified account was removed. You can sign up again any time.',
    missingToken: 'This verification link is incomplete. Open the link from your email again.',
    newLink: 'Request a new link',
  },
  forgot: {
    title: 'Reset your password',
    body: 'Enter your email and we’ll send you a link to choose a new password.',
    submit: 'Send reset link',
    sentTitle: 'Check your email',
    sentBody:
      'If an account exists for that email, a reset link is on its way. It expires in 1 hour.',
  },
  reset: {
    title: 'Choose a new password',
    body: 'This signs you out on all devices.',
    submit: 'Set new password',
    doneTitle: 'Password changed',
    doneBody: 'Sign in with your new password.',
    missingToken: 'This reset link is incomplete. Open the link from your email again.',
  },
  accept: {
    title: 'Join your team on RevOps',
    newUserBody: 'Create your account to accept the invitation.',
    signedInBody: (email: string) => `You’re signed in as ${email}.`,
    submitNew: 'Create account and join',
    submitExisting: 'Accept invitation',
    haveAccount: 'Already have a RevOps account?',
    loginToAccept: 'Sign in to accept',
    switchAccount: 'Not you? Sign out',
    missingToken: 'This invitation link is incomplete. Open the link from your email again.',
  },
  toLogin: 'Go to sign in',
} as const;
