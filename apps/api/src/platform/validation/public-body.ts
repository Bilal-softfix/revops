import type { NextFunction, Request, Response } from 'express';

/** Public capture payloads are small: a contact form is a few hundred bytes. */
export const PUBLIC_BODY_LIMIT = 16 * 1024;
/** Webhook deliveries (M2-T3) may carry more fields from the sender's system. */
export const WEBHOOK_BODY_LIMIT = 64 * 1024;

/** The exact bytes received, kept for signature checks (M2-T3). */
export type RequestWithRawBody = Request & { rawBody?: Buffer; _body?: boolean };

const parseError = (type: 'entity.parse.failed' | 'entity.too.large') =>
  Object.assign(new Error(type), { type });

/**
 * Body reader for the unauthenticated `/v1/public/*` routes (M2-T2), mounted before the global
 * JSON parser: 16 kB cap, and JSON sent either as `application/json` or as `text/plain` (the
 * embed snippet uses text/plain so browsers send it without a CORS preflight). Other content
 * types (urlencoded, multipart) are left unread and fail validation. Errors reuse the body-parser
 * error types, so `bodyParserErrorHandler` answers 400/413 problem+json. `lenientJson` (webhooks):
 * a body that isn't JSON leaves `req.body` undefined instead of failing; `req.rawBody` always has
 * the exact bytes.
 */
export const publicBodyReader = (limit: number, options: { lenientJson?: boolean } = {}) =>
  function readPublicBody(req: RequestWithRawBody, _res: Response, next: NextFunction): void {
    if (req._body) {
      next();
      return;
    }
    const type = (req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
    if (req.method !== 'POST' || (type !== 'application/json' && type !== 'text/plain')) {
      next();
      return;
    }
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > limit) {
      next(parseError('entity.too.large'));
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let failed = false;
    req.on('data', (chunk: Buffer) => {
      if (failed) return;
      size += chunk.length;
      if (size > limit) {
        failed = true;
        next(parseError('entity.too.large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', (error) => {
      if (failed) return;
      failed = true;
      next(error);
    });
    req.on('end', () => {
      if (failed) return;
      const bytes = Buffer.concat(chunks);
      req.rawBody = bytes;
      const raw = bytes.toString('utf8');
      try {
        req.body = raw.length === 0 ? {} : (JSON.parse(raw) as unknown);
      } catch {
        // Webhooks keep the raw bytes so even unreadable deliveries are stored (rule 5).
        if (!options.lenientJson) {
          next(parseError('entity.parse.failed'));
          return;
        }
        req.body = undefined;
      }
      // body-parser skips requests it sees as already parsed.
      req._body = true;
      next();
    });
  };
