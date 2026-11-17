import { randomUUID } from 'node:crypto';
import { auditLogs, createDb, eq, outboxEvents, tenants, withTenant } from '@revops/db';
import { loadTestDatabaseEnv } from '@revops/db/testing';
import { USER_SIGNED_UP } from '@revops/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AuditEntry, recordAudit, recordEvent } from '../src/platform/outbox/record';

// M1-T0: the single, validated writer for outbox events and audit rows.
const app = createDb(loadTestDatabaseEnv().appUrl, { max: 1 });
const tenantId = randomUUID();
const userId = randomUUID();

beforeAll(() =>
  withTenant(app.db, tenantId, (tx) =>
    tx.insert(tenants).values({ id: tenantId, name: 'Rec', slug: `rec-${tenantId}` }),
  ),
);
afterAll(() => app.close());

const inTenant = <T>(fn: Parameters<typeof withTenant<T>>[2]) => withTenant(app.db, tenantId, fn);

describe('recordEvent', () => {
  it('writes a registered event with its validated payload, in the caller’s transaction', async () => {
    await inTenant((tx) =>
      recordEvent(tx, USER_SIGNED_UP, {
        tenantId,
        aggregateId: userId,
        payload: { userId, tenantId },
      }),
    );
    const rows = await inTenant((tx) =>
      tx.select().from(outboxEvents).where(eq(outboxEvents.aggregateId, userId)),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: 'user.signed_up.v1', payload: { userId, tenantId } });
  });

  it('rejects a payload that fails the event schema — nothing is written', async () => {
    const aggregateId = randomUUID();
    await expect(
      inTenant((tx) =>
        recordEvent(tx, USER_SIGNED_UP, {
          tenantId,
          aggregateId,
          payload: { userId: 'not-a-uuid', tenantId },
        }),
      ),
    ).rejects.toThrow();
    const rows = await inTenant((tx) =>
      tx.select().from(outboxEvents).where(eq(outboxEvents.aggregateId, aggregateId)),
    );
    expect(rows).toHaveLength(0);
  });

  it('rolls back with the business write when the transaction fails', async () => {
    const aggregateId = randomUUID();
    await expect(
      inTenant(async (tx) => {
        await recordEvent(tx, USER_SIGNED_UP, {
          tenantId,
          aggregateId,
          payload: { userId: aggregateId, tenantId },
        });
        throw new Error('business rule failed');
      }),
    ).rejects.toThrow('business rule failed');
    const rows = await inTenant((tx) =>
      tx.select().from(outboxEvents).where(eq(outboxEvents.aggregateId, aggregateId)),
    );
    expect(rows).toHaveLength(0);
  });
});

describe('recordAudit', () => {
  const valid: AuditEntry = {
    tenantId,
    actorType: 'user',
    actorId: userId,
    action: 'member.role_changed',
    entity: 'membership',
    entityId: randomUUID(),
    before: { role: 'agent' },
    after: { role: 'manager' },
    ip: '203.0.113.5',
  };

  it('appends a validated row', async () => {
    await inTenant((tx) => recordAudit(tx, valid));
    const rows = await inTenant((tx) =>
      tx
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.entityId, valid.entityId ?? '')),
    );
    expect(rows[0]).toMatchObject({ action: 'member.role_changed', after: { role: 'manager' } });
  });

  it.each([
    ['an action without an entity prefix', { action: 'changed' }],
    ['a camelCase action', { action: 'member.roleChanged' }],
    ['a non-uuid actor', { actorId: 'someone' }],
    ['a user action without an actor', { actorId: null }],
    ['an unknown actor type', { actorType: 'robot' }],
  ])('rejects %s', async (_label, patch) => {
    await expect(
      inTenant((tx) => recordAudit(tx, { ...valid, ...(patch as Partial<AuditEntry>) })),
    ).rejects.toThrow();
  });

  it('system actions need no actor', async () => {
    await expect(
      inTenant((tx) =>
        recordAudit(tx, { ...valid, actorType: 'system', actorId: null, entityId: randomUUID() }),
      ),
    ).resolves.toBeUndefined();
  });
});
