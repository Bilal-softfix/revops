import { type DynamicModule, Module } from '@nestjs/common';
import type { WorkerEnv } from '@revops/shared/env';
import { IdentityModule } from '../modules/identity';
import { TenancyModule } from '../modules/tenancy';
import { DemoEventLogConsumer } from '../platform/outbox/demo-event-log.consumer';
import { OUTBOX_RELAY_OPTIONS, OutboxRelay } from '../platform/outbox/outbox-relay';
import { PlatformModule } from '../platform/platform.module';
import { JobRunner } from '../platform/queue/job-runner';
import { EmailModule } from '../providers/email';
import { WorkerHttpServer } from './worker-http-server';

export interface WorkerOptions {
  /** false in tests: they drive the relay and the jobs themselves. */
  autoStart?: boolean;
}

/**
 * The worker process: the same domain modules as the API (their JobHandlers), plus the job
 * runner, the outbox relay, outbox consumers and a small health/metrics HTTP server. No REST API.
 */
@Module({})
export class WorkerModule {
  static register(env: WorkerEnv, options: WorkerOptions = {}): DynamicModule {
    const autoStart = options.autoStart ?? true;
    return {
      module: WorkerModule,
      imports: [
        PlatformModule.register(env, 'worker'),
        EmailModule.register(env.EMAIL_DRIVER),
        IdentityModule,
        TenancyModule,
      ],
      providers: [
        {
          provide: OUTBOX_RELAY_OPTIONS,
          useValue: { pollIntervalMs: env.OUTBOX_POLL_INTERVAL_MS, batchSize: 100, autoStart },
        },
        OutboxRelay,
        DemoEventLogConsumer,
        ...(autoStart ? [JobRunner, WorkerHttpServer] : []),
      ],
    };
  }
}
