import { Injectable } from '@nestjs/common';
import { sql } from '@revops/db';
import { Database } from '../../platform/database/database';

export interface ResolvedSource {
  tenantId: string;
  sourceId: string;
  name: string;
  type: string;
  config: unknown;
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
}
