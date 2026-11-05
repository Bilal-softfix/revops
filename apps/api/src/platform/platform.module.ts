import { type DynamicModule, Global, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import type { ApiEnv } from '@revops/shared/env';
import { API_ENV } from '../config/env';
import { BackgroundTasks, InProcessBackgroundTasks } from './background-tasks';
import { Clock, SystemClock } from './clock';
import { Database } from './database/database';
import { ProblemDetailsFilter } from './errors/problem-details.filter';
import { InMemoryRateLimiter, RateLimiter } from './rate-limit/rate-limiter';

/** Cross-cutting providers available to every module: env, DB pool, clock, rate limiter, errors. */
@Global()
@Module({})
export class PlatformModule {
  static register(env: ApiEnv): DynamicModule {
    return {
      module: PlatformModule,
      providers: [
        { provide: API_ENV, useValue: env },
        { provide: Database, useFactory: () => new Database(env.DATABASE_URL) },
        { provide: Clock, useClass: SystemClock },
        { provide: BackgroundTasks, useClass: InProcessBackgroundTasks },
        { provide: RateLimiter, useClass: InMemoryRateLimiter },
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
      ],
      exports: [API_ENV, Database, Clock, RateLimiter, BackgroundTasks],
    };
  }
}
