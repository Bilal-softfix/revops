import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { type EmailMessage, EmailProvider, maskEmail } from './email-provider';

/**
 * Dev/e2e driver: writes each email as `<timestamp>-<uuid>.json` into a directory, so another
 * process (the Playwright test) can read the links the worker sent. Never allowed in production.
 */
@Injectable()
export class FileEmailProvider extends EmailProvider {
  private readonly logger = new Logger('Email');
  readonly dir: string;

  constructor(dir: string) {
    super();
    this.dir = resolve(dir);
  }

  async send(message: EmailMessage): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const name = `${Date.now()}-${randomUUID()}.json`;
    await writeFile(join(this.dir, name), JSON.stringify(message), 'utf8');
    this.logger.log(`to=${maskEmail(message.to)} subject="${message.subject}" → ${name}`);
  }
}

/** Every email in `dir`, oldest first (for tests). */
export async function readMailbox(dir: string): Promise<EmailMessage[]> {
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith('.json')).sort();
  } catch {
    return [];
  }
  return Promise.all(
    names.map(async (n) => JSON.parse(await readFile(join(dir, n), 'utf8')) as EmailMessage),
  );
}
