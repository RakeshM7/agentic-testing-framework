import { test, expect } from '@playwright/test';
import { ConversationsPage } from '../../../pages/conversations/ConversationsPage';

// Open-only checks. Send / Forward / Connect Gmail / Connect a different email / Use-template-insert are NEVER invoked.
test.describe('Conversations: threads and composer (open-only)', () => {
  let c: ConversationsPage;
  test.beforeEach(async ({ page }) => { c = new ConversationsPage(page); await c.goto('/crm/sales/conversations/inbox'); await c.expectSubNav(); });

  async function openFirstThread(page: import('@playwright/test').Page) {
    const first = page.locator('a[href*="/conversations/emails/"]').first();
    try { await first.waitFor({ state: 'attached', timeout: 12_000 }); } catch { return false; }
    await first.click();
    await expect(page).toHaveURL(/\/conversations\/emails\/\d+/);
    return true;
  }

  test('TC-conversations-008/051 Open an email thread from Inbox (conditional on a row)', async ({ page }) => {
    const opened = await openFirstThread(page);
    test.skip(!opened, 'Inbox has no rows');
    await expect(page.getByRole('button', { name: 'Reply' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Forward' }).first()).toBeVisible();
    await page.getByRole('link', { name: 'Conversations', exact: true }).first().click();
    await expect(page).toHaveURL(/\/crm\/sales\/conversations/);
  });

  test('TC-conversations-009/041 Reply composer opens without sending; unconnected banner shown', async ({ page }) => {
    const opened = await openFirstThread(page);
    test.skip(!opened, 'Inbox has no rows');
    await page.getByRole('button', { name: 'Reply' }).first().click();
    for (const t of ['Use template', 'Insert fields', 'Add follow-up task', 'Attach', 'Track this email', 'Add unsubscribe link']) {
      await expect(page.getByText(t, { exact: false }).first()).toBeVisible();
    }
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Connect Gmail' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Connect a different email' })).toBeVisible();
    // navigate away without sending
    await c.goto('/crm/sales/conversations/inbox');
  });

  test('TC-conversations-042 Open thread when folder is empty (Drafts)', async ({ page }) => {
    await c.goto('/crm/sales/conversations/drafts');
    await c.expectRendered();
    const rows = await page.locator('tbody tr').count();
    test.skip(rows > 0, 'Drafts has rows; empty-folder case not applicable');
    await expect(page.getByText('No conversations found.')).toBeVisible();
  });

  async function openComposer(page: import('@playwright/test').Page) {
    await page.locator('a.send-email').first().click();
    await expect(page).toHaveURL(/open_modal=email/);
    await expect(page.getByRole('dialog').getByText('New mail').first()).toBeVisible();
  }
  async function closeComposer(page: import('@playwright/test').Page) {
    // the first click can be swallowed while the drawer is still settling: retry until it is gone
    await expect(async () => {
      if (await page.locator('.modal button.close').count()) await page.locator('.modal button.close').first().click({ timeout: 2_000 });
      await expect(page.locator('.modal')).toHaveCount(0, { timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
  }

  test('TC-conversations-010/040 New mail composer opens and closes without sending', async ({ page }) => {
    await openComposer(page);
    await expect(page.getByText('Email usage : 0 / 100')).toBeVisible();
    for (const t of ['Use template', 'Insert fields', 'Add follow-up task', 'Attach', 'Track this email', 'Add unsubscribe link']) {
      await expect(page.getByText(t, { exact: false }).first()).toBeVisible();
    }
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
    await closeComposer(page);
    await expect(page.locator('.modal')).toHaveCount(0);
    await c.openFolder('Sent', /sent/);
    await expect(page.getByText('Email usage : 0 / 100')).toHaveCount(0);
  });

  test('TC-conversations-031 Composer Use template / Insert fields / Attach controls present', async ({ page }) => {
    await openComposer(page);
    await page.getByText('Use template', { exact: false }).first().click();
    await page.keyboard.press('Escape');
    await expect(page.getByText('Attach', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('Insert fields', { exact: false }).first()).toBeVisible();
    await c.goto('/crm/sales/conversations/inbox'); // navigate away, nothing sent
  });
});
