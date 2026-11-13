import { emailSchema, industryTemplateKeySchema } from '@revops/shared';
import { z } from 'zod';
import { defineJob } from '../../platform/queue/job';

// Auth work that must not run on the request path (no account-state signal in body or timing).
// Payloads never carry secrets: signup sends the argon2 HASH, never the password; tokens are
// minted inside the job. They do carry emails, so completed jobs are deleted after an hour.

const requestMetaSchema = z.object({
  ip: z.string().max(64).nullable(),
  userAgent: z.string().max(512).nullable(),
});
const PII_RETENTION = { deleteAfterSeconds: 3600 };

export const SIGNUP_JOB = defineJob(
  'identity.signup',
  z.object({
    name: z.string().min(1).max(100),
    email: emailSchema,
    tenantName: z.string().min(1).max(100),
    /** Older queued jobs have none: generic. */
    industry: industryTemplateKeySchema.default('generic'),
    passwordHash: z.string().startsWith('$argon2id$').max(512),
    meta: requestMetaSchema,
  }),
  PII_RETENTION,
);
export type SignupJobData = z.infer<typeof SIGNUP_JOB.schema>;

const emailJobSchema = z.object({ email: emailSchema, meta: requestMetaSchema });
export type EmailJobData = z.infer<typeof emailJobSchema>;

export const RESEND_VERIFICATION_JOB = defineJob(
  'identity.resend-verification',
  emailJobSchema,
  PII_RETENTION,
);
export const FORGOT_PASSWORD_JOB = defineJob(
  'identity.forgot-password',
  emailJobSchema,
  PII_RETENTION,
);
