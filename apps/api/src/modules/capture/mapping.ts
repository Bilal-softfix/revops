import {
  type IntakeLeadInput,
  type LeadSourceConfig,
  MAPPING_BUILTINS,
  inboundAttributionSchema,
} from '@revops/shared';

type FieldValue = string | number | boolean | null;

/** Field names the snippet maps without configuration (common form `name` attributes). */
const DEFAULT_MAPPING: Record<string, (typeof MAPPING_BUILTINS)[number]> = {
  name: 'name',
  full_name: 'name',
  fullname: 'name',
  phone: 'phone',
  mobile: 'phone',
  tel: 'phone',
  email: 'email',
  city: 'city',
};

/**
 * Inbound fields → intake input via the source's fieldMapping (falling back to the common names
 * above). Unmapped fields are ignored; builtin values are trimmed and length-capped; lead.<key>
 * values go to leadFields (validated one by one by the intake). Shared by form and webhook.
 */
export function toIntakeInput(
  fields: Record<string, FieldValue>,
  attribution: Record<string, unknown> | undefined,
  config: LeadSourceConfig,
): IntakeLeadInput {
  const input: IntakeLeadInput = {};
  const leadFields: Record<string, FieldValue> = {};
  for (const [field, value] of Object.entries(fields)) {
    const target = config.fieldMapping[field] ?? DEFAULT_MAPPING[field.toLowerCase()];
    if (!target || value === null) continue;
    if (target.startsWith('lead.')) {
      leadFields[target.slice(5)] = value;
      continue;
    }
    const text = String(value).trim();
    if (text === '') continue;
    const builtin = target as (typeof MAPPING_BUILTINS)[number];
    const cap = { name: 200, phone: 40, email: 254, city: 100 }[builtin];
    input[builtin] = text.slice(0, cap);
  }
  if (Object.keys(leadFields).length > 0) input.leadFields = leadFields;
  const clean = sanitizeAttribution(attribution);
  if (Object.keys(clean).length > 0) input.attribution = clean;
  return input;
}

/** Keeps only known attribution keys whose value is valid; anything else is silently dropped. */
export function sanitizeAttribution(raw: Record<string, unknown> | undefined) {
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const [key, schema] of Object.entries(inboundAttributionSchema.shape)) {
    const value = raw[key];
    if (typeof value !== 'string' || value.trim() === '') continue;
    const parsed = schema.safeParse(value);
    if (parsed.success && typeof parsed.data === 'string') out[key] = parsed.data;
  }
  return out;
}
