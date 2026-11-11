import type { INestApplication, NestApplicationOptions } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { ApiEnv } from '@revops/shared/env';
import cookieParser from 'cookie-parser';
import { API_ENV } from './config/env';
import { bodyParserErrorHandler } from './platform/errors/body-parser-errors';
import { Metrics } from './platform/metrics/metrics';
import { setupOpenApi } from './platform/openapi/openapi';

/**
 * Nest's default parsers include urlencoded, which would let a cross-site HTML form POST to our
 * endpoints (e.g. login CSRF). We turn them off and accept JSON only: a cross-origin JSON request
 * needs a CORS preflight, which we don't grant. Logs are buffered until pino takes over.
 */
export const APP_OPTIONS: NestApplicationOptions = { bodyParser: false, bufferLogs: true };

/** HTTP setup shared by main.ts and the tests, so tests exercise the real middleware. */
/** TRUST_PROXY → Express `trust proxy` (see the env schema). */
export function trustProxySetting(value: string): boolean | number | string {
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}

export function configureApp(app: INestApplication): void {
  const express = app as NestExpressApplication;
  const env = app.get<ApiEnv>(API_ENV);
  express.disable('x-powered-by');
  // Client IP for rate limits and audit logs, from X-Forwarded-For set by trusted hops only.
  express.set('trust proxy', trustProxySetting(env.TRUST_PROXY));
  express.use(app.get(Metrics).httpMiddleware());
  express.useBodyParser('json', { limit: '100kb' });
  express.use(bodyParserErrorHandler);
  express.use(cookieParser());
  setupOpenApi(app, env.NODE_ENV);
}
