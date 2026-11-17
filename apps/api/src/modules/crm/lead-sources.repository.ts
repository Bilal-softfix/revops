import { Injectable } from '@nestjs/common';
import { type Tx, and, asc, eq, isNull, leadSources, ne, sql } from '@revops/db';

export type LeadSourceRow = typeof leadSources.$inferSelect;

/** Lead sources of the current tenant (RLS). Soft-deleted rows are invisible here. */
@Injectable()
export class LeadSourcesRepository {
  list(tx: Tx): Promise<LeadSourceRow[]> {
    return tx
      .select()
      .from(leadSources)
      .where(isNull(leadSources.deletedAt))
      .orderBy(asc(leadSources.createdAt), asc(leadSources.name));
  }

  /** Locks a live source for a change (config, rotation, delete). */
  async lock(tx: Tx, id: string): Promise<LeadSourceRow | undefined> {
    const [row] = await tx
      .select()
      .from(leadSources)
      .where(and(eq(leadSources.id, id), isNull(leadSources.deletedAt)))
      .for('update');
    return row;
  }

  async nameTaken(tx: Tx, name: string, exceptId?: string): Promise<boolean> {
    const [row] = await tx
      .select({ id: leadSources.id })
      .from(leadSources)
      .where(
        and(
          sql`lower(${leadSources.name}) = lower(${name})`,
          isNull(leadSources.deletedAt),
          exceptId ? ne(leadSources.id, exceptId) : undefined,
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  async insert(tx: Tx, values: typeof leadSources.$inferInsert): Promise<LeadSourceRow> {
    const [row] = await tx.insert(leadSources).values(values).returning();
    if (!row) throw new Error('lead source insert returned nothing');
    return row;
  }

  async update(
    tx: Tx,
    id: string,
    patch: Partial<
      Pick<
        typeof leadSources.$inferInsert,
        'name' | 'isActive' | 'config' | 'publicKey' | 'webhookSecretEnc' | 'deletedAt'
      >
    >,
  ): Promise<LeadSourceRow> {
    const [row] = await tx
      .update(leadSources)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(leadSources.id, id))
      .returning();
    if (!row) throw new Error('lead source update returned nothing');
    return row;
  }
}
