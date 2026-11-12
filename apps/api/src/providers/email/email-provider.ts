export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

/** Outbound email. Called only through this interface (CLAUDE.md rule 3). */
export abstract class EmailProvider {
  abstract send(message: EmailMessage): Promise<void>;
}

/** `a***@example.com` — for logs. Lives with the other PII maskers. */
export { maskEmail } from '../../platform/logging/mask';
