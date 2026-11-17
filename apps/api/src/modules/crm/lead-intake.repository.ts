import { Injectable } from '@nestjs/common';
import { type Tx, and, desc, eq, isNull, leadIngestions, leads, timelineEvents } from '@revops/db';

export type LeadIngestionRow = typeof leadIngestions.$inferSelect;
type LeadRow = typeof leads.$inferSelect;

/** SQL for the inbound intake and contact merge (M2-T4); tenant transaction from the caller. */
@Injectable()
export class LeadIntakeRepository {
  /**
   * Claims an idempotency key. Returns the new row, or undefined if the key was already used — a
   * concurrent claim of the same key waits here until the first transaction ends.
   */
  async claim(
    tx: Tx,
    values: { tenantId: string; sourceId: string | null; idempotencyKey: string },
  ): Promise<LeadIngestionRow | undefined> {
    const [row] = await tx
      .insert(leadIngestions)
      .values(values)
      .onConflictDoNothing({ target: [leadIngestions.tenantId, leadIngestions.idempotencyKey] })
      .returning();
    return row;
  }

  async byKey(tx: Tx, idempotencyKey: string): Promise<LeadIngestionRow | undefined> {
    const [row] = await tx
      .select()
      .from(leadIngestions)
      .where(eq(leadIngestions.idempotencyKey, idempotencyKey));
    return row;
  }

  async complete(
    tx: Tx,
    id: string,
    result: { outcome: 'created' | 'reenquiry'; leadId: string; contactId: string },
  ): Promise<void> {
    await tx.update(leadIngestions).set(result).where(eq(leadIngestions.id, id));
  }

  /** The contact's most recently created open lead, locked (re-enquiry target). */
  async lockLatestOpenLead(tx: Tx, contactId: string): Promise<LeadRow | undefined> {
    const [row] = await tx
      .select()
      .from(leads)
      .where(and(eq(leads.contactId, contactId), eq(leads.status, 'open'), isNull(leads.deletedAt)))
      .orderBy(desc(leads.createdAt), desc(leads.id))
      .limit(1)
      .for('update');
    return row;
  }

  async touchLead(tx: Tx, id: string, now: Date): Promise<void> {
    await tx.update(leads).set({ updatedAt: now }).where(eq(leads.id, id));
  }

  // ---- contact merge ----

  /** Every lead row of `from` (soft-deleted ones too) now belongs to `to`. Returns the live ids. */
  async moveLeads(tx: Tx, from: string, to: string): Promise<string[]> {
    const rows = await tx
      .update(leads)
      .set({ contactId: to, updatedAt: new Date() })
      .where(eq(leads.contactId, from))
      .returning({ id: leads.id, deletedAt: leads.deletedAt });
    return rows.filter((r) => r.deletedAt === null).map((r) => r.id);
  }

  async moveHistory(tx: Tx, from: string, to: string): Promise<void> {
    await tx
      .update(timelineEvents)
      .set({ contactId: to })
      .where(eq(timelineEvents.contactId, from));
    await tx
      .update(leadIngestions)
      .set({ contactId: to })
      .where(eq(leadIngestions.contactId, from));
  }
}
