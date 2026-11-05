import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';

/**
 * Work that must not run on the request path, so a response can't reveal (by content or timing)
 * what that work found — e.g. whether an email has an account. In-process for now; M0-T6 moves
 * these onto BullMQ jobs (durable, retried).
 */
export abstract class BackgroundTasks {
  abstract run(name: string, task: () => Promise<void>): void;
}

/** Runs tasks right away, off the request; failures are logged; waits for in-flight on shutdown. */
@Injectable()
export class InProcessBackgroundTasks extends BackgroundTasks implements OnApplicationShutdown {
  private readonly logger = new Logger('BackgroundTasks');
  private readonly inFlight = new Set<Promise<void>>();

  run(name: string, task: () => Promise<void>): void {
    const promise = Promise.resolve()
      .then(task)
      .catch((error: unknown) => {
        this.logger.error(
          `${name} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      })
      .finally(() => this.inFlight.delete(promise));
    this.inFlight.add(promise);
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([...this.inFlight]);
  }
}

/** Tests: tasks wait in a queue until `drain()`, so a test can inspect state before they run. */
export class QueuedBackgroundTasks extends BackgroundTasks {
  readonly queue: { name: string; task: () => Promise<void> }[] = [];

  run(name: string, task: () => Promise<void>): void {
    this.queue.push({ name, task });
  }

  /** Runs everything queued, including tasks queued by those tasks. Rethrows the first failure. */
  async drain(): Promise<void> {
    for (let next = this.queue.shift(); next; next = this.queue.shift()) await next.task();
  }
}
