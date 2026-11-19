import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, parseKek, randomToken } from './index.js';

const kek = parseKek(randomBytes(32).toString('base64'));

describe('envelope encryption', () => {
  it('round-trips and never contains the plaintext', () => {
    const stored = encryptSecret('whsec_top-secret', kek, 'lead_source:t1:s1');
    expect(stored.startsWith('v1:local-1:')).toBe(true);
    expect(stored).not.toContain('top-secret');
    expect(decryptSecret(stored, kek, 'lead_source:t1:s1')).toBe('whsec_top-secret');
  });

  it('uses a fresh data key and IV each time', () => {
    expect(encryptSecret('x', kek, 'c')).not.toBe(encryptSecret('x', kek, 'c'));
  });

  it('refuses another context (ciphertext copied to another row)', () => {
    const stored = encryptSecret('secret', kek, 'lead_source:t1:s1');
    expect(() => decryptSecret(stored, kek, 'lead_source:t1:s2')).toThrow();
  });

  it('refuses a wrong key, a tampered body and garbage', () => {
    const stored = encryptSecret('secret', kek, 'c');
    const other = parseKek(randomBytes(32).toString('base64'));
    expect(() => decryptSecret(stored, other, 'c')).toThrow();
    const parts = stored.split(':');
    const body = parts[3] ?? '';
    const flipped = `${body.slice(0, -2)}${body.endsWith('AA') ? 'AB' : 'AA'}`;
    expect(() => decryptSecret([...parts.slice(0, 3), flipped].join(':'), kek, 'c')).toThrow();
    expect(() => decryptSecret('nonsense', kek, 'c')).toThrow();
    expect(() => decryptSecret(stored.replace('local-1', 'kms-9'), kek, 'c')).toThrow(/kms-9/);
  });

  it('parseKek wants exactly 32 bytes and never echoes the value', () => {
    expect(() => parseKek('c2hvcnQ=')).toThrow('DATA_ENCRYPTION_KEY must be 32 bytes');
  });

  it('randomToken is base64url of the requested size', () => {
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken(16)).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
});
