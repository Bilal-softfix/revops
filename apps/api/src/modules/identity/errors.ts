import type { AuthErrorCode } from '@revops/shared';
import { DomainError } from '../../platform/errors/domain-error';

const error = (
  code: AuthErrorCode,
  status: number,
  title: string,
  options?: ConstructorParameters<typeof DomainError>[3],
) => new DomainError(code, status, title, options);

// One generic message for unknown email and wrong password (no account enumeration on login).
export const invalidCredentials = () =>
  error('invalid_credentials', 401, 'Invalid email or password');
export const emailNotVerified = () =>
  error('email_not_verified', 403, 'Verify your email before signing in', {
    detail: 'Use the link we emailed you, or request a new one.',
  });
export const emailTaken = () =>
  error('email_taken', 409, 'An account with this email already exists');
export const invalidToken = () =>
  error('invalid_token', 400, 'This link is invalid or has expired');
export const rateLimited = (retryAfterSec: number) =>
  error('rate_limited', 429, 'Too many attempts — try again later', {
    headers: { 'Retry-After': String(retryAfterSec) },
  });
export const unauthenticated = () => error('unauthenticated', 401, 'Sign in required');
export const csrfInvalid = () => error('csrf_invalid', 403, 'Missing or invalid CSRF token');
