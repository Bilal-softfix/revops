import { Injectable } from '@nestjs/common';
import { type EmailMessage, EmailProvider } from './email-provider';

/** Test driver: keeps sent emails in memory. */
@Injectable()
export class FakeEmailProvider extends EmailProvider {
  readonly sent: EmailMessage[] = [];

  send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }

  /** Most recent email to `to`, if any. */
  lastTo(to: string): EmailMessage | undefined {
    return this.sent.filter((m) => m.to === to).at(-1);
  }

  /** The `token` query parameter of the first link in the most recent email to `to`. */
  lastTokenTo(to: string): string | undefined {
    const link = this.lastTo(to)?.text.match(/https?:\/\/\S+/)?.[0];
    return link ? (new URL(link).searchParams.get('token') ?? undefined) : undefined;
  }
}
