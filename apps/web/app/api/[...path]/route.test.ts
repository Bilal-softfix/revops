import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from './route';

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
