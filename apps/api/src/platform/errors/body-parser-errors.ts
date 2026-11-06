import type { NextFunction, Request, Response } from 'express';
import { DomainError } from './domain-error';
import { toProblem } from './problem-details.filter';

/**
 * Body-parser failures happen in Express middleware, before Nest's exception filters run; without
 * this they'd get Express's default (HTML, with a stack trace outside production). Map the known
 * ones to problem+json and pass anything else on.
 */
export function bodyParserErrorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  const type = (error as { type?: unknown }).type;
  const mapped =
    type === 'entity.parse.failed'
      ? new DomainError('malformed_json', 400, 'Request body is not valid JSON')
      : type === 'entity.too.large'
        ? new DomainError('payload_too_large', 413, 'Request body is too large')
        : undefined;
  if (!mapped || res.headersSent) {
    next(error);
    return;
  }
  const { problem } = toProblem(mapped);
  res.status(problem.status).type('application/problem+json').json(problem);
}
