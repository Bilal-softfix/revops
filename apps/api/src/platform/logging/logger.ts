import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { trace } from '@opentelemetry/api';
import type { Params } from 'nestjs-pino';
import type { LoggerOptions } from 'pino';
import { maskDeep, maskPii } from './mask';

export const REQUEST_ID_HEADER = 'x-request-id';
/** A client-supplied request id is kept only if it is short and harmless; otherwise a new uuid. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export function requestIdFor(req: IncomingMessage): string {
  const given = req.headers[REQUEST_ID_HEADER];
  return typeof given === 'string' && SAFE_REQUEST_ID.test(given) ? given : randomUUID();
}

/** Secrets that must never be logged, wherever they appear (CLAUDE.md rule 6). */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.csrfToken',
];

/**
 * Errors are logged without `message`: drizzle puts query params (emails, hashes) there. Name,
 * Postgres SQLSTATE/constraint and stack frames are enough to debug (see safe-error.ts).
 */
export function errorSerializer(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { type: typeof error };
  const out: Record<string, unknown> = { type: error.name };
  for (const source of [error, (error as { cause?: unknown }).cause]) {
    const pg = source as { code?: unknown; constraint_name?: unknown } | undefined;
    if (typeof pg?.code === 'string') out.code = pg.code;
    if (typeof pg?.constraint_name === 'string') out.constraint = pg.constraint_name;
  }
  out.stack = (error.stack ?? '')
    .split('\n')
    .filter((line) => line.trimStart().startsWith('at '))
    .join('\n');
  return out;
}

/** trace_id/span_id of the active OpenTelemetry span, so logs and traces can be joined. */
function traceFields(): Record<string, string> {
  const span = trace.getActiveSpan();
  if (!span) return {};
  const { traceId, spanId, traceFlags } = span.spanContext();
  return traceFlags & 1 ? { trace_id: traceId, span_id: spanId } : {};
}

/** Base pino options shared by the HTTP logger and the worker. */
export function baseLoggerOptions(level: string, service: string): LoggerOptions {
  return {
    level,
    base: { service },
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    serializers: { err: errorSerializer, error: errorSerializer },
    formatters: {
      // Every string in a logged object is PII-masked (emails, E.164 phones).
      log: (object) => maskDeep(object) as Record<string, unknown>,
    },
    hooks: {
      // …and so is the message itself.
      logMethod(args, method) {
        const masked = args.map((arg) => (typeof arg === 'string' ? maskPii(arg) : arg));
        return method.apply(this, masked as Parameters<typeof method>);
      },
    },
    mixin: traceFields,
  };
}

/** nestjs-pino params: request id on every request + every log line inside it, masked, redacted. */
export function httpLoggerParams(level: string, service: string, pretty: boolean): Params {
  return {
    pinoHttp: {
      ...baseLoggerOptions(level, service),
      ...(pretty ? { transport: { target: 'pino-pretty', options: { singleLine: true } } } : {}),
      genReqId: (req: IncomingMessage, res: ServerResponse) => {
        const id = requestIdFor(req);
        res.setHeader(REQUEST_ID_HEADER, id);
        return id;
      },
      customAttributeKeys: { reqId: 'requestId' },
      // Child log lines carry only the request id, not the whole request.
      quietReqLogger: true,
      serializers: {
        err: errorSerializer,
        // Path only: query strings are never logged (they could carry tokens).
        req: (req: { id?: unknown; method?: string; url?: string }) => ({
          id: req.id,
          method: req.method,
          path: (req.url ?? '').split('?')[0],
        }),
        res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
      },
      autoLogging: {
        ignore: (req: IncomingMessage) => /^\/(health|ready|metrics)(\?|$)/.test(req.url ?? ''),
      },
    },
  };
}
