import { Injectable } from '@nestjs/common';
import {
  type Tx,
  and,
  asc,
  eq,
  inArray,
  isNull,
  pipelineStages,
  pipelines,
  tenants,
} from '@revops/db';
import type { Pipeline } from '@revops/shared';

/** SQL for the CRM setup tables. Every method runs in the caller's tenant transaction (RLS). */
@Injectable()
export class CrmRepository {
  async hasPipelines(tx: Tx): Promise<boolean> {
    const [row] = await tx.select({ id: pipelines.id }).from(pipelines).limit(1);
    return Boolean(row);
  }

  async tenantTemplate(tx: Tx, tenantId: string): Promise<string | null> {
    const [row] = await tx
      .select({ template: tenants.industryTemplate })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    return row?.template ?? null;
  }

  /** Active pipelines in display order, each with its stages in order. */
  listPipelines(tx: Tx): Promise<Pipeline[]> {
    return this.pipelinesWithStages(tx);
  }

  /** One active pipeline with its stages (undefined if missing, deleted or not this tenant's). */
  async getPipeline(tx: Tx, id: string): Promise<Pipeline | undefined> {
    return (await this.pipelinesWithStages(tx, id))[0];
  }

  private async pipelinesWithStages(tx: Tx, id?: string): Promise<Pipeline[]> {
    const rows = await tx
      .select()
      .from(pipelines)
      .where(and(isNull(pipelines.deletedAt), id ? eq(pipelines.id, id) : undefined))
      .orderBy(asc(pipelines.position), asc(pipelines.createdAt));
    if (rows.length === 0) return [];
    const stages = await tx
      .select()
      .from(pipelineStages)
      .where(
        and(
          inArray(
            pipelineStages.pipelineId,
            rows.map((p) => p.id),
          ),
        ),
      )
      .orderBy(asc(pipelineStages.position), asc(pipelineStages.createdAt));
    return rows.map((p) => ({
      id: p.id,
      key: p.key,
      name: p.name,
      isDefault: p.isDefault,
      position: p.position,
      lostReasons: p.lostReasons,
      stages: stages
        .filter((s) => s.pipelineId === p.id)
        .map((s) => ({
          id: s.id,
          key: s.key,
          name: s.name,
          category: s.category,
          probability: s.probability,
          position: s.position,
        })),
    }));
  }
}
