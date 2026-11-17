import { Injectable } from '@nestjs/common';
import {
  type Tx,
  and,
  asc,
  customFieldDefs,
  customFieldPipelines,
  eq,
  inArray,
  isNull,
  pipelines,
} from '@revops/db';
import type { CustomFieldDef, CustomFieldEntity, FieldOption } from '@revops/shared';

type DefRow = typeof customFieldDefs.$inferSelect;

/** `scope`: the active pipelines the field is limited to; undefined = all pipelines. */
export function toCustomFieldDef(row: DefRow, scope?: readonly string[]): CustomFieldDef {
  return {
    id: row.id,
    entity: row.entity,
    key: row.key,
    label: row.label,
    type: row.type,
    options: row.options,
    required: row.required,
    position: row.position,
    pipelineIds: scope ? [...scope] : null,
  };
}

/** SQL for custom field definitions; tenant transaction (RLS) supplied by the caller. */
@Injectable()
export class CustomFieldsRepository {
  async listActive(tx: Tx, entity?: CustomFieldEntity): Promise<CustomFieldDef[]> {
    const rows = await tx
      .select()
      .from(customFieldDefs)
      .where(
        and(
          isNull(customFieldDefs.deletedAt),
          entity ? eq(customFieldDefs.entity, entity) : undefined,
        ),
      )
      .orderBy(
        asc(customFieldDefs.entity),
        asc(customFieldDefs.position),
        asc(customFieldDefs.createdAt),
      );
    const scopes = await this.scopes(
      tx,
      rows.map((r) => r.id),
    );
    return rows.map((row) => toCustomFieldDef(row, scopes.get(row.id)));
  }

  /** One active definition as the API shows it. */
  async getActive(tx: Tx, id: string): Promise<CustomFieldDef | undefined> {
    const row = await this.findActive(tx, id);
    return row ? toCustomFieldDef(row, (await this.scopes(tx, [id])).get(id)) : undefined;
  }

  /**
   * "Applies to" per field: field id -> ids of the ACTIVE pipelines it is limited to, in pipeline
   * order. A field whose rows all point at deleted pipelines maps to [] (it applies nowhere until
   * edited); a field with no rows is absent (= all pipelines).
   */
  async scopes(tx: Tx, fieldIds: readonly string[]): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    if (fieldIds.length === 0) return out;
    const rows = await tx
      .select({
        fieldId: customFieldPipelines.fieldId,
        pipelineId: customFieldPipelines.pipelineId,
        deletedAt: pipelines.deletedAt,
      })
      .from(customFieldPipelines)
      .innerJoin(pipelines, eq(pipelines.id, customFieldPipelines.pipelineId))
      .where(inArray(customFieldPipelines.fieldId, [...fieldIds]))
      .orderBy(asc(pipelines.position), asc(pipelines.createdAt));
    for (const row of rows) {
      const list = out.get(row.fieldId) ?? [];
      if (row.deletedAt === null) list.push(row.pipelineId);
      out.set(row.fieldId, list);
    }
    return out;
  }

  /** Replaces a field's scope: null = all pipelines (no rows). */
  async setScope(
    tx: Tx,
    tenantId: string,
    fieldId: string,
    pipelineIds: readonly string[] | null,
  ): Promise<void> {
    await tx.delete(customFieldPipelines).where(eq(customFieldPipelines.fieldId, fieldId));
    if (pipelineIds && pipelineIds.length > 0) {
      await tx
        .insert(customFieldPipelines)
        .values(pipelineIds.map((pipelineId) => ({ tenantId, fieldId, pipelineId })));
    }
  }

  /** The given ids that are active pipelines of this tenant (RLS hides other tenants' rows). */
  async activePipelineIds(tx: Tx, ids: readonly string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await tx
      .select({ id: pipelines.id })
      .from(pipelines)
      .where(and(inArray(pipelines.id, [...ids]), isNull(pipelines.deletedAt)));
    return new Set(rows.map((r) => r.id));
  }

  async findActive(tx: Tx, id: string): Promise<DefRow | undefined> {
    const [row] = await tx
      .select()
      .from(customFieldDefs)
      .where(and(eq(customFieldDefs.id, id), isNull(customFieldDefs.deletedAt)));
    return row;
  }

  /** Including deleted definitions: a key is never reused (old values must not resurface). */
  async keyTaken(tx: Tx, entity: CustomFieldEntity, key: string): Promise<boolean> {
    const [row] = await tx
      .select({ id: customFieldDefs.id })
      .from(customFieldDefs)
      .where(and(eq(customFieldDefs.entity, entity), eq(customFieldDefs.key, key)))
      .limit(1);
    return Boolean(row);
  }

  async nextPosition(tx: Tx, entity: CustomFieldEntity): Promise<number> {
    const rows = await this.listActive(tx, entity);
    return rows.reduce((max, d) => Math.max(max, d.position + 1), 0);
  }

  async insert(
    tx: Tx,
    values: {
      tenantId: string;
      entity: CustomFieldEntity;
      key: string;
      label: string;
      type: DefRow['type'];
      options: FieldOption[] | null;
      required: boolean;
      position: number;
    },
  ): Promise<DefRow> {
    const [row] = await tx.insert(customFieldDefs).values(values).returning();
    if (!row) throw new Error('custom field insert returned nothing');
    return row;
  }

  async update(
    tx: Tx,
    id: string,
    patch: Partial<Pick<DefRow, 'label' | 'options' | 'required' | 'position'>>,
  ): Promise<DefRow> {
    const [row] = await tx
      .update(customFieldDefs)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(customFieldDefs.id, id))
      .returning();
    if (!row) throw new Error('custom field update returned nothing');
    return row;
  }

  async softDelete(tx: Tx, id: string, now: Date): Promise<void> {
    await tx
      .update(customFieldDefs)
      .set({ deletedAt: now, updatedAt: now })
      .where(eq(customFieldDefs.id, id));
  }
}
