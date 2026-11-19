import type { Request } from 'express';
import { DomainError } from '../errors/domain-error';

const tooLarge = (limit: number) =>
  new DomainError('payload_too_large', 413, `The file is larger than ${limit / 1024 / 1024} MB`);

/**
 * An over-limit body is drained (read and dropped, never buffered) up to this multiple of the
 * limit so the 413 reaches a normal client; beyond it the connection is cut.
 */
const DRAIN_FACTOR = 2;

/**
 * Reads a raw request body of one content type, up to `limit` bytes (M2-T5 CSV upload). Called
 * from the controller — after the session and permission guards — so unauthenticated requests
 * never get a 10 MB buffer. No global parser handles these types, so the stream is unread here.
 */
export function readRawBody(req: Request, contentType: string, limit: number): Promise<Buffer> {
  const type = (req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
  if (type !== contentType) {
    return Promise.reject(
      new DomainError('unsupported_media_type', 415, `Send the file as ${contentType}`),
    );
  }
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > limit * DRAIN_FACTOR) {
    req.destroy();
    return Promise.reject(tooLarge(limit));
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit * DRAIN_FACTOR) {
        req.destroy();
        fail(tooLarge(limit));
        return;
      }
      if (size <= limit) chunks.push(chunk);
    });
    req.on('error', fail);
    req.on('end', () => {
      if (size > limit) {
        fail(tooLarge(limit));
        return;
      }
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
  });
}
