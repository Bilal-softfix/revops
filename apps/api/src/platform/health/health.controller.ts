import { Controller, Get, HttpCode } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { DomainError } from '../errors/domain-error';
import { Readiness, type ReadinessReport } from './readiness';

/** Probes for the orchestrator; not part of the public API (excluded from OpenAPI). */
@ApiExcludeController()
@Controller()
export class HealthController {
  constructor(private readonly readiness: Readiness) {}

  /** Liveness: the process is up. Checks nothing, so a DB outage never restarts the pod. */
  @Get('health')
  @HttpCode(200)
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Readiness: DB + queue usable; 503 problem+json (with the failing checks) otherwise. */
  @Get('ready')
  @HttpCode(200)
  async ready(): Promise<{ status: 'ok'; checks: ReadinessReport['checks'] }> {
    const report = await this.readiness.check();
    if (!report.ready) {
      throw new DomainError('not_ready', 503, 'Service not ready', {
        extensions: { checks: report.checks },
      });
    }
    return { status: 'ok', checks: report.checks };
  }
}
