import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { WorkerEnv } from '@revops/shared/env';
import { API_ENV } from '../config/env';
import { safeErrorSummary } from '../platform/errors/safe-error';
import { Readiness } from '../platform/health/readiness';
import { METRICS_CONTENT_TYPE, Metrics, metricsAuthorized } from '../platform/metrics/metrics';

const PROBLEM = 'application/problem+json';

/**
 * The worker has no API, but the orchestrator and Prometheus still need GET /health, /ready and
 * /metrics. A bare node:http server on WORKER_PORT (0 = any free port, used by tests).
 */
@Injectable()
export class WorkerHttpServer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('WorkerHttp');
  private server: Server | undefined;

  constructor(
    @Inject(API_ENV) private readonly env: WorkerEnv,
    private readonly readiness: Readiness,
    private readonly metrics: Metrics,
  ) {}

  /** The bound port (after bootstrap). */
  get port(): number {
    return (this.server?.address() as AddressInfo | null)?.port ?? 0;
  }

  async onApplicationBootstrap(): Promise<void> {
    this.server = createServer((req, res) => {
      const path = (req.url ?? '').split('?')[0];
      const send = (status: number, type: string, body: string) => {
        res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' }).end(body);
      };
      const problem = (status: number, code: string, title: string, extra = {}) =>
        send(
          status,
          PROBLEM,
          JSON.stringify({ type: `/problems/${code}`, title, status, code, ...extra }),
        );

      if (req.method !== 'GET') return problem(405, 'method_not_allowed', 'Method not allowed');
      if (path === '/health') return send(200, 'application/json', '{"status":"ok"}');
      if (path === '/ready') {
        void this.readiness
          .check()
          .then((report) =>
            report.ready
              ? send(
                  200,
                  'application/json',
                  JSON.stringify({ status: 'ok', checks: report.checks }),
                )
              : problem(503, 'not_ready', 'Service not ready', { checks: report.checks }),
          );
        return;
      }
      if (path === '/metrics') {
        if (!metricsAuthorized(req.headers.authorization, this.env.METRICS_TOKEN)) {
          return problem(401, 'unauthenticated', 'Metrics token required');
        }
        void this.metrics.registry
          .metrics()
          .then((body) => send(200, METRICS_CONTENT_TYPE, body))
          .catch((error: unknown) => {
            this.logger.error(safeErrorSummary(error));
            problem(500, 'internal_error', 'Internal server error');
          });
        return;
      }
      return problem(404, 'not_found', 'Not found');
    });
    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject).listen(this.env.WORKER_PORT, resolve);
    });
    this.logger.log(`health/ready/metrics on :${this.port}`);
  }

  async onApplicationShutdown(): Promise<void> {
    await new Promise<void>((resolve) =>
      this.server ? this.server.close(() => resolve()) : resolve(),
    );
  }
}
