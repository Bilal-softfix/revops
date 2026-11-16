import { Injectable } from '@nestjs/common';
import {
  type Tx,
  and,
  asc,
  eq,
  isNull,
  leads,
  ne,
  pipelineStages,
  pipelines,
  sql,
} from '@revops/db';
import type { StageCategory } from '@revops/shared';

type PipelineRow = typeof pipelines.$inferSelect;
type StageRow = typeof pipelineStages.$inferSelect;

/** SQL for pipeline/stage management (M1-T3b); tenant transaction (RLS) supplied by the caller. */
@Injectable()
export class PipelinesRepository {
  /**
   * Locks an active pipeline row. Every structural change to a pipeline (stages added, removed,
   * recategorised, reordered; the pipeline deleted) takes this lock first, so invariants such as
   * "at least one open stage" can't be broken by two concurrent requests.
   */
  async lock(tx: Tx, id: string): Promise<PipelineRow | undefined> {
    const [row] = await tx
      .select()
      .from(pipelines)
      .where(and(eq(pipelines.id, id), isNull(pipelines.deletedAt)))
      .for('update');
    return row;
  }

  /** Locks every active pipeline (default switch, reorder), in a stable order. */
  async lockAll(tx: Tx): Promise<PipelineRow[]> {
    return tx
      .select()
      .from(pipelines)
      .where(isNull(pipelines.deletedAt))
      .orderBy(asc(pipelines.id))
      .for('update');
  }

  async nameTaken(tx: Tx, name: string, exceptId?: string): Promise<boolean> {
    const [row] = await tx
      .select({ id: pipelines.id })
      .from(pipelines)
      .where(
        and(
          isNull(pipelines.deletedAt),
          sql`lower(${pipelines.name}) = lower(${name})`,
          exceptId ? ne(pipelines.id, exceptId) : undefined,
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  async nextPosition(tx: Tx): Promise<number> {
    const [row] = await tx
      .select({ next: sql<number>`coalesce(max(${pipelines.position}) + 1, 0)::int` })
      .from(pipelines)
      .where(isNull(pipelines.deletedAt));
    return row?.next ?? 0;
  }

  async insert(
    tx: Tx,
    values: { tenantId: string; name: string; position: number; lostReasons: string[] },
  ): Promise<PipelineRow> {
    const [row] = await tx.insert(pipelines).values(values).returning();
    if (!row) throw new Error('pipeline insert returned nothing');
    return row;
  }

  async update(
    tx: Tx,
    id: string,
    patch: Partial<Pick<PipelineRow, 'name' | 'lostReasons' | 'isDefault' | 'position'>>,
  ): Promise<void> {
    await tx
      .update(pipelines)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(pipelines.id, id));
  }

  /** Clears the current default (before setting another: one default per tenant, unique index). */
  async clearDefault(tx: Tx): Promise<void> {
    await tx
      .update(pipelines)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(and(eq(pipelines.isDefault, true), isNull(pipelines.deletedAt)));
  }

  async softDelete(tx: Tx, id: string, now: Date): Promise<void> {
    await tx
      .update(pipelines)
      .set({ deletedAt: now, isDefault: false, updatedAt: now })
      .where(eq(pipelines.id, id));
  }

  async stages(tx: Tx, pipelineId: string, options: { lock?: boolean } = {}): Promise<StageRow[]> {
    const query = tx
      .select()
      .from(pipelineStages)
      .where(eq(pipelineStages.pipelineId, pipelineId))
      .orderBy(asc(pipelineStages.position), asc(pipelineStages.createdAt));
    return options.lock ? query.for('update') : query;
  }

  async insertStages(
    tx: Tx,
    values: {
      tenantId: string;
      pipelineId: string;
      name: string;
      category: StageCategory;
      probability: number;
      position: number;
    }[],
  ): Promise<StageRow[]> {
    return tx.insert(pipelineStages).values(values).returning();
  }

  async updateStage(
    tx: Tx,
    id: string,
    patch: Partial<Pick<StageRow, 'name' | 'category' | 'probability' | 'position'>>,
  ): Promise<void> {
    await tx
      .update(pipelineStages)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(pipelineStages.id, id));
  }

  async deleteStage(tx: Tx, id: string): Promise<void> {
    await tx.delete(pipelineStages).where(eq(pipelineStages.id, id));
  }

  /** Writes positions 0..n-1 in the given order. */
  async setStagePositions(tx: Tx, ids: readonly string[]): Promise<void> {
    for (const [position, id] of ids.entries()) await this.updateStage(tx, id, { position });
  }

  async setPipelinePositions(tx: Tx, ids: readonly string[]): Promise<void> {
    for (const [position, id] of ids.entries()) await this.update(tx, id, { position });
  }

  /** Leads (not deleted) in a stage or in a pipeline. */
  async leadCount(tx: Tx, where: { stageId: string } | { pipelineId: string }): Promise<number> {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(leads)
      .where(
        and(
          isNull(leads.deletedAt),
          'stageId' in where
            ? eq(leads.stageId, where.stageId)
            : eq(leads.pipelineId, where.pipelineId),
        ),
      );
    return row?.n ?? 0;
  }

  /**
   * Moves every lead row of a stage (soft-deleted ones too, or the FK would keep the stage alive)
   * to another stage of the same pipeline. Returns how many non-deleted leads moved.
   */
  async moveLeads(tx: Tx, fromStageId: string, toStageId: string, now: Date): Promise<number> {
    const moved = await tx
      .update(leads)
      .set({ stageId: toStageId, updatedAt: now })
      .where(eq(leads.stageId, fromStageId))
      .returning({ deletedAt: leads.deletedAt });
    return moved.filter((l) => l.deletedAt === null).length;
  }
}
