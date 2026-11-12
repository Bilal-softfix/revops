import type { JobDefinition, JobHandler, SendOptions } from './job';
import { JobQueue } from './job-queue';

export interface QueuedJob {
  id: string;
  name: string;
  data: unknown;
}

/**
 * Test fake for JobQueue: jobs wait in memory until `drain()` runs them through their handlers,
 * so a test can inspect state in between. Same validation and id-dedupe as pg-boss; NOT
 * transactional — a job sent with `tx` stays queued even if that transaction rolls back.
 */
export class InMemoryJobQueue extends JobQueue {
  readonly jobs: QueuedJob[] = [];
  private readonly seen = new Set<string>();

  // eslint-disable-next-line @typescript-eslint/require-await -- async so a bad payload rejects, like pg-boss
  async send<T>(job: JobDefinition<T>, data: T, options: SendOptions = {}): Promise<string | null> {
    const parsed = job.schema.parse(data);
    const id = options.id ?? crypto.randomUUID();
    const key = `${job.name}:${id}`;
    if (this.seen.has(key)) return null;
    this.seen.add(key);
    this.jobs.push({ id, name: job.name, data: parsed });
    return id;
  }

  /** Runs every queued job, including jobs queued by those jobs. Rethrows the first failure. */
  async drain(handlerFor: (name: string) => JobHandler): Promise<void> {
    for (let next = this.jobs.shift(); next; next = this.jobs.shift()) {
      const handler = handlerFor(next.name);
      await handler.handle(handler.job.schema.parse(next.data), { jobId: next.id, attempt: 0 });
    }
  }
}
