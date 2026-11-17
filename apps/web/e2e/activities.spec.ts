import { type Page, expect, test } from '@playwright/test';
import { FIXTURES } from './fixtures';
import { loginAsFixture } from './helpers';

// M1-T5: notes and tasks on the lead page, the timeline, and "My tasks". One fixture workspace.
test.describe.configure({ mode: 'serial' });

const nav = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name }).click();
const timeline = (page: Page) => page.getByRole('list', { name: 'Timeline' });

test('M1-T5: notes, tasks and the timeline; My tasks', async ({ page }) => {
  await loginAsFixture(page, FIXTURES.activities);
  await nav(page, 'Leads');
  await page.getByRole('button', { name: 'New lead' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill('Asha Verma');
  await dialog.getByLabel('Phone').fill('98111 22333');
  await dialog.getByRole('button', { name: 'Save lead' }).click();
  await expect(page.getByRole('heading', { name: 'Asha Verma' })).toBeVisible();
  await expect(timeline(page)).toContainText('created the lead in Inquiries · New');

  // A note shows up at the top of the timeline; the author can edit it.
  await page.getByLabel('Add a note').fill('Screen cracked, wants a quote today');
  await page.getByRole('button', { name: 'Add note' }).click();
  const first = timeline(page).getByRole('listitem').first();
  await expect(first).toContainText('added a note');
  await expect(first).toContainText('Screen cracked, wants a quote today');
  await first.getByRole('button', { name: 'Edit' }).click();
  await first.getByRole('textbox', { name: 'Edit' }).fill('Screen cracked, quote sent');
  await first.getByRole('button', { name: 'Save' }).click();
  await expect(first).toContainText('Screen cracked, quote sent');
  await expect(first).toContainText('edited');

  // A stage change lands on the timeline.
  await page.getByRole('combobox', { name: 'Stage' }).click();
  await page.getByRole('option', { name: 'Quoted' }).click();
  await expect(timeline(page).getByRole('listitem').first()).toContainText(
    'moved the lead from New to Quoted',
  );

  // A task (default: tomorrow 10:00) appears in the side panel…
  await page.getByRole('button', { name: 'Add task' }).click();
  const form = page.getByRole('form', { name: 'New task' });
  await form.getByLabel('Task').fill('Call back about the quote');
  await form.getByRole('button', { name: 'Create task' }).click();
  await expect(page.getByRole('list', { name: 'Tasks' })).toContainText(
    'Call back about the quote',
  );

  // …and under Upcoming in My tasks, where it can be completed.
  await nav(page, 'My tasks');
  await expect(page.getByRole('heading', { name: 'My tasks', level: 1 })).toBeVisible();
  await page.getByRole('tab', { name: /Upcoming \(1\)/ }).click();
  const panel = page.getByRole('tabpanel');
  await expect(panel).toContainText('Call back about the quote');
  await expect(panel.getByRole('link', { name: 'Asha Verma' })).toBeVisible();
  // click, not check(): a completed task leaves the open list at once.
  await panel.getByRole('checkbox', { name: 'Mark “Call back about the quote” as done' }).click();
  await expect(page.getByRole('tab', { name: /Upcoming \(0\)/ })).toBeVisible();
  await expect(panel).toContainText('Nothing coming up.');

  // Completion is on the lead's timeline.
  await nav(page, 'Leads');
  await page.getByRole('link', { name: 'Asha Verma' }).first().click();
  await expect(timeline(page).getByRole('listitem').first()).toContainText(
    'completed the task “Call back about the quote”',
  );
});
