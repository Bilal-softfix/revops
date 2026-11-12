import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { ConsoleEmailProvider } from './console-email.provider';
import { type EmailProvider, maskEmail } from './email-provider';
import { FakeEmailProvider } from './fake-email.provider';
import { FileEmailProvider, readMailbox } from './file-email.provider';

const mailDir = mkdtempSync(join(tmpdir(), 'revops-mail-'));
afterAll(() => rmSync(mailDir, { recursive: true, force: true }));

const message = {
  to: 'asha@example.com',
  subject: 'Verify',
  text: `Open http://localhost:3000/verify-email?token=${'T'.repeat(43)}`,
};

// Contract: every EmailProvider accepts a message and resolves.
describe.each<[string, () => EmailProvider]>([
  ['ConsoleEmailProvider', () => new ConsoleEmailProvider()],
  ['FakeEmailProvider', () => new FakeEmailProvider()],
  ['FileEmailProvider', () => new FileEmailProvider(join(mailDir, 'contract'))],
])('%s contract', (_name, make) => {
  it('send resolves', async () => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    await expect(make().send(message)).resolves.toBeUndefined();
  });
});

describe('ConsoleEmailProvider', () => {
  it('prints the link but masks the recipient address', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    await new ConsoleEmailProvider().send(message);
    const printed = String(log.mock.calls.at(-1)?.[0]);
    expect(printed).toContain('a***@example.com');
    expect(printed).not.toContain('asha@example.com');
    expect(printed).toContain(`/verify-email?token=${'T'.repeat(43)}`);
  });
});

describe('FakeEmailProvider', () => {
  it('records mail and extracts the link token', async () => {
    const fake = new FakeEmailProvider();
    await fake.send({
      to: 'b@x.io',
      subject: 'Reset your password',
      text: `Go to https://app.example/reset-password?token=${'R'.repeat(43)} now`,
    });
    expect(fake.lastTo('b@x.io')?.subject).toMatch(/reset/i);
    expect(fake.lastTokenTo('b@x.io')).toBe('R'.repeat(43));
    expect(fake.lastTokenTo('nobody@x.io')).toBeUndefined();
  });
});

describe('FileEmailProvider', () => {
  it('writes one JSON file per email, readable in send order by another process', async () => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const dir = join(mailDir, 'order');
    const provider = new FileEmailProvider(dir);
    await provider.send(message);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await provider.send({ ...message, subject: 'Second' });
    expect((await readMailbox(dir)).map((m) => m.subject)).toEqual(['Verify', 'Second']);
    expect(await readMailbox(join(mailDir, 'missing'))).toEqual([]);
  });
});

describe('maskEmail', () => {
  it.each([
    ['asha@example.com', 'a***@example.com'],
    ['x@y.in', 'x***@y.in'],
    ['not-an-email', '***'],
  ])('%s → %s', (input, masked) => expect(maskEmail(input)).toBe(masked));
});
