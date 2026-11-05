import { describe, expect, it, vi } from 'vitest';
import type { Db } from './client.js';
import { InvalidTenantIdError, withTenant } from './with-tenant.js';

function fakeDb() {
  const execute = vi.fn().mockResolvedValue([]);
  const tx = { execute };
  const transaction = vi.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx));
  return { db: { transaction } as unknown as Db, transaction, execute };
}

describe('withTenant (unit)', () => {
  it.each(['', 'not-a-uuid', "1' or '1'='1", '00000000-0000-0000-0000-00000000000g'])(
    'rejects tenant id %j before opening a transaction',
    async (tenantId) => {
      const { db, transaction } = fakeDb();
      await expect(withTenant(db, tenantId, () => Promise.resolve())).rejects.toBeInstanceOf(
        InvalidTenantIdError,
      );
      expect(transaction).not.toHaveBeenCalled();
    },
  );

  it('sets the tenant transaction-locally (is_local = true) before running fn', async () => {
    const { db, execute } = fakeDb();
    const tenantId = '7f1c2e8a-3b4d-4c5e-9f60-718293a4b5c6';
    const result = await withTenant(db, tenantId, () => Promise.resolve('done'));

    expect(result).toBe('done');
    expect(execute).toHaveBeenCalledTimes(1);
    const query = execute.mock.calls[0]?.[0] as { queryChunks: unknown[] };
    const text = JSON.stringify(query.queryChunks);
    expect(text).toContain('select set_config(');
    expect(text).toContain(', true)');
    expect(query.queryChunks).toContain(tenantId);
  });
});
