import { describe, expect, it } from 'vitest';
import { resetPasswordMessage, verifyEmailMessage } from './emails';

const token = 'Tok_en-'.padEnd(43, 'x');

describe('identity emails', () => {
  it('verification email links to APP_URL/verify-email with the token', () => {
    const message = verifyEmailMessage('a@b.co', 'https://app.example.in', token);
    expect(message.to).toBe('a@b.co');
    expect(message.text).toContain(`https://app.example.in/verify-email?token=${token}`);
    expect(message.text).toMatch(/24 hours/);
  });

  it('reset email links to APP_URL/reset-password and says it signs you out', () => {
    const message = resetPasswordMessage('a@b.co', 'http://localhost:3000', token);
    expect(message.text).toContain(`http://localhost:3000/reset-password?token=${token}`);
    expect(message.text).toMatch(/1 hour/);
    expect(message.text).toMatch(/signs you out everywhere/);
  });
});
