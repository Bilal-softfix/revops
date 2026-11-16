import { type Page, expect, test } from '@playwright/test';
import { FIXTURES } from './fixtures';
import { loginAsFixture } from './helpers';

// M1-T4: create a lead (pipeline-scoped fields), lose it with a reason, drag a card on the
// board, filter + save a view. One fixture repair-shop workspace, serial.
test.describe.configure({ mode: 'serial' });

const nav = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name }).click();

async function newLead(page: Page, name: string, phone: string, pipeline?: string) {
  await page.getByRole('button', { name: 'New lead' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByLabel('Phone').fill(phone);
  if (pipeline) {
    await dialog.getByRole('combobox', { name: 'Pipeline' }).click();
    await page.getByRole('option', { name: pipeline }).click();
  }
  return dialog;
}

test('M1-T4: create leads; fields follow the pipeline; losing needs a reason', async ({ page }) => {
  await loginAsFixture(page, FIXTURES.leads);
  await nav(page, 'Leads');
  await expect(page.getByRole('heading', { name: 'Leads', level: 1 })).toBeVisible();

  // Inquiries (default) doesn't show repair-job fields; Repair jobs does.
  let dialog = await newLead(page, 'Kiran Rao', '98765 43210');
  await expect(dialog.getByLabel('Device brand')).toBeVisible();
  await expect(dialog.getByLabel('IMEI / serial no.')).toHaveCount(0);
  await dialog.getByRole('combobox', { name: 'Pipeline' }).click();
  await page.getByRole('option', { name: 'Repair jobs' }).click();
  await dialog.getByLabel('IMEI / serial no.').fill('356938035643809');
  await dialog.getByLabel('Value (₹)').fill('2499.50');
  await dialog.getByRole('button', { name: 'Save lead' }).click();

  // Lead page.
  await expect(page.getByRole('heading', { name: 'Kiran Rao' })).toBeVisible();
  await expect(page.getByLabel('IMEI / serial no.')).toHaveValue('356938035643809');
  await expect(page.getByRole('combobox', { name: 'Stage' })).toContainText('Received');

  // Lost needs a reason.
  await page.getByRole('combobox', { name: 'Stage' }).click();
  await page.getByRole('option', { name: 'Cancelled' }).click();
  const lost = page.getByRole('dialog');
  await expect(lost).toContainText('Why was this lead lost?');
  await lost.getByRole('radio', { name: 'Not repairable' }).check();
  await lost.getByRole('button', { name: 'Mark lost' }).click();
  await expect(page.getByText('Lost on')).toContainText('Not repairable');

  // Reopen, so the board test has it in an open stage.
  await page.getByRole('combobox', { name: 'Stage' }).click();
  await page.getByRole('option', { name: 'Received' }).click();
  await expect(page.getByText('Lost on')).toHaveCount(0);

  // A second lead for the board and filters.
  await page.getByRole('link', { name: 'All leads' }).click();
  dialog = await newLead(page, 'Meena Iyer', '91234 56789', 'Repair jobs');
  await dialog.getByRole('button', { name: 'Save lead' }).click();
  await expect(page.getByRole('heading', { name: 'Meena Iyer' })).toBeVisible();
});

test('M1-T4: board drag-and-drop moves a lead; filters and a saved view', async ({ page }) => {
  await loginAsFixture(page, FIXTURES.leads);
  await page.goto('/leads');
  await page.getByRole('button', { name: 'Board' }).click();
  await page.getByRole('combobox', { name: 'Pipeline' }).click();
  await page.getByRole('option', { name: 'Repair jobs' }).click();

  const received = page.getByTestId('column-Received');
  const diagnosing = page.getByTestId('column-Diagnosing');
  await expect(received.getByTestId('card-Kiran Rao')).toBeVisible();
  await expect(received).toContainText('2');
  await received.getByTestId('card-Kiran Rao').dragTo(diagnosing);
  await expect(diagnosing.getByTestId('card-Kiran Rao')).toBeVisible();
  await expect(received.getByTestId('card-Kiran Rao')).toHaveCount(0);

  // Keyboard / touch alternative: the card's "Move to" select.
  await received.getByRole('combobox', { name: 'Move Meena Iyer to' }).click();
  await page.getByRole('option', { name: 'Repairing' }).click();
  await expect(page.getByTestId('column-Repairing').getByTestId('card-Meena Iyer')).toBeVisible();

  // List + search filter, kept in the URL, saved as a view.
  await page.getByRole('button', { name: 'List' }).click();
  const search = page.getByLabel('Search name, phone or email');
  await search.fill('Meena');
  await search.press('Enter');
  await expect(page).toHaveURL(/q=Meena/);
  await expect(page.getByTestId('lead-Meena Iyer')).toBeVisible();
  await expect(page.getByTestId('lead-Kiran Rao')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save view' }).click();
  await page.getByRole('dialog').getByLabel('View name').fill('Meena only');
  await page.getByRole('dialog').getByRole('button', { name: 'Save view' }).click();
  await expect(page.getByText('View “Meena only” saved')).toBeVisible();

  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.getByTestId('lead-Kiran Rao')).toBeVisible();
  await page.getByRole('combobox', { name: 'Saved views' }).click();
  await page.getByRole('option', { name: 'Meena only' }).click();
  await expect(page.getByTestId('lead-Kiran Rao')).toHaveCount(0);
  await expect(page.getByTestId('lead-Meena Iyer')).toBeVisible();
});
