// `pnpm db:explain-leads` (M1-T7 volume check) — EXPLAIN ANALYZE of the leads list and board
// query shapes for Demo Realty, as app_user through RLS, after `pnpm db:seed -- --volume`.
// The SQL mirrors apps/api/src/modules/crm/leads.repository.ts (list + countByStage); keep the two
// in step when those queries change. Prints the plan's top node, the indexes used and timings.
import { join } from 'node:path';
import {
  commonEnvSchema,
  databaseEnvSchema,
  findRepoRoot,
  loadEnvFiles,
  parseEnv,
} from '@revops/shared/env';
import { sql } from 'drizzle-orm';
import { createDb } from '../client.js';
import { DEMO_TENANT_ID } from '../seed.js';
import { withContext } from '../with-tenant.js';

const SELECT = sql`select l.*, c.name, c.phone_e164, c.email, u.name as owner_name, s.name as source_name
  from leads l join contacts c on c.id = l.contact_id
  left join users u on u.id = l.owner_user_id left join lead_sources s on s.id = l.source_id`;

async function main(): Promise<void> {
  loadEnvFiles([join(findRepoRoot(), '.env')]);
  const env = parseEnv(commonEnvSchema.extend(databaseEnvSchema.shape));
  const handle = createDb(env.DATABASE_URL, { max: 1 });
  try {
    await withContext(handle.db, { tenantId: DEMO_TENANT_ID }, async (tx) => {
      const [stage] = await tx.execute<{ stage_id: string; owner: string; pipeline_id: string }>(
        sql`select stage_id, owner_user_id as owner, pipeline_id from leads
            where owner_user_id is not null group by 1, 2, 3 order by count(*) desc limit 1`,
      );
      if (!stage) throw new Error('no leads — run `pnpm db:seed -- --volume` first');
      const [{ n } = { n: 0 }] = await tx.execute<{ n: number }>(
        sql`select count(*)::int as n from leads`,
      );
      console.log(`Demo Realty: ${n} leads`);
      const cases: [string, ReturnType<typeof sql>][] = [
        [
          'list: first page',
          sql`${SELECT} where l.deleted_at is null order by l.created_at desc, l.id desc limit 50`,
        ],
        [
          'list: agent (own leads)',
          sql`${SELECT} where l.deleted_at is null and l.owner_user_id = ${stage.owner} order by l.created_at desc, l.id desc limit 50`,
        ],
        [
          'list: stage filter',
          sql`${SELECT} where l.deleted_at is null and l.stage_id = ${stage.stage_id} order by l.created_at desc, l.id desc limit 50`,
        ],
        [
          'list: pipeline page 2 (cursor)',
          sql`${SELECT} where l.deleted_at is null and l.pipeline_id = ${stage.pipeline_id} and (l.created_at, l.id) < (select x.created_at, x.id from leads x order by x.created_at desc offset 50 limit 1) order by l.created_at desc, l.id desc limit 50`,
        ],
        [
          'list: search q',
          sql`${SELECT} where l.deleted_at is null and (c.name ilike '%sharma%' or c.email::text ilike '%sharma%') order by l.created_at desc, l.id desc limit 50`,
        ],
        [
          'list: custom field',
          sql`${SELECT} where l.deleted_at is null and l.custom_fields @> '{"property_type":"apartment"}' order by l.created_at desc, l.id desc limit 50`,
        ],
        [
          'board: counts per stage',
          sql`select l.stage_id, count(*)::int from leads l join contacts c on c.id = l.contact_id where l.deleted_at is null and l.pipeline_id = ${stage.pipeline_id} group by l.stage_id`,
        ],
      ];
      for (const [label, query] of cases) {
        const rows = await tx.execute<{ 'QUERY PLAN': unknown }>(
          sql`explain (analyze, format json) ${query}`,
        );
        const [plan] = rows[0]?.['QUERY PLAN'] as [
          { Plan: Record<string, unknown>; 'Execution Time': number },
        ];
        const indexes = new Set<string>();
        const seqScans = new Set<string>();
        const walk = (node: Record<string, unknown>) => {
          if (typeof node['Index Name'] === 'string') indexes.add(node['Index Name']);
          if (node['Node Type'] === 'Seq Scan') seqScans.add(String(node['Relation Name']));
          for (const child of (node.Plans as Record<string, unknown>[] | undefined) ?? [])
            walk(child);
        };
        walk(plan.Plan);
        console.log(
          `${label.padEnd(32)} ${plan['Execution Time'].toFixed(1).padStart(7)} ms  ` +
            `indexes: ${[...indexes].join(', ') || '-'}  seq scans: ${[...seqScans].join(', ') || '-'}`,
        );
      }
    });
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  console.error(
    `db:explain-leads failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
