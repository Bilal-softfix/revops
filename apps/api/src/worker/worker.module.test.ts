import { Test, type TestingModule } from '@nestjs/testing';
import { MEMBER_JOINED_V1, USER_SIGNED_UP_V1 } from '@revops/shared';
import { parseEnv, workerEnvSchema } from '@revops/shared/env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OutboxRelay } from '../platform/outbox/outbox-relay';
import { JobHandlers } from '../platform/queue/job-handlers';
import { WorkerModule } from './worker.module';

// No database: pools and pg-boss connect lazily, and autoStart:false starts nothing.
const env = parseEnv(workerEnvSchema, {
  DATABASE_URL: 'postgresql://app_user:unused@127.0.0.1:1/revops_dev',
  EMAIL_DRIVER: 'fake',
  LOG_LEVEL: 'fatal',
});

describe('WorkerModule', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [WorkerModule.register(env, { autoStart: false })],
    }).compile();
    await moduleRef.init();
  }, 30_000);

  afterAll(() => moduleRef.close());

  it('discovers every job handler, each with its own queue', () => {
    const names = moduleRef
      .get(JobHandlers)
      .all()
      .map((h) => h.job.name)
      .sort();
    expect(names).toEqual([
      'identity.forgot-password',
      'identity.purge-expired-unverified',
      'identity.resend-verification',
      'identity.signup',
      'platform.demo-event-log',
      'platform.rate-limit-purge',
      'tenancy.invitation-email',
    ]);
  });

  it('schedules the two purges as cron jobs', () => {
    const crons = Object.fromEntries(
      moduleRef
        .get(JobHandlers)
        .all()
        .filter((h) => h.cron)
        .map((h) => [h.job.name, h.cron]),
    );
    expect(crons).toEqual({
      'identity.purge-expired-unverified': '15 * * * *',
      'platform.rate-limit-purge': '*/10 * * * *',
    });
  });

  it('routes outbox events to the subscribed consumers', () => {
    const subs = moduleRef.get(OutboxRelay).subscriptions();
    for (const type of [USER_SIGNED_UP_V1, MEMBER_JOINED_V1]) {
      expect(subs.get(type)?.map((c) => c.job.name)).toEqual(['platform.demo-event-log']);
    }
  });
});
