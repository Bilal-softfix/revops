/** `Device brand` → `device_brand`: a machine key from a label (lower_snake_case, ≤ 50). */
export function toKey(label: string, { allowLeadingDigit = false } = {}): string {
  const base = label
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50);
  if (!base) return '';
  return allowLeadingDigit || /^[a-z]/.test(base) ? base : `f_${base}`.slice(0, 50);
}
