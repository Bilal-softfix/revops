import { expect, test } from '@playwright/test';
import { linkFromEmail, login, signupAndVerify, uniqueEmail } from './helpers';

test('an existing user accepts an invite while signed in, then switches between workspaces', async ({
  page,
  browser,
}) => {
  // Two independent owners, each with their own workspace
  const firstEmail = uniqueEmail('first');
  const secondEmail = uniqueEmail('second');
  await signupAndVerify(page, firstEmail, 'First Realty', 'First Owner');
  const other = await (await browser.newContext()).newPage();
  await signupAndVerify(other, secondEmail, 'Second Clinic', 'Second Owner');

  // The first owner invites the second as a manager
  await login(page, firstEmail);
  await page.goto('/settings/team');
  await page.getByRole('button', { name: 'Invite member' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Email').fill(secondEmail);
  await dialog.getByRole('combobox', { name: 'Role' }).click();
  await page.getByRole('option', { name: 'Manager' }).click();
  await dialog.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByTestId(`invitation-${secondEmail}`)).toBeVisible();

  // The second owner, signed in, accepts with one click
  await login(other, secondEmail);
  await other.goto(await linkFromEmail(secondEmail, '/accept-invite'));
  await expect(other.getByText(`You’re signed in as ${secondEmail}.`)).toBeVisible();
  await other.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(other).toHaveURL(/\/dashboard$/);

  // Both workspaces are listed; switching re-scopes the session and the page
  const switcher = other.getByRole('button', { name: 'Switch workspace' });
  // Read the current workspace first: an open menu hides the trigger from the a11y tree.
  const target = (await switcher.textContent())?.includes('First Realty')
    ? 'Second Clinic'
    : 'First Realty';
  await switcher.click();
  await expect(other.getByRole('menuitem', { name: /First Realty/ })).toContainText('Manager');
  await expect(other.getByRole('menuitem', { name: /Second Clinic/ })).toContainText('Owner');
  await other.getByRole('menuitem', { name: new RegExp(target) }).click();
  await expect(other.getByRole('heading', { name: `Welcome to ${target}` })).toBeVisible();
  await expect(switcher).toContainText(target);

  // The team page now shows that workspace's members only
  await other.goto('/settings/team');
  const ownTeam = target === 'First Realty' ? firstEmail : secondEmail;
  await expect(other.getByTestId(`member-${ownTeam}`)).toBeVisible();
  if (target === 'First Realty') {
    // As a manager there: read-only
    await expect(other.getByRole('button', { name: 'Invite member' })).toHaveCount(0);
  }
});
