import type { INestApplication, NestApplicationOptions } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { bodyParserErrorHandler } from './platform/errors/body-parser-errors';

/**
 * Nest's default parsers include urlencoded, which would let a cross-site HTML form POST to our
 * endpoints (e.g. login CSRF). We turn them off and accept JSON only: a cross-origin JSON request
 * needs a CORS preflight, which we don't grant.
 */
export const APP_OPTIONS: NestApplicationOptions = { bodyParser: false };

/** HTTP setup shared by main.ts and the tests, so tests exercise the real middleware. */
export function configureApp(app: INestApplication): void {
  const express = app as NestExpressApplication;
  express.disable('x-powered-by');
  express.useBodyParser('json', { limit: '100kb' });
  express.use(bodyParserErrorHandler);
  express.use(cookieParser());
}
