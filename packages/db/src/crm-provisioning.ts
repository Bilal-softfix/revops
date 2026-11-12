import { type IndustryTemplate, industryTemplate } from '@revops/shared';
import { eq, sql } from 'drizzle-orm';
import type { Tx } from './client.js';
import { customFieldDefs, leadSources, pipelineStages, pipelines } from './schema/index.js';

export interface ProvisionResult {
  /** false = the tenant already had a CRM setup; nothing was written. */
  provisioned: boolean;
  template: string;
}

/**
 * Seeds a tenant's CRM setup (pipelines + stages, custom field definitions, lead sources) from an
 * industry template — once. Runs inside the caller's transaction, which must be in that tenant's
 * context (withTenant/withContext). Idempotent and safe under concurrency: a transaction-scoped
 * advisory lock per tenant serialises provisioners, and a tenant that already has any pipeline is
 * left alone (later template edits never touch existing tenants). Unknown keys → `generic`.
 */
export async function provisionCrm(
  tx: Tx,
  tenantId: string,
  templateKey: string | null | undefined,
): Promise<ProvisionResult> {
  const template = industryTemplate(templateKey);
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`crm-provision:${tenantId}`}, 0))`,
  );
  const [existing] = await tx
    .select({ id: pipelines.id })
    .from(pipelines)
    .where(eq(pipelines.tenantId, tenantId))
    .limit(1);
  if (existing) return { provisioned: false, template: template.key };
  await writeTemplate(tx, tenantId, template);
  return { provisioned: true, template: template.key };
}

async function writeTemplate(tx: Tx, tenantId: string, template: IndustryTemplate): Promise<void> {
  for (const [position, pipeline] of template.pipelines.entries()) {
    const [row] = await tx
      .insert(pipelines)
      .values({
        tenantId,
        key: pipeline.key,
        name: pipeline.name,
        isDefault: pipeline.isDefault,
        position,
        lostReasons: pipeline.lostReasons,
      })
      .returning({ id: pipelines.id });
    if (!row) throw new Error(`could not create pipeline ${pipeline.key}`);
    await tx.insert(pipelineStages).values(
      pipeline.stages.map((stage, stagePosition) => ({
        tenantId,
        pipelineId: row.id,
        key: stage.key,
        name: stage.name,
        category: stage.category,
        probability: stage.probability,
        position: stagePosition,
      })),
    );
  }
  if (template.customFields.length > 0) {
    await tx.insert(customFieldDefs).values(
      template.customFields.map((field, position) => ({
        tenantId,
        entity: field.entity,
        key: field.key,
        label: field.label,
        type: field.type,
        options: field.options ?? null,
        required: field.required,
        position,
      })),
    );
  }
  await tx.insert(leadSources).values(
    template.leadSources.map((source) => ({
      tenantId,
      key: source.key,
      name: source.name,
      type: source.type,
    })),
  );
}
