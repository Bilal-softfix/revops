import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryStorage } from './in-memory.storage';
import { LocalDiskStorage } from './local-disk.storage';
import type { StorageProvider } from './storage-provider';

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'revops-storage-'));
});
afterAll(() => rm(dir, { recursive: true, force: true }));

describe.each([
  ['LocalDiskStorage', () => new LocalDiskStorage(dir)],
  ['InMemoryStorage', () => new InMemoryStorage()],
] as [string, () => StorageProvider][])('%s', (_name, make) => {
  it('put → get → delete; missing objects are undefined; delete is idempotent', async () => {
    const storage = make();
    await storage.put('imports/t1/a.csv', Buffer.from('x,y'), 'text/csv');
    expect((await storage.get('imports/t1/a.csv'))?.toString()).toBe('x,y');
    await storage.put('imports/t1/a.csv', Buffer.from('z'), 'text/csv');
    expect((await storage.get('imports/t1/a.csv'))?.toString()).toBe('z');
    await storage.delete('imports/t1/a.csv');
    await storage.delete('imports/t1/a.csv');
    expect(await storage.get('imports/t1/a.csv')).toBeUndefined();
  });

  it.each(['../etc/passwd', '/abs', 'a/../../b', 'A/Upper', 'a//b', 'a/./b', ''])(
    'rejects key %j',
    async (key) => {
      await expect(make().put(key, Buffer.from(''), 'text/plain')).rejects.toThrow(
        'invalid storage key',
      );
    },
  );
});
