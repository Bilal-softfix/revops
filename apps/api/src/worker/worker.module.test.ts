import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkerHeartbeat, WorkerModule } from './worker.module';

describe('WorkerModule', () => {
  afterEach(() => vi.restoreAllMocks());

  it('starts the heartbeat on bootstrap and clears it on shutdown', async () => {
    const setSpy = vi.spyOn(globalThis, 'setInterval');
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    const moduleRef = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    moduleRef.useLogger(false);

    await moduleRef.init();
    expect(moduleRef.get(WorkerHeartbeat)).toBeInstanceOf(WorkerHeartbeat);
    expect(setSpy).toHaveBeenCalledTimes(1);
    const timer = setSpy.mock.results[0]?.value as NodeJS.Timeout;

    await moduleRef.close();
    expect(clearSpy).toHaveBeenCalledWith(timer);
  });
});
