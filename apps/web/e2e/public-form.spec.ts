import { type Page, expect, test } from '@playwright/test';
import { FIXTURES } from './fixtures';
import { loginAsFixture } from './helpers';

// M2-T2 AC: the embed snippet works on a plain HTML page on another site; attribution is stored on
// the lead; a honeypot submission is dropped silently (the visitor still sees "thank you").
const SITE = 'http://customer.test';

// The fake customer site is a non-secure "public" page loading a script from localhost, which
// Chromium's local-network checks block. Production (public https app, public customer sites)
// never hits this, so the checks are off for this spec only.
test.use({
  launchOptions: {
    args: [
      '--disable-features=BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,LocalNetworkAccessChecks',
    ],
  },
});
const nav = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name }).click();

/** The customer's own page: nothing but our snippet and a plain form. */
const customerPage = (snippet: string) => `<!doctype html>
<html><head><meta charset="utf-8"><title>Customer site</title></head>
<body><h1>Enquire now</h1>
${snippet.replace('<form data-revops-form>', '<form data-revops-form data-revops-success="Thanks, we will call you!">')}
</body></html>`;

test('M2-T2: embed snippet on a plain HTML page creates an attributed lead; honeypot dropped', async ({
  page,
}) => {
  await loginAsFixture(page, FIXTURES.forms);
  await nav(page, 'Lead sources');

  // A website form source that allows the customer's site.
  await page.getByRole('button', { name: 'New source' }).click();
  const create = page.getByRole('dialog');
  await create.getByLabel('Name').fill('Website enquiry');
  await create.getByRole('button', { name: 'New source' }).click();
  await expect(create).toBeHidden();
  const card = page
    .getByRole('list', { name: 'Lead sources' })
    .getByRole('listitem')
    .filter({ hasText: 'Website enquiry' });
  const key = (await card.locator('code').textContent()) ?? '';
  await card.getByRole('button', { name: 'Form settings' }).click();
  const settings = page.getByRole('dialog');
  await settings.getByLabel('Allowed websites (one per line)').fill(SITE);
  const snippet = await settings.getByLabel('Code for your website').inputValue();
  expect(snippet).toContain(`data-revops-key="${key}"`);
  await settings.getByRole('button', { name: 'Save' }).click();
  await expect(settings).toBeHidden();

  // The customer's site (a different origin), with campaign parameters in the URL.
  await page.route(`${SITE}/**`, (route) =>
    route.fulfill({ contentType: 'text/html', body: customerPage(snippet) }),
  );
  const mobile = `9${String(Date.now()).slice(-9)}`;
  await page.goto(`${SITE}/landing?utm_source=google&utm_campaign=diwali&gclid=g-123`);
  await page.getByPlaceholder('Your name').fill('Asha Verma');
  await page.getByPlaceholder('Phone').fill(mobile);
  await page.getByPlaceholder('Email').fill('asha.verma@example.com');
  await page.waitForTimeout(1600); // people take longer than the anti-bot minimum
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('status')).toHaveText('Thanks, we will call you!');

  // A bot fills the hidden honeypot: same thank-you, nothing stored.
  const botMobile = `8${String(Date.now()).slice(-9)}`;
  await page.reload();
  await page.getByPlaceholder('Your name').fill('Spam Bot');
  await page.getByPlaceholder('Phone').fill(botMobile);
  await page.locator('input[name="_hp"]').evaluate((el: HTMLInputElement) => {
    el.value = 'http://spam.example';
  });
  await page.waitForTimeout(1600);
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('status')).toHaveText('Thanks, we will call you!');

  // Back in RevOps: the lead is there with its source and attribution; the bot's isn't.
  await page.goto('/leads');
  const leads = await page.request.get(`/api/v1/leads?q=${mobile}`);
  const [lead] = ((await leads.json()) as { items: Record<string, unknown>[] }).items;
  expect(lead).toMatchObject({
    contact: { name: 'Asha Verma', email: 'asha.verma@example.com' },
    source: { name: 'Website enquiry' },
    attribution: {
      utm_source: 'google',
      utm_campaign: 'diwali',
      gclid: 'g-123',
      landing_url: `${SITE}/landing?utm_source=google&utm_campaign=diwali&gclid=g-123`,
    },
  });
  const bot = await page.request.get(`/api/v1/leads?q=${botMobile}`);
  expect(((await bot.json()) as { items: unknown[] }).items).toHaveLength(0);
  await expect(page.getByRole('link', { name: 'Asha Verma' })).toBeVisible();
});
