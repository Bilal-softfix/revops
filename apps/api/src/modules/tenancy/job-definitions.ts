import { z } from 'zod';
import { defineJob } from '../../platform/queue/job';

/** Emails an invitation link. Ids only: the job mints the token itself (never stored in a job). */
export const INVITATION_EMAIL_JOB = defineJob(
  'tenancy.invitation-email',
  z.object({ tenantId: z.uuid(), invitationId: z.uuid(), actorUserId: z.uuid() }),
);
export type InvitationEmailJobData = z.infer<typeof INVITATION_EMAIL_JOB.schema>;
