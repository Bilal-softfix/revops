import { type Tx, auditLogs, outboxEvents } from '@revops/db';
import { ACTOR_TYPES, type EventDefinition } from '@revops/shared';
import { z } from 'zod';

// The ONE way modules write outbox events and audit rows (CLAUDE.md rule 4 + M1-T0). Both run
// inside the caller's tenant transaction, so they commit or roll back with the state change, and
// both validate first: a malformed row is a programming error that fails the request, never a
// row that later blocks the relay (which dead-letters anything that still slips through).

const uuid = z.uuid();

export interface RecordEventInput<T> {
  tenantId: string;
  /** The entity the event is about (lead, user…); null for tenant-wide events. */
  aggregateId: string | null;
  payload: T;
}

/** Writes an outbox event after validating its payload against the shared event registry. */
export async function recordEvent<T extends Record<string, unknown>>(
  tx: Tx,
  event: EventDefinition<T>,
  input: RecordEventInput<T>,
): Promise<void> {
  const payload = event.schema.parse(input.payload);
  await tx.insert(outboxEvents).values({
    tenantId: uuid.parse(input.tenantId),
    type: event.type,
    aggregateId: input.aggregateId === null ? null : uuid.parse(input.aggregateId),
    payload,
  });
}

/** `<entity>.<verb>` in snake_case, e.g. `member.role_changed`, `lead.stage_changed`. */
export const AUDIT_ACTION_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

const jsonObject = z.record(z.string(), z.unknown());

export const auditEntrySchema = z.object({
  tenantId: z.uuid(),
  actorType: z.enum(ACTOR_TYPES),
  /** The acting user for `user`; null for `system` / `ai`. */
  actorId: z.uuid().nullable(),
  action: z.string().regex(AUDIT_ACTION_PATTERN).max(100),
  entity: z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/)
    .max(50),
  entityId: z.string().min(1).max(200).nullable(),
  before: jsonObject.optional(),
  after: jsonObject.optional(),
  /** Client IP (stored as inet). */
  ip: z.string().max(64).nullable(),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;

/** Appends an audit row (append-only table) after validating it. */
export async function recordAudit(tx: Tx, entry: AuditEntry): Promise<void> {
  const parsed = auditEntrySchema.parse(entry);
  if (parsed.actorType === 'user' && parsed.actorId === null) {
    throw new Error(`audit ${parsed.action}: a user action needs actorId`);
  }
  await tx.insert(auditLogs).values(parsed);
}
