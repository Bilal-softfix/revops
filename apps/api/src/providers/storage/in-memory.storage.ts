import { StorageProvider, assertStorageKey } from './storage-provider';

/** Runs `fn` so that a thrown error becomes a rejection, like a real (async) store. */
const settle = <T>(fn: () => T): Promise<T> => Promise.resolve().then(fn);

/** Fake storage for tests (STORAGE_DRIVER=memory): lives as long as the process. */
export class InMemoryStorage extends StorageProvider {
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();

  put(key: string, body: Buffer, contentType: string): Promise<void> {
    return settle(() => {
      assertStorageKey(key);
      this.objects.set(key, { body: Buffer.from(body), contentType });
    });
  }

  get(key: string): Promise<Buffer | undefined> {
    return settle(() => {
      assertStorageKey(key);
      const object = this.objects.get(key);
      return object ? Buffer.from(object.body) : undefined;
    });
  }

  delete(key: string): Promise<void> {
    return settle(() => {
      assertStorageKey(key);
      this.objects.delete(key);
    });
  }
}
