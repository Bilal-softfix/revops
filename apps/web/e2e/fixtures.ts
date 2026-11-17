import type { DemoTenant } from '@revops/db/testing';

// Pre-seeded fixture accounts (seeded by global-setup.ts on the freshly truncated test DB).
// Signup is rate-limited per IP (10/hour) and the suite runs from one IP, so specs use these
// whenever a fresh signup isn't what they test. Each spec gets its own workspace, so specs never
// see each other's changes. Password: PASSWORD from ./helpers.

interface Fixture {
  id: string;
  slug: string;
  name: string;
  industryTemplate: DemoTenant['industryTemplate'];
  owner: { email: string; name: string };
}

const fixture = (
  n: number,
  slug: string,
  name: string,
  industryTemplate: Fixture['industryTemplate'],
  ownerName: string,
): Fixture => ({
  id: `00000000-0000-4000-8000-0000000e2e${n.toString(16).padStart(2, '0')}`,
  slug: `e2e-${slug}`,
  name,
  industryTemplate,
  owner: { email: `owner-${slug}@e2e-fixture.revops.test`, name: ownerName },
});

export const FIXTURES = {
  contactsRepair: fixture(1, 'contacts-repair', 'Screen Fix', 'repair-shop', 'Shop Owner'),
  contactsAgency: fixture(2, 'contacts-agency', 'Code Shop', 'software-agency', 'Agency Owner'),
  customFields: fixture(3, 'custom-fields', 'Fix It', 'repair-shop', 'Shop Owner'),
  pipelines: fixture(4, 'pipelines', 'Fix Fast', 'repair-shop', 'Shop Owner'),
  team: fixture(5, 'team', 'Ravi Clinic', 'generic', 'Ravi Owner'),
  switchFirst: fixture(6, 'switch-first', 'First Realty', 'generic', 'First Owner'),
  switchSecond: fixture(7, 'switch-second', 'Second Clinic', 'generic', 'Second Owner'),
  leads: fixture(8, 'leads', 'Lead Desk', 'repair-shop', 'Desk Owner'),
  activities: fixture(9, 'activities', 'Task Desk', 'repair-shop', 'Task Owner'),
  /** M1-T7: 10,000 generated leads (global-setup), owned by the owner or unassigned. */
  volume: fixture(10, 'volume', 'Big Realty', 'real-estate', 'Volume Owner'),
  leadSources: fixture(11, 'lead-sources', 'Source Shop', 'repair-shop', 'Source Owner'),
} as const satisfies Record<string, Fixture>;

/** Leads generated into the `volume` fixture workspace. */
export const VOLUME_LEADS = 10_000;

/** The seed input for every fixture: one workspace each, its owner as the only member. */
export function fixtureAccounts(): { tenants: DemoTenant[]; users: Fixture['owner'][] } {
  const all = Object.values(FIXTURES);
  return {
    tenants: all.map((f) => ({
      id: f.id,
      slug: f.slug,
      name: f.name,
      industryTemplate: f.industryTemplate,
      members: [{ email: f.owner.email, role: 'owner' as const }],
    })),
    users: all.map((f) => f.owner),
  };
}
