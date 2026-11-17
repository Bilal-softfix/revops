import { type Page, expect, test } from '@playwright/test';
import { FIXTURES } from './fixtures';
import { loginAsFixture } from './helpers';

// M1-T6: bulk assign + bulk stage move from the leads list. Uses the activities fixture
// workspace (its spec runs earlier and doesn't look at these leads); our leads are found by a
// search term no other spec uses.
test.describe.configure({ mode: 'serial' });

const TAG = 'Bulkzz';
const NAMES = [`${TAG} Asha`, `${TAG} Ravi`];

async function createLead(page: Page, name: string, phone: string) {
  await page.getByRole('button', { name: 'New lead' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByLabel('Phone').fill(phone);
  await dialog.getByRole('button', { name: 'Save lead' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await page.goto('/leads');
}

async function openOurLeads(page: Page) {
  await page.goto(`/leads?q=${TAG}`);
  for (const name of NAMES) await expect(page.getByTestId(`lead-${name}`)).toBeVisible();
}

test('M1-T6: select leads and bulk assign them', async ({ page }) => {
  await loginAsFixture(page, FIXTURES.activities);
  await page.goto('/leads');
  await createLead(page, NAMES[0] ?? '', '98111 22331');
  await createLead(page, NAMES[1] ?? '', '98111 22332');
  await openOurLeads(page);

  // Nothing selected: no bar. Select one, then all on the page.
  await expect(page.getByRole('toolbar', { name: 'Bulk actions' })).toHaveCount(0);
  await page.getByRole('checkbox', { name: `Select lead ${NAMES[0]}` }).check();
  const bar = page.getByRole('toolbar', { name: 'Bulk actions' });
  await expect(bar).toContainText('1 selected');
  await page.getByRole('checkbox', { name: 'Select all leads on this page' }).check();
  await expect(bar).toContainText('2 selected');

  await bar.getByRole('button', { name: 'Assign to…' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: 'Owner' }).click();
  await page.getByRole('option', { name: 'Unassigned' }).click();
  await dialog.getByRole('button', { name: 'Assign' }).click();

  await expect(page.getByText('2 updated')).toBeVisible();
  await expect(bar).toHaveCount(0);
  for (const name of NAMES) {
    await expect(page.getByTestId(`lead-${name}`)).toContainText('Unassigned');
  }
});

test('M1-T6: bulk move to a lost stage asks for a reason', async ({ page }) => {
  await loginAsFixture(page, FIXTURES.activities);
  await openOurLeads(page);
  await page.getByRole('checkbox', { name: 'Select all leads on this page' }).check();
  const bar = page.getByRole('toolbar', { name: 'Bulk actions' });
  await bar.getByRole('button', { name: 'Move to stage…' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('combobox', { name: 'Pipeline' })).toContainText('Inquiries');
  await dialog.getByRole('combobox', { name: 'Stage' }).click();
  await page.getByRole('option', { name: 'Not repairing' }).click();
  await dialog.getByRole('radio', { name: 'No response' }).check();
  await dialog.getByRole('button', { name: 'Move' }).click();

  await expect(page.getByText('2 updated')).toBeVisible();
  for (const name of NAMES) {
    await expect(page.getByTestId(`lead-${name}`)).toContainText('Not repairing');
  }
});
