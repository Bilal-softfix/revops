import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Envelope encryption for secrets at rest (CLAUDE.md rule 6): each value gets its own random
// data key (DEK); the DEK is wrapped with the key-encryption key (KEK). Both layers are
// AES-256-GCM. `context` (e.g. "lead_source:<tenantId>:<sourceId>") is bound as associated data,
// so a ciphertext copied to another row doesn't decrypt. M2: the KEK comes from
// DATA_ENCRYPTION_KEY; M8 swaps it for KMS behind the same format (`kekId`).
// Node-only: import from '@revops/shared/crypto', never from browser code.

const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface Kek {
  id: string;
  key: Buffer;
}

/** Parses a base64 32-byte key (DATA_ENCRYPTION_KEY). Throws a message without the value. */
export function parseKek(base64: string, id = 'local-1'): Kek {
  const key = Buffer.from(base64.trim(), 'base64');
  if (key.length !== 32) throw new Error('DATA_ENCRYPTION_KEY must be 32 bytes, base64-encoded');
  return { id, key };
}

const b64 = (buf: Buffer) => buf.toString('base64url');

function seal(key: Buffer, plaintext: Buffer, aad: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const body = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  return `${b64(iv)}.${b64(body)}`;
}

function open(key: Buffer, sealed: string, aad: string): Buffer {
  const [ivPart, bodyPart] = sealed.split('.');
  if (!ivPart || !bodyPart) throw new Error('malformed ciphertext');
  const iv = Buffer.from(ivPart, 'base64url');
  const body = Buffer.from(bodyPart, 'base64url');
  if (iv.length !== IV_BYTES || body.length < TAG_BYTES) throw new Error('malformed ciphertext');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(body.subarray(body.length - TAG_BYTES));
  return Buffer.concat([decipher.update(body.subarray(0, body.length - TAG_BYTES)), decipher.final()]);
}

/** `v1:<kekId>:<wrapped DEK>:<ciphertext>` — safe to store in a text column. */
export function encryptSecret(plaintext: string, kek: Kek, context: string): string {
  const dek = randomBytes(32);
  try {
    const wrapped = seal(kek.key, dek, `dek:${context}`);
    const body = seal(dek, Buffer.from(plaintext, 'utf8'), context);
    return [VERSION, kek.id, wrapped, body].join(':');
  } finally {
    dek.fill(0);
  }
}

/** Throws (without revealing anything) if the value was tampered with or the context differs. */
export function decryptSecret(stored: string, kek: Kek, context: string): string {
  const [version, kekId, wrapped, body] = stored.split(':');
  if (version !== VERSION || !wrapped || !body) throw new Error('unsupported ciphertext');
  if (kekId !== kek.id) throw new Error(`ciphertext uses key "${kekId ?? ''}"`);
  const dek = open(kek.key, wrapped, `dek:${context}`);
  try {
    return open(dek, body, context).toString('utf8');
  } finally {
    dek.fill(0);
  }
}

/** URL-safe random token (public keys, webhook secrets): `bytes` random bytes, base64url. */
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');
