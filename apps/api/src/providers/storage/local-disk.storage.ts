import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { StorageProvider, assertStorageKey } from './storage-provider';

/** Dev storage: files under STORAGE_DIR (default `.data/storage`, git-ignored). */
export class LocalDiskStorage extends StorageProvider {
  private readonly root: string;

  constructor(root: string) {
    super();
    this.root = resolve(root);
  }

  private path(key: string): string {
    assertStorageKey(key);
    const full = resolve(join(this.root, ...key.split('/')));
    if (!full.startsWith(this.root + sep)) throw new Error('invalid storage key');
    return full;
  }

  async put(key: string, body: Buffer): Promise<void> {
    const target = this.path(key);
    await mkdir(dirname(target), { recursive: true });
    // Write then rename: a reader never sees a half-written file.
    const tmp = `${target}.${randomUUID()}.tmp`;
    await writeFile(tmp, body);
    await rename(tmp, target);
  }

  async get(key: string): Promise<Buffer | undefined> {
    try {
      return await readFile(this.path(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }
}
