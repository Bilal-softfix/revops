import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { DomainError } from './domain-error';

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  [extension: string]: unknown;
}

const HTTP_CODES: Record<number, string> = {
  400: 'bad_request',
  401: 'unauthenticated',
  403: 'forbidden',
  404: 'not_found',
  405: 'method_not_allowed',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
};

export function toProblem(error: unknown): {
  problem: ProblemDetails;
  headers: Record<string, string>;
} {
  if (error instanceof DomainError) {
    return {
      problem: {
        type: `/problems/${error.code}`,
        title: error.title,
        status: error.status,
        code: error.code,
        ...(error.options.detail ? { detail: error.options.detail } : {}),
        ...error.options.extensions,
      },
      headers: error.options.headers ?? {},
    };
  }
  if (error instanceof HttpException) {
    const status = error.getStatus();
    const code = HTTP_CODES[status] ?? (status >= 500 ? 'internal_error' : 'http_error');
    return {
      problem: { type: `/problems/${code}`, title: error.message, status, code },
      headers: {},
    };
  }
  return {
    problem: {
      type: '/problems/internal_error',
      title: 'Internal server error',
      status: 500,
      code: 'internal_error',
    },
    headers: {},
  };
}

/** Every error leaves as application/problem+json (RFC 7807). Request ids + pino arrive in M0-T6. */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ProblemDetails');

  catch(error: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const { problem, headers } = toProblem(error);
    if (problem.status >= 500) {
      // Message + stack only: never log request bodies (passwords, tokens).
      this.logger.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    }
    res.status(problem.status).set(headers).type('application/problem+json').json(problem);
  }
}
