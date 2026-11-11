import { CSRF_HEADER, sessionResponseSchema } from '@revops/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './client';
import { errorMessage, errorReference } from './messages';
import { ApiError, NetworkError } from './problem';

const problem = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/problem+json', ...headers },
  });

function mockFetch(response: Response | Error) {
  const fn = vi.fn(() =>
    response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe('api client', () => {
  it('calls the same-origin /api proxy with JSON and the CSRF header on unsafe methods', async () => {
    const fetchMock = mockFetch(new Response(null, { status: 204 }));
    await api('/v1/auth/logout', { method: 'POST', body: {}, csrfToken: 'csrf-1' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/auth/logout');
    expect(init.credentials).toBe('same-origin');
    expect(init.headers).toMatchObject({
      'content-type': 'application/json',
      [CSRF_HEADER]: 'csrf-1',
    });
  });

  it('never sends the CSRF token on GET', async () => {
    const fetchMock = mockFetch(new Response('{}', { status: 200 }));
    await api('/v1/tenants', { csrfToken: 'csrf-1' });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).not.toHaveProperty(CSRF_HEADER);
  });

  it('validates the response body with the shared schema', async () => {
    mockFetch(new Response(JSON.stringify({ user: { id: 'nope' } }), { status: 200 }));
    await expect(api('/v1/auth/me', { schema: sessionResponseSchema })).rejects.toThrow();
  });

  it('maps problem+json to ApiError with code, field errors, request id and Retry-After', async () => {
    mockFetch(
      problem(
        400,
        {
          type: '/problems/validation_failed',
          title: 'Invalid request',
          status: 400,
          code: 'validation_failed',
          requestId: 'req-42',
          errors: [{ path: 'email', message: 'Invalid email' }],
        },
        { 'retry-after': '120' },
      ),
    );
    const error = await api('/v1/auth/signup', { method: 'POST', body: {} }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 400,
      code: 'validation_failed',
      requestId: 'req-42',
      fieldErrors: { email: 'Invalid email' },
      retryAfter: 120,
    });
  });

  it('a non-JSON error body still becomes an ApiError', async () => {
    mockFetch(new Response('<html>Bad gateway</html>', { status: 502 }));
    const error = await api('/v1/members').catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 502, code: 'internal_error' });
  });

  it('a failed fetch is a NetworkError', async () => {
    mockFetch(new TypeError('fetch failed'));
    await expect(api('/v1/members')).rejects.toBeInstanceOf(NetworkError);
  });
});

describe('error messages', () => {
  it('known codes get friendly copy; rate limits mention the wait', () => {
    expect(errorMessage(new ApiError(401, { code: 'invalid_credentials' }))).toBe(
      'Incorrect email or password.',
    );
    expect(errorMessage(new ApiError(429, { code: 'rate_limited' }, 300))).toMatch(/about 5 min/);
  });

  it('5xx never shows the server title; unknown 4xx shows the API title', () => {
    expect(errorMessage(new ApiError(500, { title: 'pg: duplicate key …' }))).toBe(
      'Something went wrong.',
    );
    expect(errorMessage(new ApiError(409, { code: 'brand_new', title: 'Conflict here' }))).toBe(
      'Conflict here',
    );
  });

  it('network and unknown errors', () => {
    expect(errorMessage(new NetworkError())).toMatch(/Can’t reach RevOps/);
    expect(errorMessage(new Error('boom'))).toBe('Something went wrong.');
    expect(errorReference(new ApiError(500, { requestId: 'r-1' }))).toBe('r-1');
    expect(errorReference(new Error('x'))).toBeUndefined();
  });
});
