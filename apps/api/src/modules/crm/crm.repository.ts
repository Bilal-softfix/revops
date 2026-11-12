import { Injectable } from '@nestjs/common';
import {
  type Tx,
  and,
  asc,
  eq,
  inArray,
  isNull,
  leadSources,
  pipelineStages,
  pipelines,
  tenants,
} from '@revops/db';
import type { LeadSource, Pipeline } from '@revops/shared';

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
  async listPipelines(tx: Tx): Promise<Pipeline[]> {
    const rows = await tx
      .select()
      .from(pipelines)
      .where(isNull(pipelines.deletedAt))
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

  async listLeadSources(tx: Tx): Promise<LeadSource[]> {
    const rows = await tx
      .select()
      .from(leadSources)
      .orderBy(asc(leadSources.createdAt), asc(leadSources.name));
    return rows.map((s) => ({
      id: s.id,
      key: s.key,
      name: s.name,
      type: s.type,
      isActive: s.isActive,
    }));
  }
}
