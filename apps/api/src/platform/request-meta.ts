import type { Request } from 'express';

/** Who/where a request came from, for rate limits and audit logs. */
export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

export function requestMeta(req: Request): RequestMeta {
  return {
    ip: req.ip ?? null,
    userAgent: req.header('user-agent')?.slice(0, 512) ?? null,
  };
}
