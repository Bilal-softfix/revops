export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

/** Outbound email. Called only through this interface (CLAUDE.md rule 3). */
export abstract class EmailProvider {
  abstract send(message: EmailMessage): Promise<void>;
}

/** `a***@example.com` — for logs. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return '***';
  return `${email[0]}***${email.slice(at)}`;
}
