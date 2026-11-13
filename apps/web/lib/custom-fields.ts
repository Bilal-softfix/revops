import type { CustomFieldDef, CustomFieldValue } from '@revops/shared';

/** What a form input holds for each field type. */
export type CustomFieldInputValue = string | boolean | string[];
export type CustomFieldFormValues = Record<string, CustomFieldInputValue>;

/** Stored/API value → form input value (empty string / [] / false for "not set"). */
export function toInputValue(def: CustomFieldDef, value: unknown): CustomFieldInputValue {
  switch (def.type) {
    case 'bool':
      return value === true;
    case 'multiselect':
      return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
    case 'number':
      return typeof value === 'number' ? String(value) : '';
    default:
      return typeof value === 'string' ? value : '';
  }
}

/** Form input value → API value (null = not set / clear). Numbers that don't parse stay strings
 *  so the shared schema reports them as "must be a number". */
export function toApiValue(
  def: CustomFieldDef,
  input: CustomFieldInputValue | undefined,
): CustomFieldValue {
  switch (def.type) {
    case 'bool':
      return input === true;
    case 'multiselect':
      return Array.isArray(input) && input.length > 0 ? input : null;
    case 'number': {
      const text = typeof input === 'string' ? input.trim() : '';
      if (text === '') return null;
      const n = Number(text);
      return Number.isFinite(n) ? n : text;
    }
    default: {
      const text = typeof input === 'string' ? input.trim() : '';
      return text === '' ? null : text;
    }
  }
}

export function initialInputs(
  defs: readonly CustomFieldDef[],
  stored: Record<string, unknown> | undefined,
): CustomFieldFormValues {
  return Object.fromEntries(defs.map((def) => [def.key, toInputValue(def, stored?.[def.key])]));
}

/**
 * The `customFields` to send. Create: every field with a value. Update: only fields whose value
 * changed from what is stored — a cleared field becomes null; untouched fields are left out (so
 * a stored value of an option that was later renamed/removed isn't re-validated).
 */
export function customFieldsPayload(
  defs: readonly CustomFieldDef[],
  inputs: CustomFieldFormValues,
  stored: Record<string, unknown> | undefined,
): Record<string, CustomFieldValue> {
  const out: Record<string, CustomFieldValue> = {};
  for (const def of defs) {
    const value = toApiValue(def, inputs[def.key]);
    if (stored === undefined) {
      if (value !== null && !(def.type === 'bool' && value === false && !def.required)) {
        out[def.key] = value;
      }
      continue;
    }
    const before = stored[def.key] ?? null;
    const unchangedBool = def.type === 'bool' && value === false && before === null;
    if (!unchangedBool && JSON.stringify(value) !== JSON.stringify(before)) out[def.key] = value;
  }
  return out;
}
