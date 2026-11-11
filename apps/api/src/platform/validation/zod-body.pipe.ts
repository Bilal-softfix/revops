import type { PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { DomainError } from '../errors/domain-error';

/**
 * Validates a request body with a schema from @revops/shared. Errors list paths + messages only —
 * never the submitted values (passwords, tokens).
 */
export class ZodBodyPipe<S extends z.ZodType> implements PipeTransform<unknown, z.infer<S>> {
  constructor(readonly schema: S) {}

  transform(value: unknown): z.infer<S> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    throw new DomainError('validation_failed', 400, 'Invalid request', {
      extensions: {
        errors: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    });
  }
}
