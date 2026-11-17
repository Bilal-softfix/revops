import {
  DEFAULT_TIMEZONE,
  type Lead,
  type TaskBucket,
  type TaskCounts,
  type TaskPage,
  taskBucket,
} from '@revops/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type LoggedIn,
  PASSWORD,
  type TestApp,
  createTestApp,
  login,
  uniqueEmail,
  verify,
  withSession,
} from './test-app';

// M1-T6: "My tasks" buckets around the IST day boundary, SQL checked against taskBucket().
// IST = UTC+5:30: 23:45 IST = 18:15Z, 00:00 IST = 18:30Z, 00:15 IST = 18:45Z.
const BUCKETS: TaskBucket[] = ['overdue', 'today', 'upcoming'];
const NOWS: [label: string, iso: string][] = [
  ['23:45 IST', '2026-11-16T18:15:00.000Z'],
  ['exactly 00:00 IST', '2026-11-16T18:30:00.000Z'],
  ['00:15 IST', '2026-11-16T18:45:00.000Z'],
];
// Due instants straddling every "now" and both midnights (ids are filled in once created).
const DUES = [
  '2026-11-16T18:14:59.999Z',
  '2026-11-16T18:15:00.000Z',
  '2026-11-16T18:15:00.001Z',
  '2026-11-16T18:29:59.999Z',
  '2026-11-16T18:30:00.000Z',
  '2026-11-16T18:30:00.001Z',
  '2026-11-16T18:44:59.999Z',
  '2026-11-16T18:45:00.000Z',
  '2026-11-16T18:45:00.001Z',
  '2026-11-17T18:29:59.999Z',
  '2026-11-17T18:30:00.000Z',
  '2026-11-17T18:30:00.001Z',
];

let t: TestApp;
let me: LoggedIn;
const idByDue = new Map<string, string>();

const get = (path: string, query: Record<string, string> = {}) =>
  withSession(request(t.server).get(path), me).query(query);
const setClock = (iso: string) =>
  t.clock.advance(new Date(iso).getTime() - t.clock.now().getTime());
const bucketIds = async (bucket: TaskBucket) =>
  new Set(
    ((await get('/v1/tasks', { bucket, limit: '100' }).expect(200)).body as TaskPage).items.map(
      (x) => x.id,
    ),
  );

beforeAll(async () => {
  t = await createTestApp();
  setClock('2026-11-16T12:00:00.000Z'); // before signup so the session is valid at every NOW
  const email = uniqueEmail('owner');
  await request(t.server)
    .post('/v1/auth/signup')
    .send({
      name: 'Owner',
      email,
      password: PASSWORD,
      tenantName: 'Boundary Co',
      industry: 'repair-shop',
    })
    .expect(202);
  await t.drain();
  await verify(t, t.email.lastTokenTo(email)).expect(204);
  me = await login(t, email);
  const lead = (
    await withSession(request(t.server).post('/v1/leads'), me)
      .send({ contact: { name: 'Kiran', phone: '9712345678' } })
      .expect(201)
  ).body as Lead;
  for (const dueAt of DUES) {
    const task = (
      await withSession(request(t.server).post(`/v1/leads/${lead.id}/tasks`), me)
        .send({ title: dueAt, dueAt })
        .expect(201)
    ).body as { id: string };
    idByDue.set(dueAt, task.id);
  }
});
afterAll(() => t.close());

describe('My tasks buckets at the IST day boundary (SQL agrees with taskBucket)', () => {
  it.each(NOWS)('bucket membership and counts at %s', async (_label, nowIso) => {
    setClock(nowIso);
    const now = new Date(nowIso);
    const expected: Record<TaskBucket, Set<string>> = {
      overdue: new Set(),
      today: new Set(),
      upcoming: new Set(),
    };
    for (const due of DUES) {
      expected[taskBucket(new Date(due), now, DEFAULT_TIMEZONE)].add(idByDue.get(due) ?? '');
    }

    for (const bucket of BUCKETS) {
      expect(await bucketIds(bucket), `${bucket} at ${nowIso}`).toEqual(expected[bucket]);
    }
    const counts = (await get('/v1/tasks/counts').expect(200)).body as TaskCounts;
    expect(counts).toEqual({
      overdue: expected.overdue.size,
      today: expected.today.size,
      upcoming: expected.upcoming.size,
    });
    expect(counts.overdue + counts.today + counts.upcoming).toBe(DUES.length);
  });

  it('a task due exactly now is today, not overdue', async () => {
    const nowIso = NOWS[0]?.[1] ?? '';
    setClock(nowIso);
    expect(await bucketIds('today')).toContain(idByDue.get(nowIso));
    expect(await bucketIds('overdue')).not.toContain(idByDue.get(nowIso));
  });

  it('at 00:00 IST a task due 00:00 is today and one due the instant before is overdue', async () => {
    setClock('2026-11-16T18:30:00.000Z');
    expect(await bucketIds('today')).toContain(idByDue.get('2026-11-16T18:30:00.000Z'));
    expect(await bucketIds('overdue')).toContain(idByDue.get('2026-11-16T18:29:59.999Z'));
  });

  it('a task upcoming at 23:45 is today at 00:00, and one that was today is overdue', async () => {
    const wasUpcoming = idByDue.get('2026-11-16T18:44:59.999Z');
    const wasToday = idByDue.get('2026-11-16T18:15:00.001Z');
    setClock('2026-11-16T18:15:00.000Z');
    expect(await bucketIds('upcoming')).toContain(wasUpcoming);
    expect(await bucketIds('today')).toContain(wasToday);
    setClock('2026-11-16T18:30:00.000Z');
    expect(await bucketIds('today')).toContain(wasUpcoming);
    expect(await bucketIds('overdue')).toContain(wasToday);
  });
});
