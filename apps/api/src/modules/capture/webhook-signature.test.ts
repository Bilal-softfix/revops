import { describe, expect, it } from 'vitest';
import { signWebhook, verifyWebhookSignature, verifyWebhookToken } from './webhook-signature';

const secret = 'whsec_test';
const body = Buffer.from('{"id":"evt_1","phone":"9812345678"}');
const now = 1_800_000_000;

describe('webhook signatures', () => {
  it('accepts its own signature (and uppercase hex)', () => {
    const header = signWebhook(secret, now, body);
    expect(verifyWebhookSignature(header, secret, body, now)).toBe('ok');
    expect(
      verifyWebhookSignature(
        header.toUpperCase().replace('T=', 't=').replace('V1=', 'v1='),
        secret,
        body,
        now,
      ),
    ).toBe('ok');
  });

  it('accepts any of several v1 values (sender rotating secrets)', () => {
    const good = signWebhook(secret, now, body).split(',')[1];
    expect(verifyWebhookSignature(`t=${now},v1=${'0'.repeat(64)},${good}`, secret, body, now)).toBe(
      'ok',
    );
  });

  it('allows ±300 s of clock skew, not more', () => {
    expect(verifyWebhookSignature(signWebhook(secret, now - 300, body), secret, body, now)).toBe(
      'ok',
    );
    expect(verifyWebhookSignature(signWebhook(secret, now + 300, body), secret, body, now)).toBe(
      'ok',
    );
    expect(verifyWebhookSignature(signWebhook(secret, now - 301, body), secret, body, now)).toBe(
      'stale',
    );
    expect(verifyWebhookSignature(signWebhook(secret, now + 301, body), secret, body, now)).toBe(
      'stale',
    );
  });

  it('rejects another secret, a changed body or a changed timestamp', () => {
    const header = signWebhook(secret, now, body);
    expect(verifyWebhookSignature(header, 'whsec_other', body, now)).toBe('mismatch');
    expect(verifyWebhookSignature(header, secret, Buffer.from(`${body.toString()} `), now)).toBe(
      'mismatch',
    );
    expect(
      verifyWebhookSignature(header.replace(`t=${now}`, `t=${now - 1}`), secret, body, now),
    ).toBe('mismatch');
  });

  it.each([
    [undefined, 'missing'],
    ['', 'missing'],
    ['garbage', 'malformed'],
    [`t=${now}`, 'malformed'],
    [`v1=${'a'.repeat(64)}`, 'malformed'],
    [`t=abc,v1=${'a'.repeat(64)}`, 'malformed'],
    [`t=${now},v1=short`, 'malformed'],
    [`t=${now},v1=${'a'.repeat(2000)}`, 'malformed'],
  ])('%s → %s', (header, result) => {
    expect(verifyWebhookSignature(header, secret, body, now)).toBe(result);
  });
});

describe('webhook tokens (simple-token mode)', () => {
  it.each([
    [secret, 'ok'],
    [` ${secret} `, 'ok'], // surrounding whitespace from copy-paste
    [undefined, 'missing'],
    ['', 'missing'],
    ['whsec_tes', 'mismatch'], // prefix
    [`${secret}x`, 'mismatch'], // longer
    ['WHSEC_TEST', 'mismatch'], // case-sensitive
  ] as const)('%j → %s', (header, result) => {
    expect(verifyWebhookToken(header, secret)).toBe(result);
  });
});
