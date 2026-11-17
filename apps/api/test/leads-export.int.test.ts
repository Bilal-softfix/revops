import type { Lead, Pipeline, PipelineList, Role } from '@revops/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LeadsExportService } from '../src/modules/crm/leads-export.service';
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

// M1-T6: CSV export of leads — same visibility + filters as the list, formula-injection escaping,
// paise → rupees, row cap (422), audit without PII.
let t: TestApp;
let owner: LoggedIn;
let manager: LoggedIn;
let admin: LoggedIn;
let agent: LoggedIn;
let idleAgent: LoggedIn; // owns no leads
let other: LoggedIn; // owner of another tenant
let tenantId: string;
let agentId: string;
let inquiries: Pipeline;
let ownerLead: Lead;
let agentLead: Lead;
let wonLead: Lead;
let otherLead: Lead;

const PATH = '/v1/exports/leads.csv';
const BOM = String.fromCharCode(0xfeff);
const HEADERS = [
  'Lead ID',
  'Contact name',
  'Phone (E.164)',
  'Email',
  'Pipeline',
  'Stage',
  'Status',
  'Owner',
  'Source',
  'Value (₹)',
  'Created at',
  'Won at',
  'Lost at',
  'Lost reason',
];

async function signupOwner(tenantName: string): Promise<LoggedIn> {
  const email = uniqueEmail('owner');
  await request(t.server)
    .post('/v1/auth/signup')
    .send({ name: 'Owner', email, password: PASSWORD, tenantName, industry: 'repair-shop' })
    .expect(202);
  await t.drain();
  await verify(t, t.email.lastTokenTo(email)).expect(204);
  return login(t, email);
}

const phone = () => `98${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
const createLead = async (s: LoggedIn, body: Record<string, unknown>) =>
  (
    await withSession(request(t.server).post('/v1/leads'), s)
      .send({ contact: { name: 'Asha', phone: phone() }, ...body })
      .expect(201)
  ).body as Lead;
const stage = (pipeline: Pipeline, key: string) => {
  const found = pipeline.stages.find((s) => s.key === key);
  if (!found) throw new Error(`no stage ${key}`);
  return found.id;
};

/** Minimal RFC 4180 parser (quoted cells, doubled quotes, CRLF rows). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\r' && text[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i++;
    } else cell += c;
  }
  return rows;
}

interface Csv {
  res: request.Response;
  text: string;
  header: string[];
  rows: Record<string, string>[];
}
async function exportCsv(s: LoggedIn, query: Record<string, string> = {}): Promise<Csv> {
  const res = await withSession(request(t.server).get(PATH), s, false)
    .query(query)
    .buffer(true)
    .parse((r, done) => {
      let data = '';
      r.setEncoding('utf8');
      r.on('data', (chunk: string) => (data += chunk));
      r.on('end', () => done(null, data));
    })
    .expect(200);
  const text = res.body as string;
  const [header = [], ...body] = parseCsv(text.slice(text.startsWith(BOM) ? 1 : 0));
  return {
    res,
    text,
    header,
    rows: body.map((cells) => Object.fromEntries(header.map((h, i) => [h, cells[i] ?? '']))),
  };
}
const ids = (csv: Csv) => csv.rows.map((r) => r['Lead ID']).sort();

beforeAll(async () => {
  t = await createTestApp();
  owner = await signupOwner('Fix It');
  tenantId = owner.body.tenant?.id ?? '';
  const as = async (role: Role) => {
    const member = await addMember(t, tenantId, role);
    return { session: await login(t, member.email), id: member.userId };
  };
  manager = (await as('manager')).session;
  admin = (await as('admin')).session;
  const a = await as('agent');
  agent = a.session;
  agentId = a.id;
  idleAgent = (await as('agent')).session;
  other = await signupOwner('Other Shop');
  const items = (
    (await withSession(request(t.server).get('/v1/pipelines'), owner).expect(200))
      .body as PipelineList
  ).items;
  inquiries = items.find((p) => p.key === 'inquiries') as Pipeline;

  ownerLead = await createLead(owner, {
    contact: { name: '=HYPERLINK("http://evil.test","x")', phone: phone() },
    valuePaise: 123_456,
    customFields: { device_brand: '@SUM(1+1)', issue: 'screen' },
  });
  agentLead = await createLead(agent, {
    contact: { name: 'आशा शर्मा', phone: phone(), email: uniqueEmail('asha') },
    valuePaise: 5,
    customFields: { device_brand: 'Samsung' },
  });
  wonLead = await createLead(owner, {
    contact: { name: 'Ravi, Jr.', phone: phone() },
    stageId: stage(inquiries, 'device_received'),
  });
  otherLead = await createLead(other, { contact: { name: 'Other tenant', phone: phone() } });
});
afterAll(() => t.close());

describe('GET /v1/exports/leads.csv', () => {
  it('is a UTF-8 CSV attachment with a BOM, CRLF lines and no caching', async () => {
    const csv = await exportCsv(owner);
    expect(csv.res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(csv.res.headers['cache-control']).toBe('no-store');
    expect(csv.res.headers['content-disposition']).toMatch(
      /^attachment; filename="leads-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    expect(csv.text.startsWith(BOM)).toBe(true);
    expect(csv.text.endsWith('\r\n')).toBe(true);
    expect(csv.text.replace(/\r\n/g, '')).not.toMatch(/\n/);
    expect(csv.header.slice(0, HEADERS.length)).toEqual(HEADERS);
    // One column per active custom lead field, by label.
    expect(csv.header).toEqual(expect.arrayContaining(['Device brand', 'Issue']));
  });

  it('owner, admin and manager get every lead of the tenant — never another tenant’s', async () => {
    const all = [ownerLead.id, agentLead.id, wonLead.id].sort();
    for (const s of [owner, admin, manager]) expect(ids(await exportCsv(s))).toEqual(all);
    expect(ids(await exportCsv(other))).toEqual([otherLead.id]);
  });

  describe('agents (tenant setting allowAgentExport)', () => {
    const setAllow = (allowAgentExport: boolean) =>
      withSession(request(t.server).patch('/v1/crm/settings'), owner)
        .send({ allowAgentExport })
        .expect(200);

    it('off by default: agents get 403 forbidden, owner/admin/manager still export', async () => {
      const settings = await withSession(request(t.server).get('/v1/crm/settings'), agent).expect(
        200,
      );
      expect(settings.body).toMatchObject({ allowAgentExport: false });
      for (const s of [agent, idleAgent]) {
        const res = await withSession(request(t.server).get(PATH), s, false).expect(403);
        expect((res.body as { code: string }).code).toBe('forbidden');
      }
      for (const s of [owner, admin, manager]) await exportCsv(s);
    });

    it('on: an agent gets only their own leads; an agent with none gets the header only', async () => {
      await setAllow(true);
      try {
        const mine = await exportCsv(agent);
        expect(ids(mine)).toEqual([agentLead.id]);
        expect(mine.rows[0]?.Owner).toBe('agent user');
        // Even filtering by another owner doesn't widen it.
        const ownerId = owner.body.user.id;
        expect(ids(await exportCsv(agent, { owner: ownerId }))).toEqual([]);
        const none = await exportCsv(idleAgent);
        expect(none.rows).toEqual([]);
        expect(none.header.slice(0, HEADERS.length)).toEqual(HEADERS);
      } finally {
        await setAllow(false);
      }
      await withSession(request(t.server).get(PATH), agent, false).expect(403);
    });

    it('only owners/admins change it; changes are audited with before/after', async () => {
      await withSession(request(t.server).patch('/v1/crm/settings'), manager)
        .send({ allowAgentExport: true })
        .expect(403);
      await withSession(request(t.server).patch('/v1/crm/settings'), agent)
        .send({ allowAgentExport: true })
        .expect(403);
      const audit = () =>
        asTestOwner((sql) =>
          sql.begin(async (tx) => {
            await tx`select set_config('app.tenant_id', ${tenantId}, true)`;
            return tx<{ before: unknown; after: unknown }[]>`
              select before, after from audit_logs where action = 'crm_settings.updated'
              order by created_at desc, id desc`;
          }),
        );
      const n = (await audit()).length;
      await setAllow(true);
      await setAllow(true); // no change → no audit row
      const res = await withSession(request(t.server).patch('/v1/crm/settings'), admin)
        .send({ allowAgentExport: false })
        .expect(200);
      expect(res.body).toMatchObject({ allowAgentExport: false });
      const rows = await audit();
      expect(rows.length).toBe(n + 2);
      expect(rows.slice(0, 2)).toEqual([
        { before: { allowAgentExport: true }, after: { allowAgentExport: false } },
        { before: { allowAgentExport: false }, after: { allowAgentExport: true } },
      ]);
    });
  });

  it('applies the list filters: stage, owner, q and a custom field', async () => {
    expect(ids(await exportCsv(owner, { stageIds: stage(inquiries, 'device_received') }))).toEqual([
      wonLead.id,
    ]);
    expect(ids(await exportCsv(owner, { owner: agentId }))).toEqual([agentLead.id]);
    expect(ids(await exportCsv(owner, { q: 'Ravi' }))).toEqual([wonLead.id]);
    expect(
      ids(await exportCsv(owner, { cf: JSON.stringify({ device_brand: 'samsung' }) })),
    ).toEqual([agentLead.id]);
  });

  it('rejects an unknown custom-field filter like the list does', async () => {
    const res = await withSession(request(t.server).get(PATH), owner, false)
      .query({ cf: JSON.stringify({ nope: 'x' }) })
      .expect(400);
    expect((res.body as { code: string }).code).toBe('validation_failed');
  });

  it('escapes formula payloads, formats values, times, names and custom fields', async () => {
    const csv = await exportCsv(owner);
    const row = (id: string) => csv.rows.find((r) => r['Lead ID'] === id) ?? {};
    const evil = row(ownerLead.id);
    expect(evil['Contact name']).toBe('\'=HYPERLINK("http://evil.test","x")');
    expect(evil['Device brand']).toBe("'@SUM(1+1)");
    expect(evil.Issue).toBe('Screen / display');
    expect(evil['Value (₹)']).toBe('1234.56');
    expect(evil['Phone (E.164)']).toMatch(/^'\+9198\d{8}$/);
    expect(evil.Pipeline).toBe(inquiries.name);
    expect(evil.Status).toBe('open');
    expect(evil['Created at']).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    // Raw text: the injected cell is quoted and starts with the apostrophe.
    expect(csv.text).toContain('"\'=HYPERLINK(""http://evil.test"",""x"")"');

    const asha = row(agentLead.id);
    expect(asha['Contact name']).toBe('आशा शर्मा');
    expect(asha['Value (₹)']).toBe('0.05');

    const won = row(wonLead.id);
    expect(won['Contact name']).toBe('Ravi, Jr.');
    expect(won.Status).toBe('won');
    expect(won['Won at']).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(won['Value (₹)']).toBe('');
  });

  it('times are in Asia/Kolkata', async () => {
    await asTestOwner((sql) =>
      sql.begin(async (tx) => {
        await tx`select set_config('app.tenant_id', ${tenantId}, true)`;
        await tx`update leads set created_at = '2026-03-01T20:00:00Z' where id = ${wonLead.id}`;
      }),
    );
    const csv = await exportCsv(owner, { q: 'Ravi' });
    expect(csv.rows[0]?.['Created at']).toBe('2026-03-02 01:30');
  });

  it('writes one lead.exported audit row with the count and filters — no PII', async () => {
    await exportCsv(owner, { owner: agentId });
    const rows = await asTestOwner((sql) =>
      sql.begin(async (tx) => {
        await tx`select set_config('app.tenant_id', ${tenantId}, true)`;
        return tx<{ entity: string; entity_id: string | null; after: Record<string, unknown> }[]>`
          select entity, entity_id, after from audit_logs
          where action = 'lead.exported' order by created_at desc limit 1`;
      }),
    );
    expect(rows[0]).toEqual({
      entity: 'lead',
      entity_id: null,
      after: { count: 1, filters: { owner: agentId } },
    });
    const text = JSON.stringify(rows[0]);
    expect(text).not.toContain('आशा');
    expect(text).not.toContain(agentLead.contact.phoneE164 ?? '??');
  });

  it('over the row cap → 422 export_too_large with limit and count', async () => {
    const service = t.app.get(LeadsExportService);
    service.maxRows = 2;
    try {
      const res = await withSession(request(t.server).get(PATH), owner, false).expect(422);
      expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(res.body).toMatchObject({ code: 'export_too_large', limit: 2, count: 3 });
      // Within the cap still works (a filter down to one lead).
      await exportCsv(owner, { owner: agentId });
    } finally {
      service.maxRows = 10_000;
    }
  });

  it('needs a session', async () => {
    await request(t.server).get(PATH).expect(401);
  });
});
