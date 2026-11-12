import type { Role } from '@revops/shared';
import type { EmailMessage } from '../../providers/email';

// All user-facing copy for tenancy emails (one place per feature, for future Hindi i18n).

const ROLE_LABEL: Record<Role, string> = {
  owner: 'an owner',
  admin: 'an admin',
  manager: 'a manager',
  agent: 'an agent',
};

export function invitationMessage(input: {
  to: string;
  appUrl: string;
  token: string;
  tenantName: string;
  inviterName: string;
  role: Role;
}): EmailMessage {
  const link = new URL('/accept-invite', input.appUrl);
  link.searchParams.set('token', input.token);
  return {
    to: input.to,
    subject: `${input.inviterName} invited you to ${input.tenantName} on RevOps`,
    text: [
      `${input.inviterName} invited you to join ${input.tenantName} on RevOps as ${ROLE_LABEL[input.role]}.`,
      '',
      'Accept the invitation:',
      link.toString(),
      '',
      'The link expires in 7 days and works once. If you weren’t expecting this, ignore this email.',
    ].join('\n'),
  };
}
