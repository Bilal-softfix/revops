import type { CustomFieldDef } from '@revops/shared';
import { describe, expect, it } from 'vitest';
import type { Clock } from '../../platform/clock';
import { DomainError } from '../../platform/errors/domain-error';
import type { CrmService } from './crm.service';
import type { CustomFieldsRepository } from './custom-fields.repository';
import { CustomFieldsService } from './custom-fields.service';

// M1-T3b: value validation for leads only sees the fields of the lead's pipeline (M1-T4 calls it
// with the lead's pipelineId on create, edit and move).
const INQUIRIES = '11111111-1111-4111-8111-111111111111';
const REPAIRS = '22222222-2222-4222-8222-222222222222';
const def = (key: string, required: boolean, pipelineIds: string[] | null): CustomFieldDef => ({
  id: `00000000-0000-4000-8000-00000000000${key.length % 10}`,
  entity: 'lead',
  key,
  label: key,
  type: 'text',
  options: null,
  required,
  position: 0,
  pipelineIds,
});
const defs = [def('device_brand', true, null), def('imei_serial', true, [REPAIRS])];
const service = new CustomFieldsService(
  {} as CrmService,
  {} as CustomFieldsRepository,
  {} as Clock,
);
const errors = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    if (error instanceof DomainError) return error.options.extensions?.errors;
    throw error;
  }
  return undefined;
};

describe('CustomFieldsService.validateValues with a pipeline', () => {
  it('requires only the required fields that apply to the pipeline', () => {
    expect(
      service.validateValues(defs, { device_brand: 'Apple' }, 'create', { pipelineId: INQUIRIES }),
    ).toEqual({ device_brand: 'Apple' });
    const missing = errors(() =>
      service.validateValues(defs, { device_brand: 'Apple' }, 'create', { pipelineId: REPAIRS }),
    ) as { path: string }[] | undefined;
    expect(missing?.map((e) => e.path)).toEqual(['customFields.imei_serial']);
  });

  it('a value for a field of another pipeline "doesn’t apply"; unknown keys stay unknown', () => {
    expect(
      errors(() =>
        service.validateValues(defs, { imei_serial: '35', nope: 'x' }, 'patch', {
          pipelineId: INQUIRIES,
        }),
      ),
    ).toEqual([
      { path: 'customFields.imei_serial', message: 'doesn’t apply to this pipeline' },
      { path: 'customFields.nope', message: 'unknown field' },
    ]);
  });

  it('without a pipeline (contacts) every definition applies', () => {
    expect(service.validateValues(defs, { device_brand: 'A', imei_serial: '1' }, 'create')).toEqual(
      { device_brand: 'A', imei_serial: '1' },
    );
  });
});
