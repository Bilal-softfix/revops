import { z } from 'zod';

// CRM enums: single source of truth for the DB (pgEnum), the API and the web.

export const STAGE_CATEGORIES = ['open', 'won', 'lost'] as const;
export const stageCategorySchema = z.enum(STAGE_CATEGORIES);
export type StageCategory = z.infer<typeof stageCategorySchema>;

export const CUSTOM_FIELD_ENTITIES = ['contact', 'lead'] as const;
export const customFieldEntitySchema = z.enum(CUSTOM_FIELD_ENTITIES);
export type CustomFieldEntity = z.infer<typeof customFieldEntitySchema>;

export const CUSTOM_FIELD_TYPES = [
  'text',
  'number',
  'date',
  'select',
  'multiselect',
  'bool',
] as const;
export const customFieldTypeSchema = z.enum(CUSTOM_FIELD_TYPES);
export type CustomFieldType = z.infer<typeof customFieldTypeSchema>;

/** docs/02-data-model.md lead_sources.type, plus `walk_in` (counter / shop visits). */
export const LEAD_SOURCE_TYPES = [
  'web_form',
  'api',
  'csv',
  'phone',
  'whatsapp',
  'meta',
  'manual',
  'walk_in',
] as const;
export const leadSourceTypeSchema = z.enum(LEAD_SOURCE_TYPES);
export type LeadSourceType = z.infer<typeof leadSourceTypeSchema>;

/** Machine keys (template keys, custom field keys): snake_case, stable, never shown to users. */
export const KEY_PATTERN = /^[a-z][a-z0-9_]{0,49}$/;
export const keySchema = z.string().regex(KEY_PATTERN, 'use lower_snake_case (a–z, 0–9, _)');
