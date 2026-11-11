// PII masking for logs (CLAUDE.md rule 7). Applied to every log message and to string values in
// logged objects by the pino config (logger.ts), so a stray `log(\`… ${email}\`)` is still masked.

const EMAIL =
  /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g;
/** E.164: `+` and 8–15 digits. Keeps `+`, the first two digits and the last four. */
const PHONE = /\+\d{8,15}\b/g;

/** `asha@example.com` → `a***@example.com`. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return '***';
  return `${email[0]}***${email.slice(at)}`;
}

/** `+919876543210` → `+91******3210`. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 8) return '***';
  return `+${digits.slice(0, 2)}${'*'.repeat(digits.length - 6)}${digits.slice(-4)}`;
}

/** Masks every email address and E.164 phone number inside free text. */
export function maskPii(text: string): string {
  return text
    .replace(EMAIL, (_match, first: string, domain: string) => `${first}***@${domain}`)
    .replace(PHONE, maskPhone);
}

const MAX_DEPTH = 6;

/** Deep copy of `value` with maskPii applied to every string (cycles and depth are bounded). */
export function maskDeep(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return maskPii(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH || seen.has(value)) return '[truncated]';
  if (value instanceof Error) return value; // pino's err serializer handles errors
  if (value instanceof Date) return value;
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => maskDeep(item, depth + 1, seen));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) out[key] = maskDeep(item, depth + 1, seen);
  return out;
}
