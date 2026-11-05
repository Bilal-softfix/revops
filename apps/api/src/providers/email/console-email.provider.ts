import { Injectable, Logger } from '@nestjs/common';
import { type EmailMessage, EmailProvider, maskEmail } from './email-provider';

/** Dev driver: prints the email (with its links) to the terminal instead of sending it. */
@Injectable()
export class ConsoleEmailProvider extends EmailProvider {
  private readonly logger = new Logger('Email');

  send(message: EmailMessage): Promise<void> {
    this.logger.log(`to=${maskEmail(message.to)} subject="${message.subject}"\n${message.text}\n`);
    return Promise.resolve();
  }
}
