import type {
  CsvImport,
  CsvImportList,
  CsvImportPreview,
  LeadPage,
  LeadSource,
  LeadSourceWithSecret,
} from '@revops/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CSV_UPLOAD_LIMIT, CsvImportJob } from '../src/modules/capture';
import { ImportsRepository } from '../src/modules/capture/imports.repository';
import { InMemoryStorage, StorageProvider } from '../src/providers/storage';
import { RateLimiter } from '../src/platform/rate-limit/rate-limiter';
import {
  type LoggedIn,
  PASSWORD,
  type TestApp,
  addMember,
  asTestOwner,
  createTestApp,
  login,
  uniqueEmail,
  verify,
  withSession,
} from './test-app';

// M2-T5: CSV import — upload, preview, mapping, background job, error report, idempotent re-run.
let t: TestApp;
let owner: LoggedIn;
let tenantId: string;
let source: LeadSource;

async function signupOwner(tenantName: string): Promise<LoggedIn> {
  const email = uniqueEmail('owner');
  await request(t.server)
    .post('/v1/auth/signup')
    .send({ name: 'Owner', email, password: PASSWORD, tenantName, industry: 'generic' })
    .expect(202);
  await t.drain();
  await verify(t, t.email.lastTokenTo(email)).expect(204);
  return login(t, email);
}
const api = (s: LoggedIn) => ({
  get: (path: string) => withSession(request(t.server).get(path), s),
  post: (path: string, body: object = {}) =>
    withSession(request(t.server).post(path), s).send(body),
  patch: (path: string, body: object) => withSession(request(t.server).patch(path), s).send(body),
});
const upload = (
  csv: string | Buffer,
  opts: { as?: LoggedIn; source?: string; type?: string; name?: string } = {},
) =>
  withSession(
    request(t.server).post(`/v1/lead-sources/${opts.source ?? source.id}/imports`),
    opts.as ?? owner,
  )
    .set('Content-Type', opts.type ?? 'text/csv')
    .set('X-File-Name', opts.name ?? 'leads.csv')
    .send(typeof csv === 'string' ? Buffer.from(csv, 'utf8') : csv);

let seq = 0;
/** A unique 10-digit Indian mobile per call. */
const mobile = () => {
  seq += 1;
  return `9${String(Date.now() % 1e5).padStart(5, '0')}${String(seq).padStart(4, '0')}`;
};

/** Uploads, starts with the suggested mapping (or `mapping`) and runs the job. */
async function importCsv(csv: string, mapping?: (string | null)[]): Promise<CsvImport> {
  const preview = (await upload(csv).expect(201)).body as CsvImportPreview;
  await api(owner)
    .post(`/v1/imports/${preview.import.id}/start`, {
      mapping: mapping ?? preview.suggestedMapping,
    })
    .expect(202);
  await t.drain();
  return (await api(owner).get(`/v1/imports/${preview.import.id}`).expect(200)).body as CsvImport;
}
const leadsCount = async (q: string) =>
  (
    (
      await api(owner)
        .get(`/v1/leads?q=${encodeURIComponent(q)}`)
        .expect(200)
    ).body as LeadPage
  ).items.length;

beforeAll(async () => {
  t = await createTestApp();
  owner = await signupOwner('Import Co');
  tenantId = owner.body.tenant?.id ?? '';
  source = (
    (
      await api(owner)
        .post('/v1/lead-sources', {
          name: 'Expo list',
          type: 'csv',
          config: { assignment: { strategy: 'unassigned' } },
        })
        .expect(201)
    ).body as LeadSourceWithSecret
  ).source;
});
afterAll(() => t.close());

describe('upload', () => {
  it('stores the file, previews the first 20 rows and guesses the mapping', async () => {
    const rows = Array.from({ length: 25 }, (_, i) => `Lead ${i},${mobile()},l${i}@x.in,Pune`);
    const res = await upload(['Full Name,Mobile No.,Email ID,City', ...rows].join('\r\n'), {
      name: encodeURIComponent('मार्च leads.csv'),
    }).expect(201);
    const body = res.body as CsvImportPreview;
    expect(body.import).toMatchObject({
      status: 'uploaded',
      fileName: 'मार्च leads.csv',
      headers: ['Full Name', 'Mobile No.', 'Email ID', 'City'],
      totalRows: 25,
      processedRows: 0,
      mapping: null,
    });
    expect(body.preview).toHaveLength(20);
    expect(body.preview[0]?.[0]).toBe('Lead 0');
    expect(body.suggestedMapping).toEqual(['name', 'phone', 'email', 'city']);
    const storage = t.app.get<StorageProvider, InMemoryStorage>(StorageProvider);
    expect(storage.objects.has(`imports/${tenantId}/${body.import.id}.csv`)).toBe(true);
  });

  it.each([
    ['no rows below the header', 'name,phone\n', 400, 'csv_unreadable'],
    ['an empty file', '', 400, 'csv_unreadable'],
    ['an unterminated quote', 'name,phone\n"Ravi,98\n', 400, 'csv_unreadable'],
  ])('rejects %s', async (_label, csv, status, code) => {
    const res = await upload(csv).expect(status);
    expect(res.body).toMatchObject({ code });
  });

  it('rejects other content types (415), files over 10 MB and over 50k rows (413)', async () => {
    await upload('name,phone\na,1', { type: 'application/json' }).expect(415);
    await upload(Buffer.alloc(10 * 1024 * 1024 + 1, 'a')).expect(413);
    const many = ['phone', ...Array.from({ length: 50_001 }, () => '9')].join('\n');
    expect((await upload(many).expect(413)).body).toMatchObject({ code: 'csv_too_large' });
  });

  it('only into a live CSV source of this tenant', async () => {
    const api_ = (
      (await api(owner).post('/v1/lead-sources', { name: 'Hook', type: 'api' }).expect(201))
        .body as LeadSourceWithSecret
    ).source;
    expect((await upload('phone\n9', { source: api_.id }).expect(422)).body).toMatchObject({
      code: 'source_not_csv',
    });
    await upload('phone\n9', { source: '00000000-0000-4000-8000-000000000000' }).expect(404);
  });

  it('is rate limited per tenant', async () => {
    const other = await signupOwner('Upload Limit Co');
    const otherSource = (
      (await api(other).post('/v1/lead-sources', { name: 'CSV', type: 'csv' }).expect(201))
        .body as LeadSourceWithSecret
    ).source;
    const limiter = t.app.get(RateLimiter);
    const { limit, windowMs } = CSV_UPLOAD_LIMIT;
    for (let i = 0; i < limit; i += 1) {
      await limiter.consume(`csv-upload:${other.body.tenant?.id ?? ''}`, limit, windowMs);
    }
    await upload('phone\n9', { as: other, source: otherSource.id }).expect(429);
  });
});

describe('start + background import', () => {
  it('validates the mapping and starts once', async () => {
    const preview = (await upload(`name,phone\nA,${mobile()}`).expect(201))
      .body as CsvImportPreview;
    const start = (mapping: (string | null)[]) =>
      api(owner).post(`/v1/imports/${preview.import.id}/start`, { mapping });
    await start(['name', null]).expect(400); // no phone/email
    await start(['phone']).expect(400); // one entry per column
    await start(['phone', 'phone']).expect(400);
    expect((await start(['name', 'phone']).expect(202)).body).toMatchObject({ status: 'queued' });
    expect((await start(['name', 'phone']).expect(409)).body).toMatchObject({
      code: 'import_already_started',
    });
    await t.drain();
  });

  it('AC: partial failures are reported per row; the error report escapes formulas', async () => {
    const good = mobile();
    const csv = [
      'Name,Phone,Email,Budget',
      `Asha,${good},,10000`,
      'No contact,,,5',
      'Bad phone,12,not-an-email,7',
      `"=HYPERLINK(""http://evil"")",,,`,
      `Extra,${mobile()},,1,surplus`,
    ].join('\n');
    const done = await importCsv(csv);
    expect(done).toMatchObject({
      status: 'completed',
      totalRows: 5,
      processedRows: 5,
      createdCount: 1,
      failedCount: 4,
    });
    expect(await leadsCount(good)).toBe(1);

    const report = await api(owner).get(`/v1/imports/${done.id}/errors.csv`).expect(200);
    expect(report.headers['content-type']).toMatch(/^text\/csv/);
    expect(report.headers['content-disposition']).toContain('leads-errors.csv');
    const lines = report.text.replace(/^\uFEFF/, '').trim().split('\r\n');
    expect(lines[0]).toBe('Row,Problem,Name,Phone,Email,Budget');
    expect(lines.slice(1).map((l) => l.split(',').slice(0, 2).join(','))).toEqual([
      '2,No valid phone number or email',
      '3,No valid phone number or email',
      '4,No valid phone number or email',
      '5,More cells than the header row',
    ]);
    // A cell starting with = is neutralised (formula injection), never emitted raw.
    expect(report.text).not.toMatch(/(^|,)"?=HYPERLINK/m);
    const storage = t.app.get<StorageProvider, InMemoryStorage>(StorageProvider);
    expect([...storage.objects.keys()].some((k) => k.includes(done.id))).toBe(false);
  });

  it('AC: re-running the same file creates nothing new (rows are duplicates)', async () => {
    const phones = [mobile(), mobile(), mobile()];
    const csv = ['phone,name', ...phones.map((p, i) => `${p},Repeat ${i}`)].join('\n');
    const first = await importCsv(csv);
    expect(first).toMatchObject({ createdCount: 3, duplicateCount: 0 });
    const second = await importCsv(csv);
    expect(second).toMatchObject({ status: 'completed', createdCount: 0, duplicateCount: 3 });
    for (const p of phones) expect(await leadsCount(p)).toBe(1);
  });

  it('a retried job resumes at processed_rows; a finished import is not re-run', async () => {
    const phones = Array.from({ length: 6 }, () => mobile());
    const preview = (await upload(['phone', ...phones].join('\n')).expect(201))
      .body as CsvImportPreview;
    const id = preview.import.id;
    await api(owner)
      .post(`/v1/imports/${id}/start`, { mapping: ['phone'] })
      .expect(202);
    // As if the first attempt committed 2 rows' batch and then died.
    await asTestOwner((sql) =>
      sql.begin(async (tx) => {
        await tx`select set_config('app.tenant_id', ${tenantId}, true)`;
        await tx`update csv_imports set processed_rows = 2, status = 'processing' where id = ${id}`;
      }),
    );
    await t.drain();
    const done = (await api(owner).get(`/v1/imports/${id}`).expect(200)).body as CsvImport;
    expect(done).toMatchObject({ status: 'completed', processedRows: 6, createdCount: 4 });
    expect(await leadsCount(phones[0] ?? '')).toBe(0); // skipped by the resume point
    expect(await leadsCount(phones[5] ?? '')).toBe(1);
    await t.app.get(CsvImportJob).handle({ tenantId, importId: id }, { attempt: 2 } as never);
    expect(
      ((await api(owner).get(`/v1/imports/${id}`).expect(200)).body as CsvImport).createdCount,
    ).toBe(4);
  });

  it('AC: a 10k-row file imports in the background, then ANALYZEs the lead tables', async () => {
    const analyze = vi.spyOn(t.app.get(ImportsRepository), 'analyzeLeadTables');
    const prefix = `98${String(Date.now() % 1e3).padStart(3, '0')}`;
    const rows = Array.from(
      { length: 10_000 },
      (_, i) => `Bulk ${i},${prefix}${String(i).padStart(5, '0')},bulk${i}@example.in`,
    );
    const preview = (await upload(['name,phone,email', ...rows].join('\n')).expect(201))
      .body as CsvImportPreview;
    const started = (
      await api(owner)
        .post(`/v1/imports/${preview.import.id}/start`, { mapping: preview.suggestedMapping })
        .expect(202)
    ).body as CsvImport;
    expect(started).toMatchObject({ status: 'queued', processedRows: 0 }); // not on the request
    await t.drain();
    const done = (await api(owner).get(`/v1/imports/${preview.import.id}`).expect(200))
      .body as CsvImport;
    expect(done).toMatchObject({
      status: 'completed',
      totalRows: 10_000,
      processedRows: 10_000,
      createdCount: 10_000,
      failedCount: 0,
    });
    expect(analyze).toHaveBeenCalledTimes(1);
    const [stats] = await asTestOwner(
      (sql) =>
        sql<
          { analyzed: boolean }[]
        >`select coalesce(last_analyze > now() - interval '5 minutes', false) as analyzed
          from pg_stat_user_tables where relname = 'leads'`,
    );
    expect(stats?.analyzed).toBe(true);
    analyze.mockRestore();
  }, 600_000);

  it('small imports do not ANALYZE', async () => {
    const analyze = vi.spyOn(t.app.get(ImportsRepository), 'analyzeLeadTables');
    await importCsv(`phone\n${mobile()}`);
    expect(analyze).not.toHaveBeenCalled();
    analyze.mockRestore();
  });
});

describe('access', () => {
  it('owners/admins only; other tenants see nothing', async () => {
    const done = await importCsv(`phone\n${mobile()}`);
    const admin = await login(t, (await addMember(t, tenantId, 'admin')).email);
    const manager = await login(t, (await addMember(t, tenantId, 'manager')).email);
    const agent = await login(t, (await addMember(t, tenantId, 'agent')).email);
    await api(admin).get(`/v1/imports/${done.id}`).expect(200);
    const list = (await api(admin).get(`/v1/lead-sources/${source.id}/imports`).expect(200))
      .body as CsvImportList;
    expect(list.items.some((i) => i.id === done.id)).toBe(true);
    for (const s of [manager, agent]) {
      await api(s).get(`/v1/imports/${done.id}`).expect(403);
      await upload('phone\n9', { as: s }).expect(403);
    }
    const other = await signupOwner('Other Import Co');
    await api(other).get(`/v1/imports/${done.id}`).expect(404);
    await api(other).get(`/v1/imports/${done.id}/errors.csv`).expect(404);
    await api(other)
      .post(`/v1/imports/${done.id}/start`, { mapping: ['phone'] })
      .expect(404);
    await api(other).get(`/v1/lead-sources/${source.id}/imports`).expect(404);
  });
});
