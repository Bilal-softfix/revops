import { randomUUID } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import type { IndustryTemplateKey, Role } from '@revops/shared';
import { sql } from 'drizzle-orm';
import type { Db } from './client.js';
import { provisionCrm } from './crm-provisioning.js';
import { memberships, tenants, users } from './schema/index.js';
import { withContext } from './with-tenant.js';

/** Fixed ids so reruns find the demo tenants without a cross-tenant lookup (RLS is forced). */
export const DEMO_TENANT_ID = '00000000-0000-4000-8000-00000000d3e0';
export const DEMO_TENANT_SLUG = 'demo';
export const DEMO_TENANT_2_ID = '00000000-0000-4000-8000-00000000d3e1';
export const DEMO_TENANT_2_SLUG = 'demo-clinic';

export interface DemoTenant {
  id: string;
  slug: string;
  name: string;
  /** Seeds the CRM setup (pipelines, fields, sources, agentContactVisibility default). */
  industryTemplate: IndustryTemplateKey;
  members: readonly { email: string; role: Role }[];
}

export const DEMO_USERS: readonly { email: string; name: string }[] = [
  { email: 'owner@demo.revops.test', name: 'Demo Owner' },
  { email: 'admin@demo.revops.test', name: 'Demo Admin' },
  { email: 'manager@demo.revops.test', name: 'Demo Manager' },
  { email: 'agent@demo.revops.test', name: 'Demo Agent' },
  { email: 'owner2@demo.revops.test', name: 'Clinic Owner' },
  { email: 'agent2@demo.revops.test', name: 'Clinic Agent' },
];

/**
 * Two tenants, so tenant switching and isolation can be tried by hand: the manager belongs to
 * both (one login, two tenants in the switcher); everyone else belongs to exactly one.
 */
export const DEMO_TENANTS: readonly DemoTenant[] = [
  {
    id: DEMO_TENANT_ID,
    slug: DEMO_TENANT_SLUG,
    name: 'Demo Realty',
    industryTemplate: 'real-estate', // agents see only their contacts (assigned)
    members: [
      { email: 'owner@demo.revops.test', role: 'owner' },
      { email: 'admin@demo.revops.test', role: 'admin' },
      { email: 'manager@demo.revops.test', role: 'manager' },
      { email: 'agent@demo.revops.test', role: 'agent' },
    ],
  },
  {
    id: DEMO_TENANT_2_ID,
    slug: DEMO_TENANT_2_SLUG,
    name: 'Demo Clinic',
    industryTemplate: 'clinic', // front desk: agents see all contacts
    members: [
      { email: 'owner2@demo.revops.test', role: 'owner' },
      { email: 'manager@demo.revops.test', role: 'manager' },
      { email: 'agent2@demo.revops.test', role: 'agent' },
    ],
  },
];

/**
 * Idempotent dev seed: the demo tenants and users (verified, active), all with `password`. Reruns
 * reset names, roles and passwords to the seed values. Runs as app_user through RLS: each user row
 * is written in that user's own context (users allow self-insert/update only), each membership in
 * its tenant's context.
 */
export async function seedDemo(db: Db, password: string): Promise<{ tenantIds: string[] }> {
  const passwordHash = await hash(password); // argon2id by default

  for (const tenant of DEMO_TENANTS) {
    await withContext(db, { tenantId: tenant.id }, async (tx) => {
      await tx
        .insert(tenants)
        .values({
          id: tenant.id,
          name: tenant.name,
          slug: tenant.slug,
          industryTemplate: tenant.industryTemplate,
        })
        .onConflictDoUpdate({
          target: tenants.id,
          set: { industryTemplate: tenant.industryTemplate },
        });
      // Once: a tenant that already has a CRM setup keeps it (and its settings).
      await provisionCrm(tx, tenant.id, tenant.industryTemplate);
    });
  }

  const userIds = new Map<string, string>();
  for (const user of DEMO_USERS) {
    const [existing] = await db.execute<{ id: string }>(
      sql`select id from auth_find_user_by_email(${user.email})`,
    );
    const userId = existing?.id ?? randomUUID();
    userIds.set(user.email, userId);
    await withContext(db, { userId }, (tx) =>
      tx
        .insert(users)
        .values({ id: userId, ...user, passwordHash, emailVerifiedAt: new Date() })
        .onConflictDoUpdate({
          target: users.id,
          set: {
            name: user.name,
            passwordHash,
            emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, now())`,
          },
        }),
    );
  }

  for (const tenant of DEMO_TENANTS) {
    await withContext(db, { tenantId: tenant.id }, async (tx) => {
      for (const member of tenant.members) {
        const userId = userIds.get(member.email);
        if (!userId) throw new Error(`seed: ${member.email} is not in DEMO_USERS`);
        await tx
          .insert(memberships)
          .values({ tenantId: tenant.id, userId, role: member.role, status: 'active' })
          .onConflictDoUpdate({
            target: [memberships.tenantId, memberships.userId],
            set: { role: member.role, status: 'active' },
          });
      }
    });
  }
  return { tenantIds: DEMO_TENANTS.map((t) => t.id) };
}
