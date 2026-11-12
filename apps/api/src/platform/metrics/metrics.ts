import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/**
 * Prometheus metrics for one process (`revops-api` or `revops-worker`). Its own Registry, not
 * prom-client's global one, so tests can build several apps in one process.
 */
export class Metrics {
  readonly registry = new Registry();

  readonly httpDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration by method, route template and status code',
    labelNames: ['method', 'route', 'status_code'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [this.registry],
  });

  readonly jobsProcessed = new Counter({
    name: 'jobs_processed_total',
    help: 'Job attempts by queue and outcome (completed | failed)',
    labelNames: ['queue', 'outcome'] as const,
    registers: [this.registry],
  });

  readonly jobDuration = new Histogram({
    name: 'job_duration_seconds',
    help: 'Job attempt duration by queue',
    labelNames: ['queue'] as const,
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 5, 15, 60, 300],
    registers: [this.registry],
  });

  readonly outboxPublished = new Counter({
    name: 'outbox_events_published_total',
    help: 'Outbox events handed to consumer queues by the relay',
    registers: [this.registry],
  });

  readonly outboxRelayErrors = new Counter({
    name: 'outbox_relay_errors_total',
    help: 'Failed outbox relay passes (retried on the next tick)',
    registers: [this.registry],
  });

  constructor(service: string, options: { defaultMetrics?: boolean } = {}) {
    this.registry.setDefaultLabels({ service });
    if (options.defaultMetrics ?? true) collectDefaultMetrics({ register: this.registry });
  }

  /** Express middleware: times every request, labelled by route TEMPLATE (never raw ids). */
  httpMiddleware() {
    return (req: Request, res: Response, next: NextFunction): void => {
      const end = this.httpDuration.startTimer();
      res.on('finish', () => {
        const path = (req.route as { path?: unknown } | undefined)?.path;
        const route = typeof path === 'string' ? `${req.baseUrl}${path}` : 'unmatched';
        end({ method: req.method, route, status_code: String(res.statusCode) });
      });
      next();
    };
  }
}

export const METRICS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

/**
 * /metrics access: open when no METRICS_TOKEN is configured (dev; production requires one),
 * otherwise `Authorization: Bearer <token>`, compared in constant time.
 */
export function metricsAuthorized(header: string | undefined, token: string | undefined): boolean {
  if (!token) return true;
  const given = /^Bearer (.+)$/.exec(header ?? '')?.[1];
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
