import { describe, expect, it } from 'vitest';
import { startCsvImportRequestSchema, suggestCsvMapping } from './imports.js';

describe('suggestCsvMapping', () => {
  it('guesses builtins from common header spellings, each target once', () => {
    expect(
      suggestCsvMapping(['Full Name', 'Mobile No.', 'Email ID', 'City', 'Phone', 'Notes']),
    ).toEqual(['name', 'phone', 'email', 'city', null, null]);
  });

  it('maps lead custom fields by key or label', () => {
    expect(
      suggestCsvMapping(['Budget (INR)', 'course_interest'], [
        { key: 'budget_inr', label: 'Budget (INR)' },
        { key: 'course_interest', label: 'Course' },
      ]),
    ).toEqual(['lead.budget_inr', 'lead.course_interest']);
  });
});

describe('startCsvImportRequestSchema', () => {
  it('needs a phone or email column', () => {
    expect(startCsvImportRequestSchema.safeParse({ mapping: ['name', null] }).success).toBe(false);
    expect(startCsvImportRequestSchema.safeParse({ mapping: [null, 'email'] }).success).toBe(true);
  });

  it('rejects a target mapped twice and unknown targets', () => {
    expect(startCsvImportRequestSchema.safeParse({ mapping: ['phone', 'phone'] }).success).toBe(
      false,
    );
    expect(startCsvImportRequestSchema.safeParse({ mapping: ['phone', 'lead.Bad Key'] }).success)
      .toBe(false);
  });
});
