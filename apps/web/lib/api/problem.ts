import { z } from 'zod';

/** RFC 7807 problem+json as the API sends it (see apps/api problem-details.filter). */
export const problemSchema = z.looseObject({
  type: z.string().optional(),
  title: z.string().optional(),
  status: z.number().optional(),
  code: z.string().optional(),
  detail: z.string().optional(),
  requestId: z.string().optional(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
export type Problem = z.infer<typeof problemSchema>;

/** A failed API call. `code` is the stable member to switch on (e.g. `invalid_credentials`). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | undefined;
  /** Field-level validation errors (`validation_failed`), by dotted path. */
  readonly fieldErrors: Record<string, string>;
  /** Seconds to wait, from Retry-After (429). */
  readonly retryAfter: number | undefined;
  /** The whole problem body, for code-specific extensions (e.g. `conflict` on contact_exists). */
  readonly problem: Problem;

  constructor(status: number, problem: Problem, retryAfter?: number) {
    super(problem.title ?? `Request failed (${status})`);
    this.name = 'ApiError';
    this.status = status;
    this.code = problem.code ?? (status >= 500 ? 'internal_error' : 'http_error');
    this.requestId = problem.requestId;
    this.fieldErrors = Object.fromEntries((problem.errors ?? []).map((e) => [e.path, e.message]));
    this.retryAfter = retryAfter;
    this.problem = problem;
  }
}

/** Network failure / API unreachable (no HTTP response at all). */
export class NetworkError extends Error {
  constructor() {
    super('Network error');
    this.name = 'NetworkError';
  }
}

/** Builds an ApiError from a non-2xx response, tolerating non-JSON bodies. */
export async function toApiError(res: Response): Promise<ApiError> {
  let problem: Problem = {};
  try {
    const parsed = problemSchema.safeParse(await res.json());
    if (parsed.success) problem = parsed.data;
  } catch {
    // not JSON (e.g. a proxy error page)
  }
  const retry = Number(res.headers.get('retry-after'));
  return new ApiError(res.status, problem, Number.isFinite(retry) && retry > 0 ? retry : undefined);
}
