import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { WEBHOOK_TOLERANCE_SECONDS } from '@revops/shared';

/**
 * Generic webhook signatures (M2-T3), Stripe-style: header `t=<unix seconds>,v1=<hex>`, where
 * v1 = HMAC-SHA256(secret, "<t>.<raw body bytes>"). Several v1 values are allowed (secret
 * rotation on the sender's side); any match is enough.
 */
export function signWebhook(secret: string, timestamp: number, rawBody: Buffer | string): string {
  const mac = createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex');
  return `t=${timestamp},v1=${mac}`;
}

export type SignatureCheck = 'ok' | 'missing' | 'malformed' | 'stale' | 'mismatch';

export function verifyWebhookSignature(
  header: string | undefined,
  secret: string,
  rawBody: Buffer,
  nowSeconds: number,
): SignatureCheck {
  if (!header) return 'missing';
  if (header.length > 1024) return 'malformed';
  let timestamp: number | undefined;
  const candidates: string[] = [];
  for (const part of header.split(',')) {
    const [key, value] = part.trim().split('=', 2);
    if (key === 't' && value && /^\d{1,12}$/.test(value)) timestamp = Number(value);
    else if (key === 'v1' && value && /^[0-9a-f]{64}$/i.test(value)) candidates.push(value);
  }
  if (timestamp === undefined || candidates.length === 0) return 'malformed';
  if (Math.abs(nowSeconds - timestamp) > WEBHOOK_TOLERANCE_SECONDS) return 'stale';
  const expected = Buffer.from(
    createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex'),
    'utf8',
  );
  const match = candidates.some((candidate) =>
    timingSafeEqual(expected, Buffer.from(candidate.toLowerCase(), 'utf8')),
  );
  return match ? 'ok' : 'mismatch';
}

export type TokenCheck = 'ok' | 'missing' | 'mismatch';

/**
 * Simple-token mode (opt-in per source, M2-T3 review): the header must equal the secret. Both
 * sides are hashed first, so the comparison is constant-time and doesn't leak the secret's length.
 */
export function verifyWebhookToken(header: string | undefined, secret: string): TokenCheck {
  if (!header) return 'missing';
  const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest();
  return timingSafeEqual(digest(header.trim()), digest(secret)) ? 'ok' : 'mismatch';
}
