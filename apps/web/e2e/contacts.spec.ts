import { expect, test } from '@playwright/test';
import { login, signupAndVerify, uniqueEmail } from './helpers';

test('M1-T1: create a contact with a local number, find it by search, duplicate is flagged', async ({
  page,
}) => {
  const email = uniqueEmail('owner');
  await signupAndVerify(page, email, 'Screen Fix', 'Shop Owner', 'Repair shop / service centre');
  await login(page, email);
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Contacts' })
    .click();
  await expect(page.getByRole('heading', { name: 'Contacts' })).toBeVisible();
  await expect(page.getByText('No contacts yet.')).toBeVisible();

  const mobile = `9${String(Date.now()).slice(-9)}`;
  const typed = `0${mobile.slice(0, 5)} ${mobile.slice(5)}`;
  await page.getByRole('button', { name: 'New contact' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill('Ravi Walk-in');
  await dialog.getByLabel('Phone').fill(typed);
  await expect(
    dialog.getByText(`Saved as +91 ${mobile.slice(0, 5)} ${mobile.slice(5)}`),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Save contact' }).click();
  await expect(page.getByRole('heading', { name: 'Ravi Walk-in' })).toBeVisible();

  await page.getByRole('link', { name: 'All contacts' }).click();
  await page.getByLabel('Search contacts').fill(mobile.slice(2, 8));
  await expect(page.getByRole('link', { name: 'Ravi Walk-in' })).toBeVisible();

  // Same number in another format → conflict that links to the existing contact.
  await page.getByRole('button', { name: 'New contact' }).click();
  await dialog.getByLabel('Name').fill('Ravi again');
  await dialog.getByLabel('Phone').fill(`+91${mobile}`);
  await dialog.getByRole('button', { name: 'Save contact' }).click();
  await expect(dialog.getByRole('alert')).toContainText('already exists');
  await expect(dialog.getByRole('link', { name: 'Ravi Walk-in' })).toBeVisible();
});
