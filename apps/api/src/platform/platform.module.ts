import {
  type DynamicModule,
  Global,
  Injectable,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { APP_FILTER, DiscoveryModule } from '@nestjs/core';
import type { ApiEnv } from '@revops/shared/env';
import { LoggerModule } from 'nestjs-pino';
import { API_ENV } from '../config/env';
import { Clock, SystemClock } from './clock';
import { Database } from './database/database';
import { ProblemDetailsFilter } from './errors/problem-details.filter';
import { Readiness } from './health/readiness';
import { httpLoggerParams } from './logging/logger';
import { Metrics } from './metrics/metrics';
import { JobHandlers } from './queue/job-handlers';
import { JobQueue } from './queue/job-queue';
import { PgBossClient } from './queue/pg-boss-client';
import { PgBossJobQueue } from './queue/pg-boss-job-queue';
import { PostgresRateLimiter, RateLimiter } from './rate-limit/rate-limiter';
import { RateLimitPurgeJob } from './rate-limit/rate-limit-purge.job';
import { shutdownTracing } from './tracing/tracing';

export type ProcessRole = 'api' | 'worker';

@Injectable()
class TracingShutdown implements OnApplicationShutdown {
  onApplicationShutdown(): Promise<void> {
    return shutdownTracing();
  }
}

/**
 * Cross-cutting providers for both processes: env, DB pool, clock, rate limiter, problem+json,
 * pino logging, metrics, the job queue (pg-boss) and readiness.
 */
@Global()
@Module({})
export class PlatformModule {
  static register(env: ApiEnv, role: ProcessRole = 'api'): DynamicModule {
    const service = `revops-${role}`;
    return {
      module: PlatformModule,
      imports: [
        DiscoveryModule,
        LoggerModule.forRoot(
          httpLoggerParams(env.LOG_LEVEL, service, env.NODE_ENV === 'development'),
        ),
      ],
      providers: [
        { provide: API_ENV, useValue: env },
        { provide: Database, useFactory: () => new Database(env.DATABASE_URL) },
        { provide: Clock, useClass: SystemClock },
        { provide: RateLimiter, useClass: PostgresRateLimiter },
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
        {
          provide: Metrics,
          useFactory: () => new Metrics(service, { defaultMetrics: env.NODE_ENV !== 'test' }),
        },
        {
          provide: PgBossClient,
          useFactory: () => new PgBossClient({ url: env.DATABASE_URL, role }),
        },
        { provide: JobQueue, useClass: PgBossJobQueue },
        JobHandlers,
        Readiness,
        RateLimitPurgeJob,
        TracingShutdown,
      ],
      exports: [
        API_ENV,
        Database,
        Clock,
        RateLimiter,
        Metrics,
        PgBossClient,
        JobQueue,
        JobHandlers,
        Readiness,
      ],
    };
  }
}
