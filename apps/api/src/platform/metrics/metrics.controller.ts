import { Controller, Get, Header, Headers, Inject } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { ApiEnv } from '@revops/shared/env';
import { API_ENV } from '../../config/env';
import { DomainError } from '../errors/domain-error';
import { METRICS_CONTENT_TYPE, Metrics, metricsAuthorized } from './metrics';

/** Prometheus scrape endpoint (Bearer METRICS_TOKEN when configured). */
@ApiExcludeController()
@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly metrics: Metrics,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  @Get()
  @Header('Content-Type', METRICS_CONTENT_TYPE)
  @Header('Cache-Control', 'no-store')
  scrape(@Headers('authorization') authorization: string | undefined): Promise<string> {
    if (!metricsAuthorized(authorization, this.env.METRICS_TOKEN)) {
      throw new DomainError('unauthenticated', 401, 'Metrics token required', {
        headers: { 'WWW-Authenticate': 'Bearer' },
      });
    }
    return this.metrics.registry.metrics();
  }
}
