import { Injectable } from '@nestjs/common';
import {
  type Tx,
  and,
  asc,
  csvImportErrors,
  csvImports,
  customFieldDefs,
  desc,
  eq,
  isNull,
  leadSources,
  sql,
} from '@revops/db';

export type CsvImportRow = typeof csvImports.$inferSelect;
export type CsvImportErrorInsert = Omit<typeof csvImportErrors.$inferInsert, 'id'>;

/** CSV imports (M2-T5). Every method runs in the caller's tenant transaction. */
@Injectable()
export class ImportsRepository {
  /** A live source of this tenant (any state), for upload/start checks and the job. */
  async source(tx: Tx, id: string) {
    const [row] = await tx
      .select({
        id: leadSources.id,
        name: leadSources.name,
        type: leadSources.type,
        isActive: leadSources.isActive,
        config: leadSources.config,
      })
      .from(leadSources)
      .where(and(eq(leadSources.id, id), isNull(leadSources.deletedAt)));
    return row;
  }

  /** Lead custom fields (key + label) for the mapping guess. */
  leadFields(tx: Tx) {
    return tx
      .select({ key: customFieldDefs.key, label: customFieldDefs.label })
      .from(customFieldDefs)
      .where(and(eq(customFieldDefs.entity, 'lead'), isNull(customFieldDefs.deletedAt)));
  }

  async insert(tx: Tx, values: typeof csvImports.$inferInsert): Promise<CsvImportRow> {
    const [row] = await tx.insert(csvImports).values(values).returning();
    if (!row) throw new Error('csv import insert returned nothing');
    return row;
  }

  async get(tx: Tx, id: string): Promise<CsvImportRow | undefined> {
    const [row] = await tx.select().from(csvImports).where(eq(csvImports.id, id));
    return row;
  }

  async lock(tx: Tx, id: string): Promise<CsvImportRow | undefined> {
    const [row] = await tx.select().from(csvImports).where(eq(csvImports.id, id)).for('update');
    return row;
  }

  listBySource(tx: Tx, sourceId: string, limit: number): Promise<CsvImportRow[]> {
    return tx
      .select()
      .from(csvImports)
      .where(eq(csvImports.sourceId, sourceId))
      .orderBy(desc(csvImports.createdAt), desc(csvImports.id))
      .limit(limit);
  }

  async update(
    tx: Tx,
    id: string,
    values: Partial<typeof csvImports.$inferInsert>,
  ): Promise<CsvImportRow> {
    const [row] = await tx.update(csvImports).set(values).where(eq(csvImports.id, id)).returning();
    if (!row) throw new Error('csv import update returned nothing');
    return row;
  }

  /** Adds one batch's counts and moves the resume point, in the batch's transaction. */
  async advance(
    tx: Tx,
    id: string,
    processedRows: number,
    counts: { created: number; reenquiry: number; duplicate: number; failed: number },
  ): Promise<void> {
    await tx
      .update(csvImports)
      .set({
        processedRows,
        createdCount: sql`${csvImports.createdCount} + ${counts.created}`,
        reenquiryCount: sql`${csvImports.reenquiryCount} + ${counts.reenquiry}`,
        duplicateCount: sql`${csvImports.duplicateCount} + ${counts.duplicate}`,
        failedCount: sql`${csvImports.failedCount} + ${counts.failed}`,
      })
      .where(eq(csvImports.id, id));
  }

  async insertErrors(tx: Tx, rows: CsvImportErrorInsert[]): Promise<void> {
    if (rows.length === 0) return;
    await tx.insert(csvImportErrors).values(rows).onConflictDoNothing();
  }

  errors(tx: Tx, importId: string) {
    return tx
      .select({
        rowNumber: csvImportErrors.rowNumber,
        reason: csvImportErrors.reason,
        cells: csvImportErrors.cells,
      })
      .from(csvImportErrors)
      .where(eq(csvImportErrors.importId, importId))
      .orderBy(asc(csvImportErrors.rowNumber));
  }

  /** Refreshes planner statistics of the lead tables (definer, 0039). */
  async analyzeLeadTables(tx: Tx): Promise<void> {
    await tx.execute(sql`select capture_analyze_lead_tables()`);
  }
}
