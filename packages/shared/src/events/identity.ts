import { z } from 'zod';

// Versioned outbox event payloads (see docs/01-architecture.md). Never put PII in payloads:
// consumers load what they need by id.

export const USER_SIGNED_UP_V1 = 'user.signed_up.v1';
export const userSignedUpV1Schema = z.object({
  userId: z.uuid(),
  tenantId: z.uuid(),
});
export type UserSignedUpV1 = z.infer<typeof userSignedUpV1Schema>;
