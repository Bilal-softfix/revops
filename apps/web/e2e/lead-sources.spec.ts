import { type Page, expect, test } from '@playwright/test';
import { FIXTURES } from './fixtures';
import { loginAsFixture } from './helpers';

// M2-T1: Settings → Lead sources — create, pause, rotate key, API source secret shown once, delete.
const nav = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name }).click();
const card = (page: Page, name: string) =>
  page.getByRole('list', { name: 'Lead sources' }).getByRole('listitem').filter({ hasText: name });

test('M2-T1: manage lead sources', async ({ page }) => {
  await loginAsFixture(page, FIXTURES.leadSources);
  await nav(page, 'Lead sources');
  await expect(page.getByRole('heading', { name: 'Lead sources' })).toBeVisible();

  // A website form: public key shown, no secret.
  await page.getByRole('button', { name: 'New source' }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill('Website enquiry');
  await dialog.getByRole('button', { name: 'New source' }).click();
  await expect(dialog).toBeHidden();
  const form = card(page, 'Website enquiry');
  await expect(form).toContainText('Website form');
  const key = (await form.locator('code').textContent()) ?? '';
  expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);

  // Pause / resume.
  await form.getByRole('button', { name: 'Pause' }).click();
  await expect(form).toContainText('Paused');
  await form.getByRole('button', { name: 'Resume' }).click();
  await expect(form).toContainText('Active');

  // M2-T6: who gets new leads (persists).
  await form.getByRole('combobox', { name: 'Assign new leads to' }).click();
  await page.getByRole('option', { name: 'Nobody (leave unassigned)' }).click();
  await expect(form.getByRole('combobox', { name: 'Assign new leads to' })).toContainText('Nobody');
  await page.reload();
  await expect(
    card(page, 'Website enquiry').getByRole('combobox', { name: 'Assign new leads to' }),
  ).toContainText('Nobody');

  // New public key after confirming.
  await form.getByRole('button', { name: 'New public key' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Continue' }).click();
  await expect(form.locator('code')).not.toHaveText(key);

  // An API source: the webhook secret is shown once.
  await page.getByRole('button', { name: 'New source' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill('Zapier');
  await dialog.getByLabel('Type').click();
  await page.getByRole('option', { name: 'API / webhook' }).click();
  await dialog.getByRole('button', { name: 'New source' }).click();
  await expect(page.getByTestId('webhook-secret')).toHaveText(/^whsec_[A-Za-z0-9_-]{43}$/);
  await page.getByRole('button', { name: 'I’ve saved it' }).click();
  await expect(page.getByTestId('webhook-secret')).toBeHidden();
  await expect(card(page, 'Zapier')).not.toContainText('whsec_');

  // Delete.
  await form.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(card(page, 'Website enquiry')).toHaveCount(0);
});
