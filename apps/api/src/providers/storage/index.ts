import { type DynamicModule, Global, Module } from '@nestjs/common';
import type { ApiEnv } from '@revops/shared/env';
import { InMemoryStorage } from './in-memory.storage';
import { LocalDiskStorage } from './local-disk.storage';
import { StorageProvider } from './storage-provider';

export { InMemoryStorage } from './in-memory.storage';
export { LocalDiskStorage } from './local-disk.storage';
export { StorageProvider, assertStorageKey } from './storage-provider';

@Global()
@Module({})
export class StorageModule {
  static register(env: Pick<ApiEnv, 'STORAGE_DRIVER' | 'STORAGE_DIR'>): DynamicModule {
    const provider =
      env.STORAGE_DRIVER === 'memory'
        ? { provide: StorageProvider, useValue: new InMemoryStorage() }
        : { provide: StorageProvider, useFactory: () => new LocalDiskStorage(env.STORAGE_DIR) };
    return { module: StorageModule, providers: [provider], exports: [StorageProvider] };
  }
}
