import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Metrics } from '../metrics/metrics';
import { JobHandler, defineJob } from './job';
import type { JobHandlers } from './job-handlers';
import { JobRunner } from './job-runner';
import type { PgBossClient } from './pg-boss-client';

class Failing extends JobHandler<{ id: string }> {
  readonly job = defineJob('test.failing', z.object({ id: z.string() }));
  handle(): Promise<void> {
    const error = Object.assign(
      new Error('Failed query: insert … params: asha@example.com,Asha Realty'),
      { code: '23505' },
    );
    return Promise.reject(error);
  }
}

describe('JobRunner.run', () => {
  it('rethrows a sanitized error: pg-boss persists it in pgboss.job.output (no PII)', async () => {
    const metrics = new Metrics('test', { defaultMetrics: false });
    const runner = new JobRunner({} as PgBossClient, {} as JobHandlers, metrics);
    const error = await runner
      .run(new Failing(), { id: 'j1', data: { id: 'x' }, retryCount: 0 })
      .catch((e: unknown) => e as Error);
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toBe('test.failing failed: Error code=23505');
    expect(error?.message).not.toContain('asha');
    expect(await metrics.registry.metrics()).toMatch(
      /jobs_processed_total\{queue="test.failing",outcome="failed",service="test"\} 1/,
    );
  });

  it('rejects an invalid payload before the handler runs', async () => {
    const runner = new JobRunner(
      {} as PgBossClient,
      {} as JobHandlers,
      new Metrics('test', { defaultMetrics: false }),
    );
    await expect(
      runner.run(new Failing(), { id: 'j2', data: { nope: 1 }, retryCount: 0 }),
    ).rejects.toThrow(/test.failing failed/);
  });
});
