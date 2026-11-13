import { expect, test } from '@playwright/test';
import { login, signupAndVerify, uniqueEmail } from './helpers';

test('M1-T2: template fields are there; a new field shows on the contact form; deleting hides it', async ({
  page,
}) => {
  const email = uniqueEmail('owner');
  await signupAndVerify(page, email, 'Fix It', 'Shop Owner', 'Repair shop / service centre');
  await login(page, email);

  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Custom fields' })
    .click();
  await expect(page.getByTestId('field-lead-device_brand')).toContainText('Device brand');
  await expect(page.getByTestId('field-lead-issue')).toContainText('Choice (one)');

  // Add a contact field (choice) with two options.
  const contactSection = page.getByRole('region', { name: 'Contact fields' });
  await contactSection.getByRole('button', { name: 'Add field' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Label').fill('Customer type');
  await expect(dialog.getByLabel('Key')).toHaveValue('customer_type');
  await dialog.getByRole('combobox', { name: 'Type' }).click();
  await page.getByRole('option', { name: 'Choice (one)' }).click();
  await dialog.getByLabel('Options (one per line)').fill('Retail\nBusiness');
  await dialog.getByRole('button', { name: 'Add field' }).click();
  await expect(page.getByTestId('field-contact-customer_type')).toBeVisible();

  // It appears in the contact form, and the value is saved.
  await page.goto('/contacts');
  await page.getByRole('button', { name: 'New contact' }).click();
  const form = page.getByRole('dialog');
  await form.getByLabel('Name').fill('Biz Customer');
  await form.getByLabel('Email').fill(uniqueEmail('biz'));
  await form.getByRole('combobox', { name: 'Customer type' }).click();
  await page.getByRole('option', { name: 'Business' }).click();
  await form.getByRole('button', { name: 'Save contact' }).click();
  await expect(page.getByRole('heading', { name: 'Biz Customer' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Customer type' })).toContainText('Business');
  const contactUrl = page.url();

  // Deleting the field hides it (the value stays stored, hidden).
  await page.goto('/settings/custom-fields');
  await page
    .getByTestId('field-contact-customer_type')
    .getByRole('button', { name: 'Delete' })
    .click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByTestId('field-contact-customer_type')).toHaveCount(0);
  await page.goto(contactUrl);
  await expect(page.getByRole('heading', { name: 'Biz Customer' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Customer type' })).toHaveCount(0);
});
