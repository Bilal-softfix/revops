import { INDUSTRY_TEMPLATES, INDUSTRY_TEMPLATE_KEYS } from '@revops/shared';
import { asc, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/client.js';
import { provisionCrm } from '../src/crm-provisioning.js';
import {
  customFieldDefs,
  leadSources,
  pipelineStages,
  pipelines,
  tenants,
} from '../src/schema/index.js';
import { loadTestDatabaseEnv } from '../src/testing/index.js';
import { withTenant } from '../src/with-tenant.js';
import { createTenant } from './tenant-tables.js';

// M1-T3a: a tenant's CRM setup comes from its industry template — once, idempotently.
const app = createDb(loadTestDatabaseEnv().appUrl, { max: 4 });
afterAll(() => app.close());

async function setup(tenantId: string) {
  return withTenant(app.db, tenantId, async (tx) => ({
    pipelines: await tx.select().from(pipelines).orderBy(asc(pipelines.position)),
    stages: await tx
      .select()
      .from(pipelineStages)
      .orderBy(asc(pipelineStages.pipelineId), asc(pipelineStages.position)),
    fields: await tx.select().from(customFieldDefs).orderBy(asc(customFieldDefs.position)),
    sources: await tx.select().from(leadSources),
  }));
}

describe('provisionCrm', () => {
  it.each(INDUSTRY_TEMPLATE_KEYS)('%s: seeds exactly what the template says', async (key) => {
    const tenantId = await createTenant(app.db);
    const result = await withTenant(app.db, tenantId, (tx) => provisionCrm(tx, tenantId, key));
    expect(result).toEqual({ provisioned: true, template: key });

    const template = INDUSTRY_TEMPLATES[key];
    const got = await setup(tenantId);
    expect(got.pipelines.map((p) => [p.key, p.isDefault, p.lostReasons])).toEqual(
      template.pipelines.map((p) => [p.key, p.isDefault, p.lostReasons]),
    );
    for (const pipeline of got.pipelines) {
      const expected = template.pipelines.find((p) => p.key === pipeline.key)?.stages ?? [];
      const stages = got.stages.filter((s) => s.pipelineId === pipeline.id);
      expect(stages.map((s) => [s.key, s.category, s.probability, s.position])).toEqual(
        expected.map((s, i) => [s.key, s.category, s.probability, i]),
      );
    }
    expect(got.fields.map((f) => [f.entity, f.key, f.type, f.options])).toEqual(
      template.customFields.map((f) => [f.entity, f.key, f.type, f.options ?? null]),
    );
    expect(got.sources.map((s) => [s.key, s.type]).sort()).toEqual(
      template.leadSources.map((s) => [s.key, s.type]).sort(),
    );
  });

  it('stores the template’s default CRM settings, without overwriting a value already set', async () => {
    const settingsOf = async (tenantId: string) =>
      (await withTenant(app.db, tenantId, (tx) => tx.select().from(tenants)))[0]?.settings;
    const shop = await createTenant(app.db);
    await withTenant(app.db, shop, (tx) => provisionCrm(tx, shop, 'repair-shop'));
    expect(await settingsOf(shop)).toMatchObject({ agentContactVisibility: 'all' });

    const custom = await createTenant(app.db);
    await withTenant(app.db, custom, (tx) =>
      tx
        .update(tenants)
        .set({ settings: { agentContactVisibility: 'assigned', other: 1 } })
        .where(eq(tenants.id, custom)),
    );
    await withTenant(app.db, custom, (tx) => provisionCrm(tx, custom, 'clinic'));
    expect(await settingsOf(custom)).toEqual({ agentContactVisibility: 'assigned', other: 1 });
  });

  it('runs once: a second call (even with another template) changes nothing', async () => {
    const tenantId = await createTenant(app.db);
    await withTenant(app.db, tenantId, (tx) => provisionCrm(tx, tenantId, 'repair-shop'));
    const before = await setup(tenantId);
    const again = await withTenant(app.db, tenantId, (tx) =>
      provisionCrm(tx, tenantId, 'software-agency'),
    );
    expect(again.provisioned).toBe(false);
    expect(await setup(tenantId)).toEqual(before);
  });

  it('concurrent first calls provision exactly once (advisory lock)', async () => {
    const tenantId = await createTenant(app.db);
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        withTenant(app.db, tenantId, (tx) => provisionCrm(tx, tenantId, 'clinic')),
      ),
    );
    expect(results.filter((r) => r.provisioned)).toHaveLength(1);
    expect((await setup(tenantId)).pipelines).toHaveLength(1);
  });

  it('an unknown or missing template key falls back to generic', async () => {
    const tenantId = await createTenant(app.db);
    const result = await withTenant(app.db, tenantId, (tx) =>
      provisionCrm(tx, tenantId, 'spaceships'),
    );
    expect(result.template).toBe('generic');
    expect((await setup(tenantId)).pipelines.map((p) => p.key)).toEqual(['sales']);
  });

  it('a stage can’t reference another tenant’s pipeline, even by its real id (composite FK)', async () => {
    const a = await createTenant(app.db);
    const b = await createTenant(app.db);
    await withTenant(app.db, b, (tx) => provisionCrm(tx, b, 'generic'));
    const [bPipeline] = (await setup(b)).pipelines;
    await expect(
      withTenant(app.db, a, (tx) =>
        tx.insert(pipelineStages).values({
          tenantId: a,
          pipelineId: bPipeline?.id ?? '',
          name: 'Hijack',
          position: 0,
          category: 'open',
        }),
      ),
    ).rejects.toMatchObject({ cause: { code: '23503' } });
    expect(
      (await setup(b)).stages.filter((s) => s.name === 'Hijack' || s.tenantId === a),
    ).toHaveLength(0);
    // …and tenant A never sees B's setup at all.
    expect(
      await withTenant(app.db, a, (tx) =>
        tx.select().from(pipelines).where(eq(pipelines.tenantId, b)),
      ),
    ).toEqual([]);
  });
});
