import { Injectable } from '@nestjs/common';
import { type Tx, and, asc, customFieldDefs, eq, isNull } from '@revops/db';
import type { CustomFieldDef, CustomFieldEntity, FieldOption } from '@revops/shared';

type DefRow = typeof customFieldDefs.$inferSelect;

export function toCustomFieldDef(row: DefRow): CustomFieldDef {
  return {
    id: row.id,
    entity: row.entity,
    key: row.key,
    label: row.label,
    type: row.type,
    options: row.options,
    required: row.required,
    position: row.position,
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
    return rows.map(toCustomFieldDef);
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
