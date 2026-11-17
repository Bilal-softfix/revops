import { z } from 'zod';

// CRM outbox event payloads (M1-T4). Ids only, never PII: consumers load what they need by id.

export const LEAD_CREATED_V1 = 'lead.created.v1';
export const leadCreatedV1Schema = z.object({
  tenantId: z.uuid(),
  leadId: z.uuid(),
  contactId: z.uuid(),
  pipelineId: z.uuid(),
  stageId: z.uuid(),
  ownerUserId: z.uuid().nullable(),
  actorUserId: z.uuid().nullable(),
});
export type LeadCreatedV1 = z.infer<typeof leadCreatedV1Schema>;

/** A lead moved to another stage (possibly of another pipeline) by a person or the system. */
export const LEAD_STAGE_CHANGED_V1 = 'lead.stage_changed.v1';
export const leadStageChangedV1Schema = z.object({
  tenantId: z.uuid(),
  leadId: z.uuid(),
  fromPipelineId: z.uuid(),
  fromStageId: z.uuid(),
  toPipelineId: z.uuid(),
  toStageId: z.uuid(),
  toStatus: z.enum(['open', 'won', 'lost']),
  actorUserId: z.uuid().nullable(),
});
export type LeadStageChangedV1 = z.infer<typeof leadStageChangedV1Schema>;

export const LEAD_ASSIGNED_V1 = 'lead.assigned.v1';
export const leadAssignedV1Schema = z.object({
  tenantId: z.uuid(),
  leadId: z.uuid(),
  fromUserId: z.uuid().nullable(),
  toUserId: z.uuid().nullable(),
  actorUserId: z.uuid().nullable(),
});
export type LeadAssignedV1 = z.infer<typeof leadAssignedV1Schema>;
