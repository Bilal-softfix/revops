import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ConsoleEmailProvider } from './console-email.provider';
import { type EmailProvider, maskEmail } from './email-provider';
import { FakeEmailProvider } from './fake-email.provider';

const message = {
  to: 'asha@example.com',
  subject: 'Verify',
  text: `Open http://localhost:3000/verify-email?token=${'T'.repeat(43)}`,
};

// Contract: every EmailProvider accepts a message and resolves.
describe.each<[string, () => EmailProvider]>([
  ['ConsoleEmailProvider', () => new ConsoleEmailProvider()],
  ['FakeEmailProvider', () => new FakeEmailProvider()],
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

describe('maskEmail', () => {
  it.each([
    ['asha@example.com', 'a***@example.com'],
    ['x@y.in', 'x***@y.in'],
    ['not-an-email', '***'],
  ])('%s → %s', (input, masked) => expect(maskEmail(input)).toBe(masked));
});
