import { test, expect } from '@playwright/test';
import { ConversationsPage } from '../../../pages/conversations/ConversationsPage';

// Seeded content (dates, subjects) is unstable, so baselines cover only the connect-inbox landing, Team Inbox empty state and the SMS empty state.
test.describe('Conversations: visual regression', () => {
  test('Awaiting Response landing (connect inbox prompt)', async ({ page }) => {
    const c = new ConversationsPage(page);
    await c.goto();
    await expect(page.getByText('Connect your Inbox to Freshsales')).toBeVisible();
    await expect(page.getByText('Connect your Inbox to Freshsales').locator('xpath=ancestor::*[3]')).toHaveScreenshot('connect-inbox.png', { maxDiffPixelRatio: 0.05 });
  });

  test('Team Inbox empty state', async ({ page }) => {
    const c = new ConversationsPage(page);
    await c.goto('/crm/sales/conversations/team_inbox');
    const btn = page.getByRole('button', { name: 'Set up Team Inbox' });
    await expect(btn).toBeVisible();
    await expect(btn).toHaveScreenshot('team-inbox-button.png', { maxDiffPixelRatio: 0.05 });
  });

  test('Create template drawer', async ({ page }) => {
    const c = new ConversationsPage(page);
    await c.gotoTemplates();
    await c.openCreate();
    await expect(page.getByRole('dialog').first().locator('.ui-form-header')).toHaveScreenshot('create-template-header.png', { maxDiffPixelRatio: 0.05 });
  });
});
