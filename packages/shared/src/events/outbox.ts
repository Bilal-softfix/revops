import { z } from 'zod';

/** `<aggregate>.<past-tense verb>.v<N>`, e.g. `user.signed_up.v1`. */
export const EVENT_TYPE_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+\.v[1-9][0-9]*$/;

/**
 * What a consumer job receives for one outbox event (ADR-011): the outbox row, with `eventId` as
 * the dedupe key (CLAUDE.md rule 4). `payload` is the event-specific body; each consumer parses it
 * with that event's schema (e.g. userSignedUpV1Schema). Payloads never carry PII — ids only.
 */
export const outboxEnvelopeSchema = z.object({
  eventId: z.uuid(),
  tenantId: z.uuid(),
  type: z.string().regex(EVENT_TYPE_PATTERN),
  aggregateId: z.uuid().nullable(),
  payload: z.record(z.string(), z.unknown()),
  occurredAt: z.iso.datetime({ offset: true }),
});
export type OutboxEnvelope = z.infer<typeof outboxEnvelopeSchema>;
