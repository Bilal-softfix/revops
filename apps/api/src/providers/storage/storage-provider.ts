/**
 * Object storage (M2-T5; CLAUDE.md stack): LocalDiskStorage in dev, InMemoryStorage in tests,
 * S3 (ap-south-1) in M8. Keys are opaque paths we generate (`imports/<tenant>/<id>.csv`), never
 * user input.
 */
export abstract class StorageProvider {
  abstract put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** The object's bytes, or undefined when it doesn't exist. */
  abstract get(key: string): Promise<Buffer | undefined>;
  /** Deleting a missing object is not an error. */
  abstract delete(key: string): Promise<void>;
}

/** Keys: lower-case path segments of [a-z0-9._-], no `..`, no leading slash. */
const KEY = /^(?:[a-z0-9_-][a-z0-9._-]*\/)*[a-z0-9_-][a-z0-9._-]*$/;

export function assertStorageKey(key: string): void {
  if (!KEY.test(key) || key.split('/').some((part) => part === '..' || part === '.')) {
    throw new Error('invalid storage key');
  }
}
