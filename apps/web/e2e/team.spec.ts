import { expect, test } from '@playwright/test';
import { PASSWORD, linkFromEmail, login, navLabels, signupAndVerify, uniqueEmail } from './helpers';

test.describe('M0-T7 AC: invite → accept as agent → restricted nav', () => {
  test('an owner invites an agent, who accepts and gets the read-only team view', async ({
    page,
    browser,
  }) => {
    // Owner
    const ownerEmail = uniqueEmail('owner');
    await signupAndVerify(page, ownerEmail, 'Ravi Clinic', 'Ravi Owner');
    await login(page, ownerEmail);
    expect(await navLabels(page)).toEqual(['Dashboard', 'Contacts', 'Team']);
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Team' })
      .click();
    await expect(page.getByRole('heading', { name: 'Team', exact: true })).toBeVisible();

    // Invite an agent
    const agentEmail = uniqueEmail('agent');
    await page.getByRole('button', { name: 'Invite member' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Email').fill(agentEmail);
    await dialog.getByRole('combobox', { name: 'Role' }).click();
    await page.getByRole('option', { name: 'Agent' }).click();
    await dialog.getByRole('button', { name: 'Send invitation' }).click();
    await expect(page.getByText(`Invitation sent to ${agentEmail}`)).toBeVisible();
    await expect(page.getByTestId(`invitation-${agentEmail}`)).toContainText('Agent');

    // The agent accepts in a separate, signed-out browser
    const link = await linkFromEmail(agentEmail, '/accept-invite');
    const agentContext = await browser.newContext();
    const agent = await agentContext.newPage();
    await agent.goto(link);
    await expect(agent.getByRole('heading', { name: 'Join your team on RevOps' })).toBeVisible();
    await agent.getByLabel('Your name').fill('Meera Agent');
    await agent.getByLabel('Password').fill(PASSWORD);
    await agent.getByRole('button', { name: 'Create account and join' }).click();
    await expect(agent).toHaveURL(/\/dashboard$/);
    await expect(agent.getByRole('heading', { name: 'Welcome to Ravi Clinic' })).toBeVisible();
    await expect(agent.getByText('Agent', { exact: true }).first()).toBeVisible();

    // Restricted: the agent sees the team read-only — no invite, no invitations, no controls
    expect(await navLabels(agent)).toEqual(['Dashboard', 'Contacts', 'Team']);
    await agent
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Team' })
      .click();
    await expect(agent.getByTestId(`member-${agentEmail}`)).toContainText('You');
    await expect(agent.getByTestId(`member-${ownerEmail}`)).toContainText('Owner');
    await expect(
      agent.getByText('Only owners and admins can invite or manage members.'),
    ).toBeVisible();
    await expect(agent.getByRole('button', { name: 'Invite member' })).toHaveCount(0);
    await expect(agent.getByRole('heading', { name: 'Pending invitations' })).toHaveCount(0);
    await expect(agent.getByRole('combobox')).toHaveCount(0);
    await expect(agent.getByRole('button', { name: 'Disable' })).toHaveCount(0);
    await agentContext.close();

    // The owner now sees the agent as a member (and can manage them); the invitation is gone
    await page.reload();
    await expect(page.getByTestId(`member-${agentEmail}`)).toContainText('Meera Agent');
    await expect(page.getByTestId(`invitation-${agentEmail}`)).toHaveCount(0);
    await expect(
      page.getByTestId(`member-${agentEmail}`).getByRole('button', { name: 'Disable' }),
    ).toBeVisible();
  });
});
