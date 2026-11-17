// Money (CLAUDE.md rule 8): the API carries paise as integers; the UI shows and takes rupees.

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});

/** 249950 → "₹2,499.5" (Indian digit grouping). */
export function formatPaise(paise: number | null | undefined): string {
  return paise === null || paise === undefined ? '—' : inr.format(paise / 100);
}

/**
 * "2,499.50" / "2499.5" / "₹2499" → 249950. Empty → null. Anything else (letters, more than two
 * decimals, negative) → undefined, so the form can show an error. String maths, no float rounding.
 */
export function rupeesToPaise(input: string): number | null | undefined {
  const text = input.replace(/[₹,\s]/g, '');
  if (text === '') return null;
  const match = /^(\d{1,13})(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return undefined;
  const [, whole = '0', fraction = ''] = match;
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

/** 249950 → "2499.50" for an input's initial value. */
export function paiseToRupeesInput(paise: number | null): string {
  if (paise === null) return '';
  const whole = Math.floor(paise / 100);
  const fraction = paise % 100;
  return fraction === 0 ? String(whole) : `${whole}.${String(fraction).padStart(2, '0')}`;
}
