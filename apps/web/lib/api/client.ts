import { CSRF_HEADER } from '@revops/shared';
import type { z } from 'zod';
import { NetworkError, toApiError } from './problem';

export interface ApiRequest<S extends z.ZodType | undefined> {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Response schema from @revops/shared; omit for 2xx-without-body endpoints. */
  schema?: S;
  /** CSRF token from the session; sent on unsafe methods. */
  csrfToken?: string | undefined;
  signal?: AbortSignal;
}

type Result<S> = S extends z.ZodType ? z.infer<S> : undefined;

/**
 * Browser → same-origin `/api/*` (proxied to the API by app/api/[...path]/route.ts, so the
 * session cookie is first-party). Throws ApiError (problem+json) or NetworkError; validates the
 * response body with the shared schema, so the UI never trusts an unexpected shape.
 */
export async function api<S extends z.ZodType | undefined = undefined>(
  path: string,
  request: ApiRequest<S> = {},
): Promise<Result<S>> {
  const method = request.method ?? 'GET';
  const headers: Record<string, string> = { accept: 'application/json' };
  if (request.body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET' && request.csrfToken) headers[CSRF_HEADER] = request.csrfToken;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
      ...(request.body !== undefined ? { body: JSON.stringify(request.body) } : {}),
      ...(request.signal ? { signal: request.signal } : {}),
    });
  } catch (error) {
    if ((error as { name?: string }).name === 'AbortError') throw error;
    throw new NetworkError();
  }
  if (!res.ok) throw await toApiError(res);
  if (!request.schema || res.status === 204) return undefined as Result<S>;
  return request.schema.parse(await res.json()) as Result<S>;
}
