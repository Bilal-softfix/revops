import { common, errorMessages } from '@/lib/strings/common';
import { ApiError, NetworkError } from './problem';

/** A user-facing sentence for any thrown error (never raw stack traces or SQL). */
export function errorMessage(error: unknown): string {
  if (error instanceof NetworkError) return common.network;
  if (error instanceof ApiError) {
    const known = errorMessages[error.code];
    if (known) {
      return error.code === 'rate_limited' && error.retryAfter
        ? `${known} (about ${Math.ceil(error.retryAfter / 60)} min)`
        : known;
    }
    return error.status >= 500 ? common.unexpected : error.message;
  }
  return common.unexpected;
}

/** The support reference for an error, when the API gave one. */
export function errorReference(error: unknown): string | undefined {
  return error instanceof ApiError ? error.requestId : undefined;
}
