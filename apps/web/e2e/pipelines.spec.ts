import { type Page, expect, test } from '@playwright/test';
import { login, signupAndVerify, uniqueEmail } from './helpers';

// M1-T3b: Settings → Pipelines, Settings → CRM settings, and "Shown in" for lead fields.
// (Moving leads when deleting a stage is covered by the API tests: leads have no UI until M1-T4.)

// One repair-shop owner for the whole file (signups are rate-limited per IP: 10/hour, and the
// suite runs from one IP). Serial, in this order: the pipelines test deletes "Inquiries" last.
test.describe.configure({ mode: 'serial' });
let ownerEmail = '';
test.beforeAll(async ({ browser }) => {
  ownerEmail = uniqueEmail('owner');
  const page = await browser.newPage();
  await signupAndVerify(page, ownerEmail, 'Fix Fast', 'Shop Owner', 'Repair shop / service centre');
  await page.close();
});
const asRepairShopOwner = (page: Page) => login(page, ownerEmail);
const nav = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name }).click();

test('M1-T3b: lead fields show which pipelines they apply to; scope can be changed', async ({
  page,
}) => {
  await asRepairShopOwner(page);
  await nav(page, 'Custom fields');
  await expect(page.getByTestId('field-lead-device_brand')).toContainText('All pipelines');
  await expect(page.getByTestId('field-lead-imei_serial')).toContainText('Repair jobs');
  await expect(page.getByTestId('field-lead-imei_serial')).not.toContainText('Inquiries');

  // Limit "Device model" to Inquiries only.
  await page.getByTestId('field-lead-device_model').getByRole('button', { name: 'Edit' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('radio', { name: 'Selected pipelines' }).check();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByText('Choose at least one pipeline')).toBeVisible();
  await dialog.getByRole('checkbox', { name: 'Inquiries' }).check();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('field-lead-device_model')).toContainText('Inquiries');
  await expect(page.getByTestId('field-lead-device_model')).not.toContainText('All pipelines');
});

test('M1-T3b: CRM settings — agent contact visibility', async ({ page }) => {
  await asRepairShopOwner(page);
  await nav(page, 'CRM settings');
  // Repair shops default to "all".
  await expect(page.getByRole('radio', { name: /All contacts/ })).toBeChecked();
  await page.getByRole('radio', { name: /Only their own/ }).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Settings saved')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('radio', { name: /Only their own/ })).toBeChecked();
});

test('M1-T3b: pipelines — create, add/reorder/delete stages, switch default', async ({ page }) => {
  await asRepairShopOwner(page);
  await nav(page, 'Pipelines');
  await expect(page.getByRole('heading', { name: 'Pipelines', level: 1 })).toBeVisible();
  const inquiries = page.getByTestId('pipeline-Inquiries');
  await expect(inquiries).toContainText('Default');
  await expect(
    page.getByTestId('pipeline-Repair jobs').getByTestId('stage-Diagnosing'),
  ).toBeVisible();

  // New pipeline with the default stages.
  await page.getByRole('button', { name: 'New pipeline' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill('AMC renewals');
  await dialog.getByLabel('Lost reasons (one per line)').fill('Too costly\nSwitched vendor');
  await dialog.getByRole('button', { name: 'Create pipeline' }).click();
  const amc = page.getByTestId('pipeline-AMC renewals');
  await expect(amc.getByTestId('stage-New')).toBeVisible();

  // Add a stage, then move it up one place.
  await amc.getByRole('button', { name: 'Add stage' }).click();
  await page.getByRole('dialog').getByLabel('Stage name').fill('Quote sent');
  await page.getByRole('dialog').getByRole('button', { name: 'Add stage' }).click();
  await expect(amc.getByTestId('stage-Quote sent')).toBeVisible();
  await expect(amc.getByRole('row').nth(5)).toContainText('Quote sent');
  await amc.getByRole('button', { name: 'Move Quote sent up' }).click();
  await expect(amc.getByRole('row').nth(4)).toContainText('Quote sent');

  // Delete an empty stage.
  await amc.getByTestId('stage-In progress').getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(amc.getByTestId('stage-In progress')).toHaveCount(0);

  // Make it the default; Inquiries loses the badge.
  await amc.getByRole('button', { name: 'Make default' }).click();
  await expect(amc).toContainText('Default');
  await expect(inquiries).not.toContainText('Default');
  // Inquiries is no longer the default, so it can now be deleted (it has no leads).
  await inquiries.getByRole('button', { name: 'Delete' }).first().click();
  await expect(page.getByRole('dialog')).toContainText('Delete pipeline');
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByTestId('pipeline-Inquiries')).toHaveCount(0);
});
