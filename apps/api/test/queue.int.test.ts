import { randomBytes, randomUUID } from 'node:crypto';
import { createDb, sql } from '@revops/db';
import { loadTestDatabaseEnv } from '@revops/db/testing';
import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Database } from '../src/platform/database/database';
import { Readiness } from '../src/platform/health/readiness';
import { defineJob } from '../src/platform/queue/job';
import { PgBossClient } from '../src/platform/queue/pg-boss-client';
import { PgBossJobQueue } from '../src/platform/queue/pg-boss-job-queue';
import { asTestOwner } from './test-app';

// PgBossJobQueue against the migrated pgboss schema, connected as app_user (no DDL rights).
const { appUrl } = loadTestDatabaseEnv();
const client = new PgBossClient({ url: appUrl, role: 'api' });
const queue = new PgBossJobQueue(client);
const app = createDb(appUrl, { max: 1 });
const JOB = defineJob(`test.q-${randomBytes(4).toString('hex')}`, z.object({ n: z.number() }));

afterAll(async () => {
  await asTestOwner(async (owner) => {
    await owner`delete from pgboss.job where name = ${JOB.name}`;
    await owner`delete from pgboss.queue where name = ${JOB.name}`;
  });
  await client.beforeApplicationShutdown();
  await app.close();
});

const jobRows = () =>
  asTestOwner(
    (owner) => owner<{ id: string; data: { n: number } }[]>`
      select id::text, data from pgboss.job where name = ${JOB.name} order by created_on`,
  );

describe('PgBossJobQueue (as app_user)', () => {
  it('app_user can create the queue and enqueue without owning anything', async () => {
    const id = await queue.send(JOB, { n: 1 });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect((await jobRows()).map((r) => r.data)).toEqual([{ n: 1 }]);
  });

  it('validates the payload before enqueueing', async () => {
    await expect(queue.send(JOB, { n: 'x' } as unknown as { n: number })).rejects.toThrow();
  });

  it('a second send with the same id is a no-op', async () => {
    const id = randomUUID();
    expect(await queue.send(JOB, { n: 2 }, { id })).toBe(id);
    expect(await queue.send(JOB, { n: 3 }, { id })).toBeNull();
    expect((await jobRows()).filter((r) => r.id === id)).toHaveLength(1);
  });

  it('with `tx`, the job exists only if the transaction commits', async () => {
    const rolledBack = randomUUID();
    await expect(
      app.db.transaction(async (tx) => {
        await queue.send(JOB, { n: 4 }, { id: rolledBack, tx });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    const committed = randomUUID();
    await app.db.transaction((tx) => queue.send(JOB, { n: 5 }, { id: committed, tx }));
    const ids = (await jobRows()).map((r) => r.id);
    expect(ids).not.toContain(rolledBack);
    expect(ids).toContain(committed);
  });

  it('app_user still cannot run DDL in the pgboss schema', async () => {
    await expect(app.db.execute(sql`create table pgboss.intruder (id int)`)).rejects.toMatchObject({
      cause: { code: '42501' },
    });
  });
});

describe('Readiness', () => {
  it('reports ready when the DB and the pgboss schema are reachable as app_user', async () => {
    const database = new Database(appUrl);
    try {
      expect(await new Readiness(database).check()).toEqual({
        ready: true,
        checks: { database: 'ok', queue: 'ok' },
      });
    } finally {
      await database.onApplicationShutdown();
    }
  });
});
