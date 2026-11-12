import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { InMemoryJobQueue } from './in-memory-job-queue';
import { JobHandler, defineJob } from './job';

const PING = defineJob('test.ping', z.object({ n: z.number().int() }));

class PingHandler extends JobHandler<{ n: number }> {
  readonly job = PING;
  readonly seen: number[] = [];
  handle(data: { n: number }): Promise<void> {
    this.seen.push(data.n);
    return Promise.resolve();
  }
}

describe('defineJob', () => {
  it('requires module.action names and fills default settings', () => {
    expect(() => defineJob('Ping', z.object({}))).toThrow(/invalid job name/);
    expect(PING.settings).toMatchObject({ retryLimit: 3, deleteAfterSeconds: 86_400 });
  });
});

describe('InMemoryJobQueue', () => {
  it('validates payloads on send', async () => {
    const queue = new InMemoryJobQueue();
    await expect(queue.send(PING, { n: 1.5 })).rejects.toThrow();
  });

  it('dedupes by job id per queue and drains in order through the handler', async () => {
    const queue = new InMemoryJobQueue();
    const id = crypto.randomUUID();
    expect(await queue.send(PING, { n: 1 }, { id })).toBe(id);
    expect(await queue.send(PING, { n: 2 }, { id })).toBeNull();
    await queue.send(PING, { n: 3 });
    const handler = new PingHandler();
    const lookup = vi.fn(() => handler);
    await queue.drain(lookup);
    expect(handler.seen).toEqual([1, 3]);
    expect(lookup).toHaveBeenCalledWith('test.ping');
  });
});
