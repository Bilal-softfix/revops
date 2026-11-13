import type { CustomFieldDef } from '@revops/shared';
import { describe, expect, it } from 'vitest';
import { customFieldsPayload, initialInputs, toApiValue } from './custom-fields';

const def = (key: string, type: CustomFieldDef['type'], extra: Partial<CustomFieldDef> = {}) =>
  ({
    id: '00000000-0000-4000-8000-000000000001',
    entity: 'contact',
    key,
    label: key,
    type,
    options: null,
    required: false,
    position: 0,
    ...extra,
  }) satisfies CustomFieldDef;

const defs = [
  def('company', 'text'),
  def('budget', 'number'),
  def('start', 'date'),
  def('warranty', 'bool'),
  def('stack', 'multiselect', { options: [{ value: 'react', label: 'React' }] }),
];

describe('custom field form ↔ API values', () => {
  it('converts inputs to API values; empty means null', () => {
    expect(toApiValue(defs[0]!, '  Acme ')).toBe('Acme');
    expect(toApiValue(defs[0]!, '   ')).toBeNull();
    expect(toApiValue(defs[1]!, '2500.50')).toBe(2500.5);
    expect(toApiValue(defs[1]!, '')).toBeNull();
    expect(toApiValue(defs[1]!, '2.5 lakh')).toBe('2.5 lakh'); // left for the schema to reject
    expect(toApiValue(defs[3]!, true)).toBe(true);
    expect(toApiValue(defs[4]!, [])).toBeNull();
  });

  it('create: sends only fields with a value (an unticked optional checkbox is "not set")', () => {
    const inputs = { ...initialInputs(defs, undefined), company: 'Acme', budget: '10' };
    expect(customFieldsPayload(defs, inputs, undefined)).toEqual({ company: 'Acme', budget: 10 });
  });

  it('update: sends only changed fields; clearing sends null', () => {
    const stored = { company: 'Acme', budget: 10, stack: ['react'] };
    const inputs = { ...initialInputs(defs, stored), budget: '', start: '2026-12-01' };
    expect(customFieldsPayload(defs, inputs, stored)).toEqual({
      budget: null,
      start: '2026-12-01',
    });
    expect(customFieldsPayload(defs, initialInputs(defs, stored), stored)).toEqual({});
  });
});
