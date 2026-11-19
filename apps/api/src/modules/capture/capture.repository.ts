import { Injectable } from '@nestjs/common';
import { type Tx, and, desc, eq, inboundWebhooks, leadSources, sql } from '@revops/db';
import { Database } from '../../platform/database/database';

export interface ResolvedSource {
  tenantId: string;
  sourceId: string;
  name: string;
  type: string;
  config: unknown;
}

export interface WebhookSource {
  tenantId: string;
  sourceId: string;
  name: string;
  config: unknown;
  secretEnc: string;
}

/** Context-free lookups for the public capture endpoints (SECURITY DEFINER, migration 0033). */
@Injectable()
export class CaptureRepository {
  constructor(private readonly database: Database) {}

  /** A live, active source of an active tenant by its public key; undefined otherwise. */
  async resolveSource(publicKey: string): Promise<ResolvedSource | undefined> {
    const [row] = await this.database.db.execute<{
      tenant_id: string;
      source_id: string;
      name: string;
      type: string;
      config: unknown;
    }>(sql`select * from capture_resolve_source(${publicKey})`);
    return row
      ? {
          tenantId: row.tenant_id,
          sourceId: row.source_id,
          name: row.name,
          type: row.type,
          config: row.config,
        }
      : undefined;
  }

  /** An active API source with its encrypted webhook secret, by public key (definer, 0036). */
  async resolveWebhookSource(publicKey: string): Promise<WebhookSource | undefined> {
    const [row] = await this.database.db.execute<{
      tenant_id: string;
      source_id: string;
      name: string;
      config: unknown;
      webhook_secret_enc: string;
    }>(sql`select * from capture_resolve_webhook_source(${publicKey})`);
    return row
      ? {
          tenantId: row.tenant_id,
          sourceId: row.source_id,
          name: row.name,
          config: row.config,
          secretEnc: row.webhook_secret_enc,
        }
      : undefined;
  }

  /**
   * Stores a delivery. A valid delivery whose (source, external id) was already received hits the
   * partial unique index and is not stored again: returns undefined.
   */
  async insertWebhook(
    tx: Tx,
    values: typeof inboundWebhooks.$inferInsert,
  ): Promise<{ id: string } | undefined> {
    const [row] = await tx
      .insert(inboundWebhooks)
      .values(values)
      .onConflictDoNothing()
      .returning({ id: inboundWebhooks.id });
    return row;
  }

  /** A received (not yet processed) delivery, locked for processing. */
  async lockReceivedWebhook(tx: Tx, id: string) {
    const [row] = await tx
      .select()
      .from(inboundWebhooks)
      .where(and(eq(inboundWebhooks.id, id), eq(inboundWebhooks.status, 'received')))
      .for('update');
    return row;
  }

  async finishWebhook(
    tx: Tx,
    id: string,
    result: { status: 'processed' | 'failed'; error?: string; leadId?: string; at: Date },
  ): Promise<void> {
    await tx
      .update(inboundWebhooks)
      .set({
        status: result.status,
        error: result.error ?? null,
        leadId: result.leadId ?? null,
        processedAt: result.at,
      })
      .where(eq(inboundWebhooks.id, id));
  }

  /** The source's current name and config (tenant transaction), even if since paused. */
  async sourceForProcessing(tx: Tx, id: string) {
    const [row] = await tx
      .select({ id: leadSources.id, name: leadSources.name, config: leadSources.config })
      .from(leadSources)
      .where(eq(leadSources.id, id));
    return row;
  }

  /** A source's most recent rejected deliveries (tenant transaction; index 0037). */
  listRejectedWebhooks(tx: Tx, sourceId: string, limit: number) {
    return tx
      .select({
        id: inboundWebhooks.id,
        receivedAt: inboundWebhooks.receivedAt,
        error: inboundWebhooks.error,
        payload: inboundWebhooks.payload,
      })
      .from(inboundWebhooks)
      .where(and(eq(inboundWebhooks.sourceId, sourceId), eq(inboundWebhooks.status, 'rejected')))
      .orderBy(desc(inboundWebhooks.receivedAt), desc(inboundWebhooks.id))
      .limit(limit);
  }

  /**
   * Retention purge across tenants (definer, 0037): everything received before `before`, and
   * rejected deliveries received before `rejectedBefore`. Returns how many rows were deleted.
   */
  async purgeWebhooks(before: Date, rejectedBefore: Date): Promise<number> {
    const [row] = await this.database.db.execute<{ n: number }>(
      sql`select capture_purge_inbound_webhooks(${before.toISOString()}::timestamptz, ${rejectedBefore.toISOString()}::timestamptz) as n`,
    );
    return row?.n ?? 0;
  }
}
