import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET, MAX_BODY_BYTES, MAX_UPLOAD_BYTES, OPTIONS, POST, bodyLimit } from './route';

const ctx = (path: string[]) => ({ params: Promise.resolve({ path }) });

afterEach(() => vi.unstubAllGlobals());

describe('/api/[...path] proxy', () => {
  it('forwards /v1 calls to API_INTERNAL_URL with only the allow-listed headers', async () => {
    const upstream = vi.fn(() =>
      Promise.resolve(
        new Response('{"ok":true}', {
          status: 200,
          headers: { 'content-type': 'application/json', 'x-request-id': 'r-1' },
        }),
      ),
    );
    vi.stubGlobal('fetch', upstream);
    const req = new NextRequest('http://localhost:3000/api/v1/members?limit=5', {
      headers: {
        cookie: '__Host-sid=abc',
        'x-csrf-token': 't',
        authorization: 'Bearer leak',
        'x-forwarded-for': '203.0.113.7',
      },
    });
    const res = await GET(req, ctx(['v1', 'members']));
    const [target, init] = upstream.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(target)).toBe('http://localhost:4000/v1/members?limit=5');
    const sent = init.headers as Headers;
    expect(sent.get('cookie')).toBe('__Host-sid=abc');
    expect(sent.get('x-csrf-token')).toBe('t');
    expect(sent.get('x-forwarded-for')).toBe('203.0.113.7');
    expect(sent.get('authorization')).toBeNull();
    expect(res.status).toBe(200);
    expect(res.headers.get('x-request-id')).toBe('r-1');
  });

  it('public form posts (M2-T2): forwards Origin and returns the CORS answer; OPTIONS too', async () => {
    const upstream = vi.fn(() =>
      Promise.resolve(
        new Response('{"ok":true}', {
          status: 201,
          headers: {
            'content-type': 'application/json',
            'access-control-allow-origin': 'https://shop.example.com',
          },
        }),
      ),
    );
    vi.stubGlobal('fetch', upstream);
    const req = new NextRequest('http://localhost:3000/api/v1/public/forms/k', {
      method: 'POST',
      headers: {
        origin: 'https://shop.example.com',
        'content-type': 'text/plain',
        'x-revops-signature': 't=1,v1=abc',
        'x-webhook-token': 'whsec_x',
      },
      body: '{"fields":{}}',
    });
    const res = await POST(req, ctx(['v1', 'public', 'forms', 'k']));
    const [, init] = upstream.mock.calls[0] as unknown as [URL, RequestInit];
    expect((init.headers as Headers).get('origin')).toBe('https://shop.example.com');
    expect((init.headers as Headers).get('x-revops-signature')).toBe('t=1,v1=abc');
    expect((init.headers as Headers).get('x-webhook-token')).toBe('whsec_x');
    expect(res.headers.get('access-control-allow-origin')).toBe('https://shop.example.com');
    expect(typeof OPTIONS).toBe('function');
  });

  it('passes the body and every Set-Cookie back (login sets the session cookie)', async () => {
    const headers = new Headers({ 'content-type': 'application/json' });
    headers.append('set-cookie', '__Host-sid=new; Path=/; HttpOnly; Secure; SameSite=Lax');
    headers.append('set-cookie', 'other=1; Path=/');
    const upstream = vi.fn(() => Promise.resolve(new Response('{}', { status: 200, headers })));
    vi.stubGlobal('fetch', upstream);
    const req = new NextRequest('http://localhost:3000/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@b.co', password: 'x' }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req, ctx(['v1', 'auth', 'login']));
    const [, init] = upstream.mock.calls[0] as unknown as [URL, RequestInit];
    expect(new TextDecoder().decode(init.body as ArrayBuffer)).toContain('a@b.co');
    expect(res.headers.getSetCookie()).toHaveLength(2);
  });

  it.each([[['metrics']], [['docs', 'openapi.json']], [['v1', '..', 'metrics']]])(
    'refuses anything outside /v1 (%j) without calling the API',
    async (path) => {
      const upstream = vi.fn();
      vi.stubGlobal('fetch', upstream);
      const res = await GET(new NextRequest('http://localhost:3000/api/x'), ctx(path));
      expect(res.status).toBe(404);
      expect(upstream).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['a declared size over the limit', { 'content-length': String(MAX_BODY_BYTES + 1) }],
    ['an undeclared (chunked) body over the limit', {}],
  ])('rejects %s with 413 before calling the API', async (_label, headers) => {
    const upstream = vi.fn();
    vi.stubGlobal('fetch', upstream);
    const big = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 3; i++) controller.enqueue(new Uint8Array(MAX_BODY_BYTES / 2));
        controller.close();
      },
    });
    const req = new NextRequest('http://localhost:3000/api/v1/auth/login', {
      method: 'POST',
      body: big,
      headers,
      duplex: 'half',
    });
    const res = await POST(req, ctx(['v1', 'auth', 'login']));
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ code: 'payload_too_large' });
    expect(upstream).not.toHaveBeenCalled();
  });

  it('API down → 503 problem+json the client understands', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('ECONNREFUSED'))),
    );
    const res = await GET(
      new NextRequest('http://localhost:3000/api/v1/auth/me'),
      ctx(['v1', 'auth', 'me']),
    );
    expect(res.status).toBe(503);
    expect(res.headers.get('content-type')).toMatch(/problem\+json/);
    expect(await res.json()).toMatchObject({ code: 'api_unavailable' });
  });
});

describe('bodyLimit', () => {
  it('allows 10 MB only for CSV uploads', () => {
    const id = '00000000-0000-4000-8000-000000000000';
    expect(bodyLimit('POST', ['v1', 'lead-sources', id, 'imports'])).toBe(MAX_UPLOAD_BYTES);
    expect(bodyLimit('GET', ['v1', 'lead-sources', id, 'imports'])).toBe(MAX_BODY_BYTES);
    expect(bodyLimit('POST', ['v1', 'lead-sources', id, 'imports', 'x'])).toBe(MAX_BODY_BYTES);
    expect(bodyLimit('POST', ['v1', 'leads'])).toBe(MAX_BODY_BYTES);
    expect(bodyLimit('POST', ['v1', 'public', 'webhooks', 'k'])).toBe(MAX_BODY_BYTES);
  });
});
