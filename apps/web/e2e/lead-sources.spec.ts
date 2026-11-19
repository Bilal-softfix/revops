import { createHmac } from 'node:crypto';
import { type Page, expect, test } from '@playwright/test';
import { FIXTURES } from './fixtures';
import { loginAsFixture } from './helpers';

// M2-T1: Settings → Lead sources — create, pause, rotate key, API source secret shown once, delete.
// M2-T3: a signed webhook delivery to the shown URL becomes a lead.
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
  const secret = (await page.getByTestId('webhook-secret').textContent()) ?? '';
  await page.getByRole('button', { name: 'I’ve saved it' }).click();
  await expect(page.getByTestId('webhook-secret')).toBeHidden();
  await expect(card(page, 'Zapier')).not.toContainText('whsec_');

  // M2-T3: a signed delivery to the shown webhook URL (through the app proxy) becomes a lead once
  // the worker has processed it; an unsigned one is refused.
  const url = (await card(page, 'Zapier').getByTestId('webhook-url').textContent()) ?? '';
  expect(url).toContain('/api/v1/public/webhooks/');
  const mobile = `7${String(Date.now()).slice(-9)}`;
  const raw = JSON.stringify({ id: `evt-${mobile}`, name: 'Hook Lead', phone: mobile });
  const ts = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', secret).update(`${ts}.${raw}`).digest('hex');
  const signed = await page.request.post(url, {
    headers: { 'content-type': 'application/json', 'x-revops-signature': `t=${ts},v1=${v1}` },
    data: raw,
  });
  expect(signed.status()).toBe(202);
  const unsigned = await page.request.post(url, {
    headers: { 'content-type': 'application/json' },
    data: raw,
  });
  expect(unsigned.status()).toBe(401);
  await expect
    .poll(
      async () =>
        (
          (await (await page.request.get(`/api/v1/leads?q=${mobile}`)).json()) as {
            items: unknown[];
          }
        ).items.length,
      { timeout: 15_000 },
    )
    .toBe(1);

  // M2-T3 review: owners see the rejected (unsigned) delivery.
  const zapier = card(page, 'Zapier');
  await zapier.getByRole('button', { name: 'Rejected deliveries' }).click();
  await expect(zapier.getByTestId('rejected-deliveries')).toContainText('No signature header');

  // Simple-token mode (opt-in, labelled less secure): the secret in X-Webhook-Token.
  await zapier.getByRole('combobox', { name: 'Authentication' }).click();
  await page.getByRole('option', { name: /Simple token \(less secure\)/ }).click();
  await expect(zapier.getByRole('note')).toContainText('Less secure');
  const tokenMobile = `6${String(Date.now()).slice(-9)}`;
  const viaToken = await page.request.post(url, {
    headers: { 'content-type': 'application/json', 'x-webhook-token': secret },
    data: JSON.stringify({ id: `tok-${tokenMobile}`, name: 'Token Lead', phone: tokenMobile }),
  });
  expect(viaToken.status()).toBe(202);
  await expect
    .poll(
      async () =>
        (
          (await (await page.request.get(`/api/v1/leads?q=${tokenMobile}`)).json()) as {
            items: unknown[];
          }
        ).items.length,
      { timeout: 15_000 },
    )
    .toBe(1);

  // Delete.
  await form.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(card(page, 'Website enquiry')).toHaveCount(0);
});

// M2-T5: CSV import — upload, map columns, background import with progress, error report.
test('M2-T5: import leads from a CSV file', async ({ page }) => {
  await loginAsFixture(page, FIXTURES.leadSources);
  await nav(page, 'Lead sources');
  await page.getByRole('button', { name: 'New source' }).click();
  const dialog = page.getByRole('dialog');
  const name = `Expo list ${Date.now()}`;
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByLabel('Type').click();
  await page.getByRole('option', { name: 'CSV import' }).click();
  await dialog.getByRole('button', { name: 'New source' }).click();
  await expect(dialog).toBeHidden();
  const source = card(page, name);
  await expect(source).toContainText('No imports yet.');

  const base = `8${String(Date.now()).slice(-7)}`;
  const csv = [
    'Customer,Mobile No.,Notes',
    `Imported One,${base}01,first`,
    `Imported Two,${base}02,second`,
    'Nobody,,no contact',
  ].join('\n');
  await source.getByRole('button', { name: 'Import CSV' }).click();
  const importDialog = page.getByRole('dialog');
  await importDialog.getByLabel('CSV file').setInputFiles({
    name: 'expo.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });
  await importDialog.getByRole('button', { name: 'Upload' }).click();
  // Preview + mapping: "Mobile No." is guessed as phone; "Customer" is mapped by hand.
  await expect(importDialog.getByRole('cell', { name: 'Imported Two' })).toBeVisible();
  await expect(importDialog.getByRole('combobox', { name: 'Mobile No.' })).toContainText('Phone');
  await importDialog.getByRole('combobox', { name: 'Customer' }).click();
  await page.getByRole('option', { name: 'Name', exact: true }).click();
  await importDialog.getByRole('button', { name: 'Import 3 rows' }).click();
  await expect(importDialog).toBeHidden();

  // The worker imports it; the list polls until done.
  const row = source.getByTestId('csv-import');
  await expect(row).toContainText('Done', { timeout: 30_000 });
  await expect(row).toContainText('2 new');
  await expect(row).toContainText('1 not imported');
  const download = page.waitForEvent('download');
  await row.getByRole('link', { name: 'Download rows not imported' }).click();
  expect((await download).suggestedFilename()).toBe('expo-errors.csv');
  const leads = (await (await page.request.get(`/api/v1/leads?q=${base}01`)).json()) as {
    items: { contact: { name: string } }[];
  };
  expect(leads.items[0]?.contact.name).toBe('Imported One');
});
