import { describe, expect, it } from 'vitest';
import {
  createLeadRequestSchema,
  leadFiltersToParams,
  leadQuerySchema,
  updateLeadRequestSchema,
} from './leads.js';

const ID = '11111111-1111-4111-8111-111111111111';

describe('lead requests (M1-T4)', () => {
  it('needs exactly one of contactId / contact, and a contact needs phone or email', () => {
    expect(createLeadRequestSchema.safeParse({}).success).toBe(false);
    expect(
      createLeadRequestSchema.safeParse({ contactId: ID, contact: { name: 'A', email: 'a@b.in' } })
        .success,
    ).toBe(false);
    expect(createLeadRequestSchema.safeParse({ contact: { name: 'A' } }).success).toBe(false);
    expect(
      createLeadRequestSchema.safeParse({ contact: { name: 'A', phone: '09876543210' } }).data
        ?.contact?.phone,
    ).toBe('+919876543210');
  });

  it('money is integer paise, never negative or fractional', () => {
    const base = { contactId: ID };
    expect(createLeadRequestSchema.safeParse({ ...base, valuePaise: 249_950 }).success).toBe(true);
    expect(createLeadRequestSchema.safeParse({ ...base, valuePaise: 2499.5 }).success).toBe(false);
    expect(createLeadRequestSchema.safeParse({ ...base, valuePaise: -1 }).success).toBe(false);
  });

  it('PATCH can’t move stages (strict): that goes through /stage', () => {
    expect(updateLeadRequestSchema.safeParse({ stageId: ID }).success).toBe(false);
    expect(updateLeadRequestSchema.safeParse({ valuePaise: null }).success).toBe(true);
  });

  it('filters round-trip through the query string', () => {
    const filters = {
      pipelineId: ID,
      stageIds: [ID],
      owner: 'unassigned' as const,
      customFields: { issue: ['screen'], estimate_inr: { min: 100, max: 500 } },
    };
    const query = Object.fromEntries(leadFiltersToParams(filters));
    expect(leadQuerySchema.parse(query)).toEqual({ filters, limit: 50, cursor: undefined });
    expect(leadQuerySchema.safeParse({ cf: '{oops' }).success).toBe(false);
    expect(leadQuerySchema.safeParse({ stageIds: 'not-a-uuid' }).success).toBe(false);
  });
});
