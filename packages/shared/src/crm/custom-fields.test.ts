import { describe, expect, it } from 'vitest';
import {
  buildCustomFieldsSchema,
  createCustomFieldRequestSchema,
  updateCustomFieldRequestSchema,
  visibleCustomFields,
} from './custom-fields.js';

const defs = [
  { key: 'device_model', type: 'text', options: null, required: true },
  { key: 'estimate_inr', type: 'number', options: null, required: false },
  { key: 'promised_date', type: 'date', options: null, required: false },
  { key: 'under_warranty', type: 'bool', options: null, required: false },
  {
    key: 'issue',
    type: 'select',
    options: [
      { value: 'screen', label: 'Screen' },
      { value: 'battery', label: 'Battery' },
    ],
    required: false,
  },
  {
    key: 'tech_stack',
    type: 'multiselect',
    options: [
      { value: 'react', label: 'React' },
      { value: 'node', label: 'Node' },
    ],
    required: false,
  },
] as const;

const create = buildCustomFieldsSchema(defs, 'create');
const patch = buildCustomFieldsSchema(defs, 'patch');
const paths = (result: { error?: { issues: { path: PropertyKey[] }[] } }) =>
  (result.error?.issues ?? []).map((i) => i.path.join('.'));

describe('buildCustomFieldsSchema (M1-T2)', () => {
  it('accepts valid values of every type', () => {
    const value = {
      device_model: 'Redmi Note 12',
      estimate_inr: 2499.5,
      promised_date: '2026-11-20',
      under_warranty: false,
      issue: 'screen',
      tech_stack: ['react', 'node'],
    };
    expect(create.parse(value)).toEqual(value);
  });

  it.each([
    ['number as text', { estimate_inr: '2500' }, 'estimate_inr'],
    ['date in another format', { promised_date: '20/11/2026' }, 'promised_date'],
    ['bool as string', { under_warranty: 'yes' }, 'under_warranty'],
    ['select outside the options', { issue: 'keyboard' }, 'issue'],
    ['multiselect with an unknown value', { tech_stack: ['react', 'cobol'] }, 'tech_stack'],
    ['multiselect duplicates', { tech_stack: ['react', 'react'] }, 'tech_stack'],
    ['empty text', { device_model: '   ' }, 'device_model'],
    ['infinite number', { estimate_inr: Number.POSITIVE_INFINITY }, 'estimate_inr'],
  ])('AC: rejects %s with a field-level error', (_label, value, key) => {
    const result = patch.safeParse(value);
    expect(result.success).toBe(false);
    expect(paths(result)).toContain(key);
  });

  it('create requires required fields; patch only checks the keys given', () => {
    expect(paths(create.safeParse({ issue: 'screen' }))).toEqual(['device_model']);
    expect(patch.safeParse({ issue: 'screen' }).success).toBe(true);
  });

  it('null clears an optional value but never a required one', () => {
    expect(patch.parse({ estimate_inr: null })).toEqual({ estimate_inr: null });
    expect(paths(patch.safeParse({ device_model: null }))).toEqual(['device_model']);
  });

  it('unknown keys (incl. keys of deleted fields) are rejected', () => {
    const result = patch.safeParse({ old_field: 'x' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.code).toBe('unrecognized_keys');
  });

  it('visibleCustomFields hides values of deleted definitions without dropping them', () => {
    const stored = { device_model: 'X', old_field: 'kept' };
    expect(visibleCustomFields(stored, defs)).toEqual({ device_model: 'X' });
    expect(stored).toHaveProperty('old_field', 'kept');
  });
});

describe('definition requests', () => {
  const base = { entity: 'lead', key: 'k', label: 'K' } as const;

  it('select types need options; others must not have them; option values unique', () => {
    expect(createCustomFieldRequestSchema.safeParse({ ...base, type: 'select' }).success).toBe(
      false,
    );
    expect(
      createCustomFieldRequestSchema.safeParse({
        ...base,
        type: 'text',
        options: [{ value: 'a', label: 'A' }],
      }).success,
    ).toBe(false);
    expect(
      createCustomFieldRequestSchema.safeParse({
        ...base,
        type: 'multiselect',
        options: [
          { value: 'a', label: 'A' },
          { value: 'a', label: 'B' },
        ],
      }).success,
    ).toBe(false);
  });

  it('updates can’t change key or type (strict)', () => {
    expect(updateCustomFieldRequestSchema.safeParse({ type: 'number' }).success).toBe(false);
    expect(updateCustomFieldRequestSchema.safeParse({ key: 'x' }).success).toBe(false);
    expect(updateCustomFieldRequestSchema.safeParse({ label: 'New' }).success).toBe(true);
  });
});
