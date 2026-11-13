import { z } from 'zod';
import { fieldOptionSchema } from '../templates/schema.js';
import { customFieldEntitySchema, customFieldTypeSchema, keySchema } from './enums.js';
import type { CustomFieldType } from './enums.js';

// Custom fields (M1-T2): per-tenant definitions for contacts and leads, and the validation of
// their values. The SAME schema builder runs in the API (authoritative) and in web forms.

const label = z.string().trim().min(1).max(100);
export type FieldOption = z.infer<typeof fieldOptionSchema>;
const optionsSchema = z
  .array(fieldOptionSchema)
  .min(1)
  .max(100)
  .refine((options) => new Set(options.map((o) => o.value)).size === options.length, {
    message: 'option values must be unique',
  });

const isChoice = (type: CustomFieldType) => type === 'select' || type === 'multiselect';

export const customFieldDefSchema = z.object({
  id: z.uuid(),
  entity: customFieldEntitySchema,
  key: z.string(),
  label: z.string(),
  type: customFieldTypeSchema,
  options: z.array(fieldOptionSchema).nullable(),
  required: z.boolean(),
  position: z.number().int(),
});
export type CustomFieldDef = z.infer<typeof customFieldDefSchema>;
export const customFieldDefListSchema = z.object({ items: z.array(customFieldDefSchema) });
export type CustomFieldDefList = z.infer<typeof customFieldDefListSchema>;

export const customFieldQuerySchema = z.object({ entity: customFieldEntitySchema.optional() });
export type CustomFieldQuery = z.infer<typeof customFieldQuerySchema>;

export const createCustomFieldRequestSchema = z
  .object({
    entity: customFieldEntitySchema,
    key: keySchema,
    label,
    type: customFieldTypeSchema,
    options: optionsSchema.optional(),
    required: z.boolean().default(false),
  })
  .superRefine((def, ctx) => {
    if (isChoice(def.type) && !def.options) {
      ctx.addIssue({ code: 'custom', message: 'add at least one option', path: ['options'] });
    }
    if (!isChoice(def.type) && def.options) {
      ctx.addIssue({
        code: 'custom',
        message: 'only select fields have options',
        path: ['options'],
      });
    }
  });
export type CreateCustomFieldRequest = z.infer<typeof createCustomFieldRequestSchema>;

/**
 * Key and type are immutable (stored values live under the key and were validated as that
 * type): the schema is strict, so sending them is a 400. Options can be relabelled or added.
 */
export const updateCustomFieldRequestSchema = z
  .strictObject({
    label,
    options: optionsSchema,
    required: z.boolean(),
    position: z.number().int().min(0).max(10_000),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'nothing to update' });
export type UpdateCustomFieldRequest = z.infer<typeof updateCustomFieldRequestSchema>;

/** Request shape of `customFields` before the tenant's definitions are known (API edge). */
export const customFieldValuesInputSchema = z.record(keySchema, z.unknown());
export type CustomFieldValuesInput = z.infer<typeof customFieldValuesInputSchema>;

/** What value validation needs from a definition (read-only friendly: templates, API rows). */
export interface CustomFieldShape {
  key: string;
  type: CustomFieldType;
  options: readonly FieldOption[] | null;
  required: boolean;
}

export type CustomFieldValue = string | number | boolean | string[] | null;
export type CustomFieldValues = Record<string, CustomFieldValue>;

function valueSchema(def: Pick<CustomFieldShape, 'type' | 'options'>): z.ZodType<CustomFieldValue> {
  const values = (def.options ?? []).map((o) => o.value);
  switch (def.type) {
    case 'text':
      return z.string().trim().min(1, 'can’t be empty').max(1000);
    case 'number':
      return z.number({ error: 'must be a number' }).finite().min(-1e12).max(1e12);
    case 'date':
      return z.iso.date({ error: 'must be a date (YYYY-MM-DD)' });
    case 'bool':
      return z.boolean({ error: 'must be true or false' });
    case 'select':
      return z.string().refine((v) => values.includes(v), { message: 'not one of the options' });
    case 'multiselect':
      return z
        .array(z.string())
        .max(100)
        .refine((list) => list.every((v) => values.includes(v)), {
          message: 'contains a value that is not one of the options',
        })
        .refine((list) => new Set(list).size === list.length, { message: 'duplicate values' });
  }
}

/**
 * Validates custom field values against the active definitions of one entity:
 * - unknown keys (including keys of deleted fields) are rejected;
 * - each value must match its field's type/options; `null` clears it;
 * - `mode: 'create'` requires every required field; `mode: 'patch'` only checks the keys given
 *   (a required field still can't be cleared with null).
 * Errors carry the field key as their path (the API prefixes `customFields.`).
 */
export function buildCustomFieldsSchema(
  defs: readonly CustomFieldShape[],
  mode: 'create' | 'patch',
): z.ZodType<CustomFieldValues> {
  const shape: Record<string, z.ZodType<CustomFieldValue | undefined>> = {};
  for (const def of defs) {
    const value = valueSchema(def);
    if (def.required) {
      shape[def.key] = mode === 'create' ? value : value.optional();
    } else {
      shape[def.key] = value.nullable().optional();
    }
  }
  return z.strictObject(shape).transform((values) => {
    const out: CustomFieldValues = {};
    for (const [key, value] of Object.entries(values)) if (value !== undefined) out[key] = value;
    return out;
  });
}

/** Only the values of active definitions: values of deleted fields stay stored but hidden. */
export function visibleCustomFields(
  stored: Record<string, unknown>,
  defs: readonly Pick<CustomFieldDef, 'key'>[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const def of defs) if (def.key in stored) out[def.key] = stored[def.key];
  return out;
}
