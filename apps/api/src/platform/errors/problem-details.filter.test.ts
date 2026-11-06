import { NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { DomainError } from './domain-error';
import { toProblem } from './problem-details.filter';

describe('toProblem (RFC 7807)', () => {
  it('maps a DomainError with its code, extensions and headers', () => {
    const error = new DomainError('rate_limited', 429, 'Too many attempts', {
      detail: 'later',
      headers: { 'Retry-After': '60' },
      extensions: { limit: 5 },
    });
    expect(toProblem(error)).toEqual({
      problem: {
        type: '/problems/rate_limited',
        title: 'Too many attempts',
        status: 429,
        code: 'rate_limited',
        detail: 'later',
        limit: 5,
      },
      headers: { 'Retry-After': '60' },
    });
  });

  it('maps Nest HTTP exceptions by status', () => {
    expect(toProblem(new NotFoundException()).problem).toMatchObject({
      status: 404,
      code: 'not_found',
    });
  });

  it('hides unexpected errors behind a generic 500', () => {
    const { problem } = toProblem(new Error('connection string postgres://u:secret@h'));
    expect(problem).toEqual({
      type: '/problems/internal_error',
      title: 'Internal server error',
      status: 500,
      code: 'internal_error',
    });
  });
});
