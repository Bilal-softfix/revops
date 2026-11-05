import { z } from 'zod';
import { roleSchema } from '../tenancy/enums.js';

// Auth API contracts (/v1/auth/*), shared by apps/api (validation) and apps/web (forms + types).

export const PASSWORD_MIN_LENGTH = 12;
/** argon2 cost is per byte; cap input so a huge password can't be used for CPU exhaustion. */
export const PASSWORD_MAX_LENGTH = 128;

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));
export const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);
const nameSchema = z.string().trim().min(1).max(100);
/** One-time tokens from emailed links: 32 random bytes, base64url. */
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'invalid token');

export const signupRequestSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
  tenantName: nameSchema,
});
export type SignupRequest = z.infer<typeof signupRequestSchema>;

export const loginRequestSchema = z.object({
  email: emailSchema,
  // Not passwordSchema: a too-short password is just a wrong password, not a validation error.
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

/**
 * Verification needs the account password too: whoever signed up must also own the inbox, so an
 * account pre-registered with someone else's email can't be activated by that person's click.
 */
export const verifyEmailRequestSchema = z.object({
  token: tokenSchema,
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});
export type VerifyEmailRequest = z.infer<typeof verifyEmailRequestSchema>;

/** "This wasn't me / start over": discards the unverified account the link belongs to. */
export const cancelSignupRequestSchema = z.object({ token: tokenSchema });
export type CancelSignupRequest = z.infer<typeof cancelSignupRequestSchema>;

export const emailOnlyRequestSchema = z.object({ email: emailSchema });
export type EmailOnlyRequest = z.infer<typeof emailOnlyRequestSchema>;

export const resetPasswordRequestSchema = z.object({
  token: tokenSchema,
  password: passwordSchema,
});
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;

export const authUserSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  name: z.string(),
  emailVerified: z.boolean(),
});
export type AuthUser = z.infer<typeof authUserSchema>;

export const authTenantSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  role: roleSchema,
});
export type AuthTenant = z.infer<typeof authTenantSchema>;

/**
 * Always the same 202 body, whatever the email's state (new, verified, pending, expired): the
 * outcome is only ever communicated by email, so signup can't be used to probe for accounts.
 */
export const signupResponseSchema = z.object({ status: z.literal('check_email') });
export type SignupResponse = z.infer<typeof signupResponseSchema>;

/** GET /v1/auth/me and POST /v1/auth/login. Send csrfToken as `x-csrf-token` on unsafe requests. */
export const sessionResponseSchema = z.object({
  user: authUserSchema,
  /** null if the user has no active membership. */
  tenant: authTenantSchema.nullable(),
  csrfToken: z.string(),
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

export const CSRF_HEADER = 'x-csrf-token';

/** `code` member of problem+json responses from /v1/auth. */
export const AUTH_ERROR_CODES = [
  'validation_failed',
  'invalid_credentials',
  'email_not_verified',
  'verification_failed',
  'invalid_token',
  'rate_limited',
  'unauthenticated',
  'csrf_invalid',
] as const;
export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];
