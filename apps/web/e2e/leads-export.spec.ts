import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { FIXTURES } from './fixtures';
import { loginAsFixture } from './helpers';

const BOM = new RegExp('^' + String.fromCharCode(0xfeff));

// M1-T6: CSV export of the filtered leads list (download, BOM, header row, filter applied).
test('M1-T6: export the filtered leads as CSV', async ({ page }) => {
  await loginAsFixture(page, FIXTURES.activities);
  await page.goto('/leads');
  await page.getByRole('button', { name: 'New lead' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill('=Exportzz Meera');
  await dialog.getByLabel('Phone').fill('98111 22339');
  await dialog.getByRole('button', { name: 'Save lead' }).click();
  await expect(page.getByRole('heading', { name: '=Exportzz Meera' })).toBeVisible();

  await page.goto('/leads?q=Exportzz');
  await expect(page.getByTestId('lead-=Exportzz Meera')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^leads-\d{4}-\d{2}-\d{2}\.csv$/);

  const csv = await readFile((await file.path()) ?? '', 'utf8');
  const lines = csv.replace(BOM, '').trim().split(/\r\n/);
  expect(lines[0]).toContain('Contact name');
  expect(lines).toHaveLength(2); // header + only the filtered lead
  // Formula-injection escaping reaches the file.
  expect(lines[1]).toContain(`'=Exportzz Meera`);
  expect(lines[1]).toContain(`'+919811122339`);
});
