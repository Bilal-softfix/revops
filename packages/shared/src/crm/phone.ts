import { type CountryCode, parsePhoneNumberFromString } from 'libphonenumber-js';
import { z } from 'zod';

/** India-first: national numbers without a country code are read as Indian. */
export const DEFAULT_PHONE_REGION: CountryCode = 'IN';

/**
 * A phone number as E.164 (`+919876543210`), or null if it isn't a valid number. Accepts the
 * ways Indian numbers are written: `09876543210`, `+91 98765 43210`, `98765-43210`,
 * `0091 98765 43210`, `919876543210`, landlines `022-2345 6789`, and foreign numbers with `+`.
 */
export function normalizePhone(
  input: string,
  region: CountryCode = DEFAULT_PHONE_REGION,
): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > 32) return null;
  const parsed = parsePhoneNumberFromString(trimmed, region);
  return parsed?.isValid() ? parsed.number : null;
}

export const PHONE_INVALID_MESSAGE =
  'Enter a valid phone number, e.g. 98765 43210 or +91 98765 43210';

/** Request field: any common format in, E.164 out (the API stores and dedupes on E.164). */
export const phoneSchema = z
  .string()
  .max(32)
  .transform((value, ctx) => {
    const e164 = normalizePhone(value);
    if (!e164) {
      ctx.addIssue({ code: 'custom', message: PHONE_INVALID_MESSAGE });
      return z.NEVER;
    }
    return e164;
  });

/** E.164 for display: Indian numbers nationally-grouped with +91 (`+91 98765 43210`). */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return '';
  return parsePhoneNumberFromString(e164)?.formatInternational() ?? e164;
}

/** Masks an E.164 number for logs: `+91******3210` (CLAUDE.md rule 7). */
export function maskE164(e164: string): string {
  const digits = e164.replace(/\D/g, '');
  return digits.length < 8
    ? '***'
    : `+${digits.slice(0, 2)}${'*'.repeat(digits.length - 6)}${digits.slice(-4)}`;
}
