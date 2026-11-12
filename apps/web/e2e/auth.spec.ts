import { expect, test } from '@playwright/test';
import { PASSWORD, linkFromEmail, login, signupAndVerify, uniqueEmail } from './helpers';

test.describe('M0-T7 AC: signup → verify email → login', () => {
  test('a new owner signs up, verifies with the password, signs in and sees their workspace', async ({
    page,
  }) => {
    const email = uniqueEmail('owner');
    await signupAndVerify(page, email, 'Asha Realty', 'Asha Owner');

    await page.getByRole('link', { name: 'Go to sign in' }).click();
    await login(page, email);
    await expect(page.getByRole('heading', { name: 'Welcome to Asha Realty' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Switch workspace' })).toContainText(
      'Asha Realty',
    );

    // Signing out ends the session: the app is no longer reachable.
    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('before verification, sign-in fails like a wrong password', async ({ page }) => {
    const email = uniqueEmail('pending');
    await page.goto('/signup');
    await page.getByLabel('Your name').fill('Pending Person');
    await page.getByLabel('Business name').fill('Pending Co');
    await page.getByLabel('Work email').fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();

    await page.goto('/login');
    await page.getByLabel('Work email').fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Incorrect email or password.')).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('"This wasn’t me" deletes an unverified sign-up and its link stops working', async ({
    page,
  }) => {
    const email = uniqueEmail('notme');
    await page.goto('/signup');
    await page.getByLabel('Your name').fill('Someone Else');
    await page.getByLabel('Business name').fill('Squatter Co');
    await page.getByLabel('Work email').fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();
    const link = await linkFromEmail(email, '/verify-email');

    await page.goto(link);
    await page.getByRole('button', { name: 'This wasn’t me — start over' }).click();
    await page.getByRole('button', { name: 'Delete sign-up' }).click();
    await expect(page.getByRole('heading', { name: 'Sign-up deleted' })).toBeVisible();

    await page.goto(link);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Verify email' }).click();
    await expect(page.getByText(/didn’t work/)).toBeVisible();
  });

  test('signed-out visitors are sent to /login', async ({ page }) => {
    await page.goto('/settings/team');
    await expect(page).toHaveURL(/\/login$/);
  });
});
