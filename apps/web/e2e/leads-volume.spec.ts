import { type Page, expect, test } from '@playwright/test';
import { FIXTURES } from './fixtures';
import { loginAsFixture } from './helpers';

// M1-T7: list and board stay usable with 10,000 leads (the `volume` fixture workspace, seeded
// by global-setup). Read-only, so the specs can run in any order.

const nav = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name }).click();
const rows = (page: Page) => page.locator('[data-testid^="lead-"]');

test('M1-T7: the leads list pages through 10k leads; select-all is page-only', async ({ page }) => {
  await loginAsFixture(page, FIXTURES.volume);
  await nav(page, 'Leads');
  await expect(page.getByRole('heading', { name: 'Leads', level: 1 })).toBeVisible();
  await expect(rows(page)).toHaveCount(50, { timeout: 5_000 });

  await page.getByRole('button', { name: 'Load more' }).click();
  await expect(rows(page)).toHaveCount(100, { timeout: 5_000 });

  // Select all = the loaded rows only, and the bar says so.
  await page.getByRole('checkbox', { name: 'Select all leads on this page' }).check();
  await expect(page.getByTestId('bulk-selected')).toHaveText('100 selected on this page');
});

test('M1-T7: the board counts every lead and loads more per column', async ({ page }) => {
  await loginAsFixture(page, FIXTURES.volume);
  await nav(page, 'Leads');
  await page.getByRole('button', { name: 'Board' }).click();
  const board = page.getByTestId('lead-board');
  await expect(board).toBeVisible({ timeout: 5_000 });

  const column = board.getByTestId('column-New enquiry');
  const cards = column.locator('[data-testid^="card-"]');
  await expect(cards).toHaveCount(25, { timeout: 5_000 });
  // The column badge counts all matching leads, far more than it shows.
  const badge = Number(
    await column
      .locator('header')
      .innerText()
      .then((t) => t.replace(/\D/g, '')),
  );
  expect(badge).toBeGreaterThan(100);

  await column.getByRole('button', { name: 'Load more' }).click();
  // A column loads further leads a list page (50) at a time: 25 + 50.
  await expect(cards).toHaveCount(75, { timeout: 5_000 });
});
