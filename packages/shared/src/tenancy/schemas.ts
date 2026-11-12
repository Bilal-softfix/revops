import { z } from 'zod';
import { emailSchema, passwordSchema } from '../auth/schemas.js';
import { roleSchema } from './enums.js';

// Tenancy API contracts: /v1/members, /v1/invitations, /v1/tenants, /v1/session/tenant.

/** Cursor pagination (CLAUDE.md): `?limit=&cursor=`; the response carries `nextCursor`. */
export const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  /** Opaque to clients; today the last row's id. Validated so a bad cursor is a 400, not a 500. */
  cursor: z.uuid().optional(),
});
export type PageQuery = z.infer<typeof pageQuerySchema>;

export const memberStatusSchema = z.enum(['active', 'disabled']);

export const memberSchema = z.object({
  userId: z.uuid(),
  name: z.string(),
  email: z.string(),
  role: roleSchema,
  status: memberStatusSchema,
  joinedAt: z.iso.datetime(),
});
export type Member = z.infer<typeof memberSchema>;

export const memberPageSchema = z.object({
  items: z.array(memberSchema),
  nextCursor: z.string().nullable(),
});
export type MemberPage = z.infer<typeof memberPageSchema>;

export const updateMemberRequestSchema = z
  .object({ role: roleSchema.optional(), status: memberStatusSchema.optional() })
  .refine((body) => body.role !== undefined || body.status !== undefined, {
    message: 'give a role and/or a status',
  });
export type UpdateMemberRequest = z.infer<typeof updateMemberRequestSchema>;

export const inviteRequestSchema = z.object({ email: emailSchema, role: roleSchema });
export type InviteRequest = z.infer<typeof inviteRequestSchema>;

export const invitationSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  role: roleSchema,
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
});
export type Invitation = z.infer<typeof invitationSchema>;

/** `<tenantId>.<43 random base64url chars>`: the tenant part lets accept look it up under RLS. */
export const invitationTokenSchema = z
  .string()
  .regex(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/, 'invalid invitation token');

/**
 * Accept an invitation. New users send name + password (the link proves the email, so the account
 * is created verified). Existing users must be signed in as the invited email and send just the token.
 */
export const acceptInvitationRequestSchema = z.object({
  token: invitationTokenSchema,
  name: z.string().trim().min(1).max(100).optional(),
  password: passwordSchema.optional(),
});
export type AcceptInvitationRequest = z.infer<typeof acceptInvitationRequestSchema>;

export const myTenantSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  role: roleSchema,
});
export const myTenantsResponseSchema = z.object({ items: z.array(myTenantSchema) });
export type MyTenantsResponse = z.infer<typeof myTenantsResponseSchema>;

export const switchTenantRequestSchema = z.object({ tenantId: z.uuid() });
export type SwitchTenantRequest = z.infer<typeof switchTenantRequestSchema>;

export const TENANCY_ERROR_CODES = [
  'forbidden',
  'no_active_tenant',
  'not_found',
  'last_owner',
  'cannot_change_self',
  'already_member',
  'invitation_exists',
  'invalid_invitation',
  'invitation_login_required',
  'invitation_email_mismatch',
  'invitation_details_required',
] as const;
export type TenancyErrorCode = (typeof TENANCY_ERROR_CODES)[number];
