import type { NextRequest } from 'next/server';
import { webEnv } from '@/lib/env';

// Same-origin proxy: browser → /api/v1/* → API_INTERNAL_URL/v1/*. The session cookie stays
// first-party (no CORS, SameSite=Lax works) and the API URL is read at runtime, not build time.
// Only /v1 is exposed: /metrics, /docs and the probes stay internal.

export const dynamic = 'force-dynamic';

/** Same limit as the API's JSON parser; enforced here so the web server never buffers more. */
export const MAX_BODY_BYTES = 100 * 1024;

/** Request headers the API needs; everything else (incl. hop-by-hop) is dropped. */
const FORWARD_REQUEST = [
  'accept',
  'content-type',
  'cookie',
  'user-agent',
  'x-csrf-token',
  'x-request-id',
  'x-forwarded-for',
];
/** Response headers never copied back (the runtime sets its own). */
const DROP_RESPONSE = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'keep-alive',
  'transfer-encoding',
  'set-cookie',
]);

function problem(status: number, code: string, title: string): Response {
  return Response.json(
    { type: `/problems/${code}`, title, status, code },
    { status, headers: { 'content-type': 'application/problem+json' } },
  );
}

/** The request body, or null once it exceeds MAX_BODY_BYTES (streamed: never fully buffered). */
async function readBody(req: NextRequest): Promise<Uint8Array<ArrayBuffer> | null> {
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = req.body?.getReader();
  if (!reader) return new Uint8Array(new ArrayBuffer(0));
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(new ArrayBuffer(size));
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function forward(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  if (path[0] !== 'v1' || path.some((p) => p === '..' || p === '.')) {
    return Response.json(
      { type: '/problems/not_found', title: 'Not found', status: 404, code: 'not_found' },
      { status: 404, headers: { 'content-type': 'application/problem+json' } },
    );
  }
  const target = new URL(
    `/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`,
    webEnv().API_INTERNAL_URL,
  );
  const headers = new Headers();
  for (const name of FORWARD_REQUEST) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const body = hasBody ? await readBody(req) : undefined;
  if (body === null) return problem(413, 'payload_too_large', 'Request body too large');

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      redirect: 'manual',
      cache: 'no-store',
      ...(body ? { body } : {}),
    });
  } catch {
    return Response.json(
      {
        type: '/problems/api_unavailable',
        title: 'The service is unavailable — try again shortly',
        status: 503,
        code: 'api_unavailable',
      },
      { status: 503, headers: { 'content-type': 'application/problem+json' } },
    );
  }

  const out = new Headers();
  upstream.headers.forEach((value, name) => {
    if (!DROP_RESPONSE.has(name.toLowerCase())) out.set(name, value);
  });
  for (const cookie of upstream.headers.getSetCookie()) out.append('set-cookie', cookie);
  return new Response(upstream.status === 204 ? null : upstream.body, {
    status: upstream.status,
    headers: out,
  });
}

export { forward as DELETE, forward as GET, forward as PATCH, forward as POST, forward as PUT };
