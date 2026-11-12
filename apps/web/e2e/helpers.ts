import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { type Page, expect } from '@playwright/test';

const MAIL_DIR = resolve(import.meta.dirname, '..', '.e2e-mail');
export const PASSWORD = 'e2e correct horse battery';

export const uniqueEmail = (label: string) =>
  `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@e2e.revops.test`;

interface Mail {
  to: string;
  subject: string;
  text: string;
}

async function mailbox(): Promise<Mail[]> {
  let names: string[];
  try {
    names = (await readdir(MAIL_DIR)).filter((n) => n.endsWith('.json')).sort();
  } catch {
    return [];
  }
  return Promise.all(
    names.map(async (n) => JSON.parse(await readFile(join(MAIL_DIR, n), 'utf8')) as Mail),
  );
}

/**
 * Waits for the newest email to `to` containing a link to `path` (sent by the worker's job) and
 * returns that link's path + query, to open against the test web server.
 */
export async function linkFromEmail(to: string, path: string): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(
      async () => {
        const mails = (await mailbox()).filter((m) => m.to === to);
        for (const mail of mails.reverse()) {
          const match = mail.text.match(/https?:\/\/\S+/g)?.find((url) => url.includes(path));
          if (match) {
            const url = new URL(match);
            link = `${url.pathname}${url.search}`;
            return true;
          }
        }
        return false;
      },
      { timeout: 20_000, message: `email to ${to} with a ${path} link` },
    )
    .toBe(true);
  return link ?? '';
}

/** Signs up through the UI, verifies through the emailed link, and lands signed out on /login. */
export async function signupAndVerify(page: Page, email: string, business: string, name: string) {
  await page.goto('/signup');
  await page.getByLabel('Your name').fill(name);
  await page.getByLabel('Business name').fill(business);
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();

  await page.goto(await linkFromEmail(email, '/verify-email'));
  await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeVisible();
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Verify email' }).click();
  await expect(page.getByRole('heading', { name: 'Email verified' })).toBeVisible();
}

export async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

/** The labels of the main navigation links, in order. */
export async function navLabels(page: Page): Promise<string[]> {
  const nav = page.getByRole('navigation', { name: 'Main' }).first();
  return (await nav.getByRole('link').allInnerTexts()).map((t) => t.trim());
}
