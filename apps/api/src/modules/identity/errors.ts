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
/** Verify-email: one answer for a bad/used/expired link, an expired account, or a wrong password. */
export const verificationFailed = () =>
  error('verification_failed', 400, 'This link or password is not valid', {
    detail: 'Check the password you signed up with, or sign up again to get a new link.',
  });
export const invalidToken = () =>
  error('invalid_token', 400, 'This link is invalid or has expired');
export const rateLimited = (retryAfterSec: number) =>
  error('rate_limited', 429, 'Too many attempts — try again later', {
    headers: { 'Retry-After': String(retryAfterSec) },
  });
export const unauthenticated = () => error('unauthenticated', 401, 'Sign in required');
export const csrfInvalid = () => error('csrf_invalid', 403, 'Missing or invalid CSRF token');
