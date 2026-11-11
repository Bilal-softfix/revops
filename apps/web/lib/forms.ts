import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { errorMessage } from '@/lib/api/messages';
import { ApiError } from '@/lib/api/problem';

/**
 * Maps an API error onto a react-hook-form form: `validation_failed` field errors go to their
 * fields; anything else becomes the returned form-level message.
 */
export function applyApiError<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[],
): string | null {
  if (error instanceof ApiError && error.code === 'validation_failed') {
    let matched = false;
    for (const [path, message] of Object.entries(error.fieldErrors)) {
      if ((fields as readonly string[]).includes(path)) {
        setError(path as Path<T>, { message });
        matched = true;
      }
    }
    if (matched) return null;
  }
  return errorMessage(error);
}
