import { z } from 'zod';
import { type MAPPING_BUILTINS, mappingTargetSchema } from './lead-sources.js';

// CSV import (M2-T5): upload → preview + column mapping → background import → error report.

export const CSV_IMPORT_LIMITS = {
  /** Upload cap (threat model). */
  maxBytes: 10 * 1024 * 1024,
  /** Data rows (the header line not counted). */
  maxRows: 50_000,
  maxColumns: 100,
  previewRows: 20,
  /** ANALYZE the lead tables after an import that inserted at least this many rows. */
  analyzeAfterRows: 1_000,
} as const;

/** Raw CSV body: `Content-Type: text/csv`, the original name in this header (optional). */
export const CSV_FILE_NAME_HEADER = 'x-file-name';

export const CSV_IMPORT_STATUSES = [
  'uploaded',
  'queued',
  'processing',
  'completed',
  'failed',
] as const;
export const csvImportStatusSchema = z.enum(CSV_IMPORT_STATUSES);
export type CsvImportStatus = z.infer<typeof csvImportStatusSchema>;

/** Per column: where its values go, or null to ignore the column. */
export const csvColumnMappingSchema = z.array(mappingTargetSchema.nullable());
export type CsvColumnMapping = z.infer<typeof csvColumnMappingSchema>;

/**
 * Why a row was not imported (error report). `unusable`: no valid phone or email after mapping;
 * `wrong_column_count`: the row has more cells than the header; `failed`: an unexpected error.
 */
export const CSV_ROW_ERRORS = ['unusable', 'wrong_column_count', 'failed'] as const;
export type CsvRowError = (typeof CSV_ROW_ERRORS)[number];

export const csvImportSchema = z.object({
  id: z.uuid(),
  sourceId: z.uuid(),
  fileName: z.string(),
  status: csvImportStatusSchema,
  headers: z.array(z.string()),
  mapping: csvColumnMappingSchema.nullable(),
  totalRows: z.number().int(),
  processedRows: z.number().int(),
  createdCount: z.number().int(),
  /** Rows that matched an existing contact with an open lead (re-enquiry). */
  reenquiryCount: z.number().int(),
  /** Rows already imported before (same source, same cells) — skipped. */
  duplicateCount: z.number().int(),
  failedCount: z.number().int(),
  /** Why the whole import failed (status failed): a short code. */
  error: z.string().nullable(),
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
});
export type CsvImport = z.infer<typeof csvImportSchema>;

export const csvImportListSchema = z.object({ items: z.array(csvImportSchema) });
export type CsvImportList = z.infer<typeof csvImportListSchema>;

/** Upload response: the import, the first rows, and a mapping guessed from the header names. */
export const csvImportPreviewSchema = z.object({
  import: csvImportSchema,
  preview: z.array(z.array(z.string())),
  suggestedMapping: csvColumnMappingSchema,
});
export type CsvImportPreview = z.infer<typeof csvImportPreviewSchema>;

/** Start: the mapping (one entry per header column). Phone or email must be mapped. */
export const startCsvImportRequestSchema = z
  .strictObject({ mapping: csvColumnMappingSchema.max(CSV_IMPORT_LIMITS.maxColumns) })
  .superRefine(({ mapping }, ctx) => {
    const targets = mapping.filter((t): t is NonNullable<typeof t> => t !== null);
    if (!targets.includes('phone') && !targets.includes('email')) {
      ctx.addIssue({ code: 'custom', path: ['mapping'], message: 'map a phone or email column' });
    }
    const seen = new Set<string>();
    for (const target of targets) {
      if (seen.has(target)) {
        ctx.addIssue({
          code: 'custom',
          path: ['mapping'],
          message: `${target} is mapped to more than one column`,
        });
      }
      seen.add(target);
    }
  });
export type StartCsvImportRequest = z.infer<typeof startCsvImportRequestSchema>;

const HEADER_GUESSES: Record<string, (typeof MAPPING_BUILTINS)[number]> = {
  name: 'name',
  fullname: 'name',
  customername: 'name',
  contactname: 'name',
  leadname: 'name',
  phone: 'phone',
  phonenumber: 'phone',
  mobile: 'phone',
  mobilenumber: 'phone',
  mobileno: 'phone',
  contactnumber: 'phone',
  whatsapp: 'phone',
  whatsappnumber: 'phone',
  tel: 'phone',
  email: 'email',
  emailaddress: 'email',
  emailid: 'email',
  mail: 'email',
  city: 'city',
  location: 'city',
};

/**
 * Mapping guessed from header names ("Mobile No." → phone, "Email ID" → email, a lead custom
 * field's key or label → lead.<key>). Each target is used once; the rest are ignored.
 */
export function suggestCsvMapping(
  headers: readonly string[],
  leadFields: readonly { key: string; label: string }[] = [],
): CsvColumnMapping {
  const squash = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const used = new Set<string>();
  return headers.map((header) => {
    const name = squash(header);
    const field = leadFields.find((f) => squash(f.key) === name || squash(f.label) === name);
    const target = HEADER_GUESSES[name] ?? (field ? (`lead.${field.key}` as const) : undefined);
    if (!target || used.has(target)) return null;
    used.add(target);
    return target;
  });
}
