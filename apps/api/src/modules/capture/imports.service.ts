import { createHash, randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  CSV_IMPORT_LIMITS,
  type CsvImport,
  type CsvImportList,
  type CsvImportPreview,
  type CsvRowError,
  type LeadSourceConfig,
  type StartCsvImportRequest,
  leadSourceConfigSchema,
  suggestCsvMapping,
} from '@revops/shared';
import type { Tx } from '@revops/db';
import { z } from 'zod';
import { Clock } from '../../platform/clock';
import { CsvParseError, parseCsv } from '../../platform/csv-parse';
import { csvDocument } from '../../platform/csv';
import { Database } from '../../platform/database/database';
import { DomainError } from '../../platform/errors/domain-error';
import { recordAudit } from '../../platform/outbox/record';
import { type JobContext, JobHandler, defineJob } from '../../platform/queue/job';
import { JobQueue } from '../../platform/queue/job-queue';
import { RateLimiter } from '../../platform/rate-limit/rate-limiter';
import type { RequestMeta } from '../../platform/request-meta';
import { StorageProvider } from '../../providers/storage';
import { type CrmAuth, CrmService, LeadIntakeService } from '../crm';
import {
  type CsvImportRow,
  type CsvImportErrorInsert,
  ImportsRepository,
} from './imports.repository';
import { toIntakeInput } from './mapping';

/** Uploads per tenant per hour (each is up to 10 MB of storage and parsing). */
export const CSV_UPLOAD_LIMIT = { limit: 30, windowMs: 3600_000 } as const;
/** Rows per transaction in the job: progress and the resume point advance per batch. */
export const CSV_BATCH_SIZE = 250;
const LIST_LIMIT = 20;

export const CSV_IMPORT_JOB = defineJob(
  'capture.csv-import',
  z.object({ tenantId: z.uuid(), importId: z.uuid() }),
  // A 50k-row file takes minutes; a retry resumes at processed_rows.
  { retryLimit: 3, expireInSeconds: 3600 },
);

/** Error report wording (English for MVP; one place for future i18n). */
export const CSV_ROW_ERROR_TEXT: Record<CsvRowError, string> = {
  unusable: 'No valid phone number or email',
  wrong_column_count: 'More cells than the header row',
  failed: 'Could not be imported',
};

const notFound = () => new DomainError('not_found', 404, 'Not found');
const unreadable = (detail: string) => new DomainError('csv_unreadable', 400, detail);

/** UTF-8 (with or without BOM); otherwise Windows-1252, which older Excel versions save. */
export function decodeCsv(bytes: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** Stable per-row identity for re-runs: same source + same cells = same idempotency key. */
export function rowKey(sourceId: string, cells: readonly string[]): string {
  const hash = createHash('sha256')
    .update(cells.map((c) => c.trim()).join('\u001f'))
    .digest('hex');
  return `csv:${sourceId}:${hash}`;
}

/** File name as shown in the UI: the base name, printable, at most 200 chars. */
export function cleanFileName(raw: string | undefined): string {
  let name = raw ?? '';
  try {
    name = decodeURIComponent(name);
  } catch {
    // keep as sent
  }
  name = name
    .split(/[\\/]/)
    .pop()
    ?.split('')
    .filter((ch) => ch.charCodeAt(0) > 0x1f && ch.charCodeAt(0) !== 0x7f)
    .join('')
    .trim()
    .slice(0, 200) as string;
  return name || 'import.csv';
}

const toIso = (d: Date | null) => (d ? d.toISOString() : null);

export function toCsvImport(row: CsvImportRow): CsvImport {
  return {
    id: row.id,
    sourceId: row.sourceId,
    fileName: row.fileName,
    status: row.status as CsvImport['status'],
    headers: row.headers,
    mapping: row.mapping ?? null,
    totalRows: row.totalRows,
    processedRows: row.processedRows,
    createdCount: row.createdCount,
    reenquiryCount: row.reenquiryCount,
    duplicateCount: row.duplicateCount,
    failedCount: row.failedCount,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    startedAt: toIso(row.startedAt),
    finishedAt: toIso(row.finishedAt),
  };
}

interface ParsedFile {
  headers: string[];
  rows: string[][];
}

/** Header + data rows, within the limits; throws csv_unreadable / csv_too_large. */
export function readCsvFile(bytes: Buffer): ParsedFile {
  const records: string[][] = [];
  try {
    for (const record of parseCsv(decodeCsv(bytes))) {
      records.push(record);
      if (records.length > CSV_IMPORT_LIMITS.maxRows + 1) {
        throw new DomainError(
          'csv_too_large',
          413,
          `At most ${CSV_IMPORT_LIMITS.maxRows.toLocaleString('en-IN')} rows per file`,
        );
      }
    }
  } catch (error) {
    if (error instanceof CsvParseError) {
      throw unreadable(`Can't read the file: ${error.message} (line ${error.line})`);
    }
    throw error;
  }
  const [header, ...rows] = records;
  const headers = (header ?? []).map((h) => h.trim().slice(0, 100));
  if (headers.length === 0 || headers.every((h) => h === '')) {
    throw unreadable('The first row must hold the column names');
  }
  if (headers.length > CSV_IMPORT_LIMITS.maxColumns) {
    throw unreadable(`At most ${CSV_IMPORT_LIMITS.maxColumns} columns`);
  }
  if (rows.length === 0) throw unreadable('The file has no rows below the column names');
  return { headers, rows };
}

/**
 * CSV import (M2-T5): upload (stored, previewed, mapping guessed) → start with a mapping →
 * `capture.csv-import` job. Owners/admins (`source.manage`), audited.
 */
@Injectable()
export class ImportsService {
  constructor(
    private readonly crm: CrmService,
    private readonly repository: ImportsRepository,
    private readonly storage: StorageProvider,
    private readonly limiter: RateLimiter,
    private readonly jobs: JobQueue,
  ) {}

  async upload(
    auth: CrmAuth,
    sourceId: string,
    body: Buffer,
    fileName: string | undefined,
    meta: RequestMeta,
  ): Promise<CsvImportPreview> {
    const retryAfter = await this.limiter.consume(
      `csv-upload:${auth.tenantId}`,
      CSV_UPLOAD_LIMIT.limit,
      CSV_UPLOAD_LIMIT.windowMs,
    );
    if (retryAfter > 0) {
      throw new DomainError('rate_limited', 429, 'Too many uploads — try again later', {
        headers: { 'Retry-After': String(retryAfter) },
      });
    }
    // Source checks before parsing: no work for a wrong id.
    await this.crm.withCrm(auth, async (tx) => this.importableSource(tx, sourceId));
    const parsed = readCsvFile(body);
    const id = randomUUID();
    const storageKey = `imports/${auth.tenantId}/${id}.csv`;
    await this.storage.put(storageKey, body, 'text/csv');
    return this.crm.withCrm(auth, async (tx) => {
      await this.importableSource(tx, sourceId);
      const row = await this.repository.insert(tx, {
        id,
        tenantId: auth.tenantId,
        sourceId,
        createdBy: auth.userId,
        fileName: cleanFileName(fileName),
        storageKey,
        sizeBytes: body.length,
        fileSha256: createHash('sha256').update(body).digest('hex'),
        headers: parsed.headers,
        totalRows: parsed.rows.length,
      });
      await this.audit(tx, auth, meta, 'csv_import.uploaded', id, {
        sourceId,
        rows: parsed.rows.length,
      });
      const fields = await this.repository.leadFields(tx);
      return {
        import: toCsvImport(row),
        preview: parsed.rows.slice(0, CSV_IMPORT_LIMITS.previewRows),
        suggestedMapping: suggestCsvMapping(parsed.headers, fields),
      };
    });
  }

  async start(
    auth: CrmAuth,
    id: string,
    input: StartCsvImportRequest,
    meta: RequestMeta,
  ): Promise<CsvImport> {
    return this.crm.withCrm(auth, async (tx) => {
      const current = await this.repository.lock(tx, id);
      if (!current) throw notFound();
      if (current.status !== 'uploaded') {
        throw new DomainError('import_already_started', 409, 'This import has already started');
      }
      if (input.mapping.length !== current.headers.length) {
        throw new DomainError('validation_failed', 400, 'One mapping entry per column is needed');
      }
      await this.importableSource(tx, current.sourceId);
      const row = await this.repository.update(tx, id, {
        mapping: input.mapping,
        status: 'queued',
      });
      await this.jobs.send(CSV_IMPORT_JOB, { tenantId: auth.tenantId, importId: id }, { id, tx });
      await this.audit(tx, auth, meta, 'csv_import.started', id, {
        mapped: input.mapping.filter((t) => t !== null),
      });
      return toCsvImport(row);
    });
  }

  get(auth: CrmAuth, id: string): Promise<CsvImport> {
    return this.crm.withCrm(auth, async (tx) => {
      const row = await this.repository.get(tx, id);
      if (!row) throw notFound();
      return toCsvImport(row);
    });
  }

  list(auth: CrmAuth, sourceId: string): Promise<CsvImportList> {
    return this.crm.withCrm(auth, async (tx) => {
      if (!(await this.repository.source(tx, sourceId))) throw notFound();
      const rows = await this.repository.listBySource(tx, sourceId, LIST_LIMIT);
      return { items: rows.map(toCsvImport) };
    });
  }

  /** The rows that weren't imported, as CSV: row number, reason, then the original columns. */
  errorReport(auth: CrmAuth, id: string): Promise<{ fileName: string; csv: string }> {
    return this.crm.withCrm(auth, async (tx) => {
      const row = await this.repository.get(tx, id);
      if (!row) throw notFound();
      const errors = await this.repository.errors(tx, id);
      const base = row.fileName.replace(/\.csv$/i, '');
      return {
        fileName: `${base}-errors.csv`,
        csv: csvDocument([
          ['Row', 'Problem', ...row.headers],
          ...errors.map((e) => [
            e.rowNumber,
            CSV_ROW_ERROR_TEXT[e.reason as CsvRowError] ?? e.reason,
            ...e.cells,
          ]),
        ]),
      };
    });
  }

  private async importableSource(tx: Tx, sourceId: string) {
    const source = await this.repository.source(tx, sourceId);
    if (!source) throw notFound();
    if (source.type !== 'csv') {
      throw new DomainError('source_not_csv', 422, 'Choose a CSV import source');
    }
    if (!source.isActive) throw new DomainError('source_paused', 422, 'This source is paused');
    return source;
  }

  private audit(
    tx: Tx,
    auth: CrmAuth,
    meta: RequestMeta,
    action: string,
    entityId: string,
    after: Record<string, unknown>,
  ) {
    return recordAudit(tx, {
      tenantId: auth.tenantId,
      actorType: 'user',
      actorId: auth.userId,
      action,
      entity: 'csv_import',
      entityId,
      after,
      ip: meta.ip,
    });
  }
}

/**
 * Imports one started file (M2-T5): rows go through the LeadIntakeService in batches of 250,
 * one transaction each, with the counters and resume point advanced in the same transaction — so a
 * retried job continues where it stopped and a re-imported row is a `duplicate` (idempotency key
 * per source + row cells). Unusable rows are recorded for the error report. After ≥1k new leads
 * the lead tables are ANALYZEd. The file is deleted from storage when the import ends.
 */
@Injectable()
export class CsvImportJob extends JobHandler<z.infer<typeof CSV_IMPORT_JOB.schema>> {
  readonly job = CSV_IMPORT_JOB;
  private readonly logger = new Logger('CsvImport');

  constructor(
    private readonly repository: ImportsRepository,
    private readonly database: Database,
    private readonly intake: LeadIntakeService,
    private readonly storage: StorageProvider,
    private readonly clock: Clock,
  ) {
    super();
  }

  async handle(data: { tenantId: string; importId: string }, _context: JobContext): Promise<void> {
    const tenant = { tenantId: data.tenantId };
    const begun = await this.database.withContext(tenant, async (tx) => {
      const row = await this.repository.lock(tx, data.importId);
      if (!row || !['queued', 'processing'].includes(row.status)) return undefined;
      const source = await this.repository.source(tx, row.sourceId);
      await this.repository.update(tx, row.id, {
        status: 'processing',
        startedAt: row.startedAt ?? this.clock.now(),
      });
      return { row, source };
    });
    if (!begun) return; // finished, not started, or not ours
    const { row } = begun;

    const bytes = row.storageKey ? await this.storage.get(row.storageKey) : undefined;
    if (!bytes || !begun.source) {
      await this.finish(tenant, row, { error: bytes ? 'source_deleted' : 'file_missing' });
      return;
    }
    const { rows } = readCsvFile(bytes);
    const mapping = row.mapping ?? [];
    const config: LeadSourceConfig = {
      ...leadSourceConfigSchema.parse(begun.source.config ?? {}),
      // Columns by index (`c0`, `c1`, …): header names may contain anything.
      fieldMapping: Object.fromEntries(
        mapping.flatMap((target, i) => (target ? [[`c${i}`, target]] : [])),
      ),
    };
    const source = { id: row.sourceId, name: begun.source.name, config };

    for (let start = row.processedRows; start < rows.length; start += CSV_BATCH_SIZE) {
      const batch = rows.slice(start, start + CSV_BATCH_SIZE);
      await this.database.withContext(tenant, async (tx) => {
        const counts = { created: 0, reenquiry: 0, duplicate: 0, failed: 0 };
        const errors: CsvImportErrorInsert[] = [];
        const fail = (rowNumber: number, reason: CsvRowError, cells: string[]) => {
          counts.failed += 1;
          errors.push({ tenantId: data.tenantId, importId: row.id, rowNumber, reason, cells });
        };
        for (const [offset, cells] of batch.entries()) {
          const rowNumber = start + offset + 1;
          if (cells.length > row.headers.length && cells.slice(row.headers.length).some(Boolean)) {
            fail(rowNumber, 'wrong_column_count', cells);
            continue;
          }
          const fields = Object.fromEntries(cells.map((value, i) => [`c${i}`, value]));
          try {
            const result = await tx.transaction((sp) =>
              this.intake.ingest(sp, {
                tenantId: data.tenantId,
                source,
                idempotencyKey: rowKey(row.sourceId, cells),
                input: toIntakeInput(fields, undefined, config),
              }),
            );
            counts[result.outcome] += 1;
          } catch (error) {
            if (!(error instanceof DomainError)) throw error; // DB trouble: retry the batch
            fail(rowNumber, error.code === 'intake_unusable' ? 'unusable' : 'failed', cells);
          }
        }
        await this.repository.insertErrors(tx, errors);
        await this.repository.advance(tx, row.id, start + batch.length, counts);
      });
    }
    await this.finish(tenant, row, {});
  }

  private async finish(
    tenant: { tenantId: string },
    row: CsvImportRow,
    outcome: { error?: string },
  ): Promise<void> {
    const done = await this.database.withContext(tenant, async (tx) => {
      const updated = await this.repository.update(tx, row.id, {
        status: outcome.error ? 'failed' : 'completed',
        error: outcome.error ?? null,
        finishedAt: this.clock.now(),
        storageKey: null,
      });
      if (updated.createdCount >= CSV_IMPORT_LIMITS.analyzeAfterRows) {
        await this.repository.analyzeLeadTables(tx);
      }
      return updated;
    });
    if (row.storageKey) await this.storage.delete(row.storageKey);
    this.logger.log(
      `import ${row.id}: ${done.status} — ${done.createdCount} created, ${done.reenquiryCount} re-enquiries, ${done.duplicateCount} duplicates, ${done.failedCount} failed`,
    );
  }
}
