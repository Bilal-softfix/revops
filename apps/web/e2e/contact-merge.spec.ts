import { type Page, expect, test } from '@playwright/test';
import { FIXTURES } from './fixtures';
import { loginAsFixture } from './helpers';

// M2-T4: merge a duplicate contact (field-level pick) and the inbound dedupe setting.
const nav = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name }).click();

async function newContact(page: Page, name: string, phone: string, email?: string) {
  await nav(page, 'Contacts');
  await page.getByRole('button', { name: 'New contact' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByLabel('Phone').fill(phone);
  if (email) await dialog.getByLabel('Email').fill(email);
  await dialog.getByRole('button', { name: 'Save contact' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

test('M2-T4: merge a duplicate contact, keeping chosen fields', async ({ page }) => {
  await loginAsFixture(page, FIXTURES.merge);
  const stamp = String(Date.now()).slice(-8);
  const dupPhone = `97${stamp}`;
  await newContact(page, `Kiran Dup ${stamp}`, dupPhone, `kiran.${stamp}@example.com`);
  await newContact(page, `Kiran ${stamp}`, `98${stamp}`);

  await page.getByRole('button', { name: 'Merge duplicate' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Search contacts').fill(`Dup ${stamp}`);
  await dialog.getByRole('button', { name: new RegExp(`Kiran Dup ${stamp}`) }).click();
  await expect(dialog.getByText(`Merging Kiran Dup ${stamp} into this contact`)).toBeVisible();
  // Keep the duplicate's name; the email comes over because this contact has none.
  await dialog.getByRole('group', { name: 'Name' }).getByLabel(`Kiran Dup ${stamp}`).check();
  await dialog.getByRole('button', { name: 'Merge contacts' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { name: `Kiran Dup ${stamp}` })).toBeVisible();
  await expect(page.getByLabel('Email')).toHaveValue(`kiran.${stamp}@example.com`);

  // The duplicate is gone from the list.
  await nav(page, 'Contacts');
  await page.getByLabel('Search contacts').fill(stamp);
  await expect(page.getByRole('link', { name: new RegExp(`Kiran Dup ${stamp}`) })).toHaveCount(1);
});

test('M2-T4: inbound dedupe policy setting', async ({ page }) => {
  await loginAsFixture(page, FIXTURES.merge);
  await nav(page, 'CRM settings');
  await expect(page.getByRole('radio', { name: /Add it to their open lead/ })).toBeChecked();
  await page.getByRole('radio', { name: /Always create a new lead/ }).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Settings saved')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('radio', { name: /Always create a new lead/ })).toBeChecked();
});
