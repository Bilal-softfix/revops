import { randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { and, createDb, eq, outboxEvents, processedEvents, tenants, withTenant } from '@revops/db';
import { loadTestDatabaseEnv } from '@revops/db/testing';
import { type OutboxEnvelope, USER_SIGNED_UP_V1 } from '@revops/shared';
import { parseEnv, workerEnvSchema } from '@revops/shared/env';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Metrics } from '../src/platform/metrics/metrics';
import { DemoEventLogConsumer } from '../src/platform/outbox/demo-event-log.consumer';
import { OutboxRelay } from '../src/platform/outbox/outbox-relay';
import { JobRunner } from '../src/platform/queue/job-runner';
import { PgBossClient } from '../src/platform/queue/pg-boss-client';
import { WorkerModule } from '../src/worker/worker.module';
import { asTestOwner } from './test-app';

// M0-T6 AC: an outbox event written in a transaction is delivered once even if the relay runs
// twice. Real pg-boss on the test database, as app_user (ADR-011).
const { appUrl } = loadTestDatabaseEnv();
const env = parseEnv(workerEnvSchema, {
  ...process.env,
  DATABASE_URL: appUrl,
  EMAIL_DRIVER: 'fake',
  LOG_LEVEL: 'fatal',
  WORKER_PORT: '0',
});
const QUEUE = DemoEventLogConsumer.NAME;
const app = createDb(appUrl, { max: 2 });

let moduleRef: TestingModule;
let relay: OutboxRelay;
let consumer: DemoEventLogConsumer;
let tenantId: string;

/** Applies (side effects) per event id, via a spy on the consumer's protected `apply`. */
let applied: ReturnType<typeof vi.fn<(eventId: string) => void>>;
const applySpy = () =>
  vi.spyOn(consumer as unknown as { apply: (event: OutboxEnvelope) => Promise<void> }, 'apply');

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [WorkerModule.register(env, { autoStart: false })],
  }).compile();
  await moduleRef.init();
  relay = moduleRef.get(OutboxRelay);
  consumer = moduleRef.get(DemoEventLogConsumer);
  tenantId = randomUUID();
  await withTenant(app.db, tenantId, (tx) =>
    tx.insert(tenants).values({ id: tenantId, name: 'Outbox Co', slug: `outbox-${tenantId}` }),
  );
}, 60_000);

afterAll(async () => {
  await moduleRef.close();
  await app.close();
});

beforeEach(async () => {
  await asTestOwner((sql) => sql`delete from pgboss.job where name = ${QUEUE}`);
  applied = vi.fn<(eventId: string) => void>();
  applySpy().mockImplementation((event) => {
    applied(event.eventId);
    return Promise.resolve();
  });
});

/** A state change + its event in ONE tenant transaction, as modules do (CLAUDE.md rule 4). */
async function writeEvent(type = USER_SIGNED_UP_V1): Promise<string> {
  const [row] = await withTenant(app.db, tenantId, (tx) =>
    tx
      .insert(outboxEvents)
      .values({ tenantId, type, payload: { userId: randomUUID(), tenantId } })
      .returning({ id: outboxEvents.id }),
  );
  return row?.id ?? '';
}

const jobsFor = (eventId: string) =>
  asTestOwner(
    (sql) =>
      sql<{ id: string; data: OutboxEnvelope }[]>`
        select id::text, data from pgboss.job where name = ${QUEUE} and id = ${eventId}`,
  );

const publishedAt = (eventId: string) =>
  asTestOwner(async (sql) => {
    const [row] = await sql<{ published_at: Date | null }[]>`
      select published_at from outbox_events where id = ${eventId}`;
    return row?.published_at ?? null;
  });

/** processed_events is FORCE RLS (binds the owner too): read it in the tenant's context. */
const processedCount = async (eventId: string) =>
  (
    await withTenant(app.db, tenantId, (tx) =>
      tx
        .select({ eventId: processedEvents.eventId })
        .from(processedEvents)
        .where(and(eq(processedEvents.consumer, QUEUE), eq(processedEvents.eventId, eventId))),
    )
  ).length;

describe('outbox relay → pg-boss → consumer', () => {
  it('relay twice in a row: one job (id = event id), event marked published once', async () => {
    const eventId = await writeEvent();
    expect(await relay.relayOnce()).toBeGreaterThanOrEqual(1);
    const firstPublish = await publishedAt(eventId);
    expect(firstPublish).not.toBeNull();
    expect(await relay.relayOnce()).toBe(0);
    expect(await publishedAt(eventId)).toEqual(firstPublish);

    const jobs = await jobsFor(eventId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.data).toMatchObject({
      eventId,
      tenantId,
      type: USER_SIGNED_UP_V1,
      aggregateId: null,
    });
  });

  it('relays running concurrently never publish the same event twice', async () => {
    const ids = await Promise.all(Array.from({ length: 20 }, () => writeEvent()));
    const counts = await Promise.all(Array.from({ length: 4 }, () => relay.relayOnce()));
    expect(counts.reduce((a, b) => a + b, 0)).toBe(ids.length);
    for (const id of ids) expect(await jobsFor(id)).toHaveLength(1);
  });

  it('a re-sent job for the same event is a no-op (pg-boss dedupes on the event id)', async () => {
    const eventId = await writeEvent();
    await relay.relayOnce();
    const [job] = await jobsFor(eventId);
    const queue = moduleRef.get(PgBossClient);
    const boss = await queue.ready(consumer.job);
    expect(await boss.send(QUEUE, job?.data ?? {}, { id: eventId })).toBeNull();
    expect(await jobsFor(eventId)).toHaveLength(1);
  });

  it('events with no subscriber are marked published without any job', async () => {
    const eventId = await writeEvent('nobody.listens.v1');
    await relay.relayOnce();
    expect(await publishedAt(eventId)).not.toBeNull();
    expect(await jobsFor(eventId)).toHaveLength(0);
  });

  it('an event whose transaction rolled back is never relayed', async () => {
    const eventId = randomUUID();
    await expect(
      withTenant(app.db, tenantId, async (tx) => {
        await tx
          .insert(outboxEvents)
          .values({ id: eventId, tenantId, type: USER_SIGNED_UP_V1, payload: {} });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    await relay.relayOnce();
    expect(await jobsFor(eventId)).toHaveLength(0);
  });
});

describe('consumer idempotency (processOnce)', () => {
  it('duplicate deliveries — sequential and concurrent — apply the side effect once', async () => {
    const eventId = await writeEvent();
    await relay.relayOnce();
    const [job] = await jobsFor(eventId);
    const envelope = job?.data as OutboxEnvelope;
    const ctx = { jobId: eventId, attempt: 0 };

    await consumer.handle(envelope, ctx);
    await consumer.handle(envelope, { ...ctx, attempt: 1 });
    await Promise.all(Array.from({ length: 5 }, () => consumer.handle(envelope, ctx)));

    expect(applied.mock.calls.filter(([id]) => id === eventId)).toHaveLength(1);
    expect(await processedCount(eventId)).toBe(1);
  });

  it('a failing side effect rolls back the processed marker, so a retry applies it', async () => {
    const eventId = await writeEvent();
    await relay.relayOnce();
    const envelope = (await jobsFor(eventId))[0]?.data as OutboxEnvelope;
    applySpy().mockRejectedValueOnce(new Error('downstream down'));
    await expect(consumer.handle(envelope, { jobId: eventId, attempt: 0 })).rejects.toThrow();
    expect(await processedCount(eventId)).toBe(0);
    await consumer.handle(envelope, { jobId: eventId, attempt: 1 });
    expect(await processedCount(eventId)).toBe(1);
  });
});

describe('consumer: events whose tenant was deleted', () => {
  it('are skipped (not failed and retried) once the tenant is gone', async () => {
    const goneTenant = randomUUID();
    await withTenant(app.db, goneTenant, (tx) =>
      tx.insert(tenants).values({ id: goneTenant, name: 'Gone', slug: `gone-${goneTenant}` }),
    );
    const envelope: OutboxEnvelope = {
      eventId: randomUUID(),
      tenantId: goneTenant,
      type: USER_SIGNED_UP_V1,
      aggregateId: null,
      payload: {},
      occurredAt: new Date().toISOString(),
    };
    // app_user can't delete tenants; the owner can, in that tenant's context (FORCE RLS).
    await asTestOwner((sql) =>
      sql.begin(async (tx) => {
        await tx`select set_config('app.tenant_id', ${goneTenant}, true)`;
        await tx`delete from tenants where id = ${goneTenant}`;
      }),
    );
    await expect(
      consumer.handle(envelope, { jobId: envelope.eventId, attempt: 0 }),
    ).resolves.toBeUndefined();
    expect(applied).not.toHaveBeenCalled();
  });
});

describe('end to end with the real job runner (AC)', () => {
  it('event written in a tx, relay run twice → the worker applies it exactly once', async () => {
    const runner = new JobRunner(
      moduleRef.get(PgBossClient),
      { all: () => [consumer], get: () => consumer } as never,
      moduleRef.get(Metrics),
    );
    await runner.onApplicationBootstrap();

    const eventId = await writeEvent();
    await Promise.all([relay.relayOnce(), relay.relayOnce()]);
    await relay.relayOnce();

    await vi.waitFor(async () => expect(await processedCount(eventId)).toBe(1), {
      timeout: 15_000,
      interval: 200,
    });
    // Give any (wrong) second delivery time to show up.
    await new Promise((resolve) => setTimeout(resolve, 2500));
    expect(applied.mock.calls.filter(([id]) => id === eventId)).toHaveLength(1);
    expect(await processedCount(eventId)).toBe(1);
    const [state] = await asTestOwner(
      (sql) => sql<{ state: string }[]>`
        select state::text from pgboss.job where name = ${QUEUE} and id = ${eventId}`,
    );
    expect(state?.state).toBe('completed');
  }, 30_000);
});
