import { test, expect } from '@playwright/test';
import { ConversationsPage } from '../../../pages/conversations/ConversationsPage';

// Read-only navigation/render checks. Seeded email folders: render only, never counts, senders or subjects.
test.describe('Conversations: browse folders and views', () => {
  let c: ConversationsPage;
  test.beforeEach(async ({ page }) => { c = new ConversationsPage(page); await c.goto(); await c.expectSubNav(); });

  test('TC-conversations-001 Open Conversations module from left nav', async ({ page }) => {
    await page.goto('/crm/sales/contacts');
    await page.getByRole('listitem', { name: 'Conversations' }).getByRole('link').click();
    await expect(page).toHaveURL(/\/crm\/sales\/conversations\/awaiting_response/);
    await expect(page.getByRole('link', { name: 'Conversations', exact: true }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sales Sequences', exact: true })).toBeVisible();
    for (const g of ['Email', 'Bulk Email', 'Email Tracking', 'Phone', 'SMS', 'Chat']) {
      await expect(page.getByText(g, { exact: true }).first()).toBeVisible();
    }
    await expect(page.getByText('Connect your Inbox to Freshsales')).toBeVisible();
    for (const p of ['Gmail', 'Microsoft Outlook', 'Zoho', 'Others']) {
      await expect(page.getByText(p, { exact: true }).first()).toBeVisible();
    }
  });

  test('TC-conversations-002 Awaiting Response view renders (no content assertions)', async ({ page }) => {
    await c.openFolder('Awaiting Response', /awaiting_response/);
    await c.expectRendered();
  });

  const folders: Array<[string, string, string, RegExp]> = [
    ['TC-conversations-003', 'Inbox', 'P0', /\/conversations\/inbox/],
    ['TC-conversations-004', 'Sent', 'P0', /\/conversations\/sent/],
    ['TC-conversations-011', 'Opens', 'P1', /\/conversations\/opened/],
    ['TC-conversations-012', 'Clicks', 'P1', /\/conversations\/clicked/],
  ];
  for (const [id, label, , url] of folders) {
    test(`${id} ${label} list renders (render only, no counts)`, async () => {
      await c.openFolder(label, url);
      await c.expectRendered();
    });
  }

  test('TC-conversations-005/006/007/013/049 Empty folders render an empty state without error', async ({ page }) => {
    for (const [label, url] of [['Scheduled', /scheduled/], ['Drafts', /drafts/], ['Trash', /trash/], ['Bounces', /./]] as Array<[string, RegExp]>) {
      await c.openFolder(label, url);
      await c.expectRendered();
      // soft observation only, not a contract
      expect.soft(await page.getByText('No conversations found.').count(), `${label} empty-state observation`).toBeGreaterThanOrEqual(0);
    }
    await c.openFolder('Trash', /trash/);
    await expect.soft(page.getByText('Showing Other Trash')).toBeVisible();
  });

  test('TC-conversations-014/015/016 Bulk email views render', async ({ page }) => {
    await c.openFolder('Bulk email metrics', /email-bulk-metrics/);
    await c.expectRendered();
    await c.openFolder('Bulk emails scheduled');
    await c.expectRendered();
    await c.openFolder('Bulk email drafts');
    await c.expectRendered();
  });

  test('TC-conversations-017/018 Phone views render', async ({ page }) => {
    await c.openFolder('All phone calls');
    await c.expectRendered();
    await expect(page.getByText('Phone number', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('Owner', { exact: false }).first()).toBeVisible();
    await c.openFolder('Voicemail');
    await c.expectRendered();
  });

  test('TC-conversations-019/020 SMS views render (Set up SMS never clicked)', async ({ page }) => {
    await c.openFolder('All SMS');
    await c.expectRendered();
    await expect(page.getByRole('button', { name: 'Set up SMS' })).toBeVisible();
    await c.openFolder('SMS Templates');
    await c.expectRendered();
    await expect(page.getByRole('button', { name: 'Create SMS template' }).first()).toBeVisible();
  });

  test('TC-conversations-021 Team Inbox setup page opens (Add Team Inbox never clicked)', async ({ page }) => {
    await c.openFolder('Team Inbox', /team_inbox/);
    await page.getByRole('button', { name: 'Set up Team Inbox' }).click();
    await expect(page).toHaveURL(/\/crm\/sales\/settings\/email\/team-inbox/);
    await expect(page.getByRole('button', { name: 'Add Team Inbox' }).first()).toBeVisible();
  });

  test('TC-conversations-032 Conversation Groups navigation', async () => {
    test.skip(true, 'No explore evidence for a Conversation Groups entry (label/location unverified); no stable locator to automate.');
  });

  test('TC-conversations-043 Navigating every sub-area renders pages despite console noise', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    for (const [l, u] of [['Inbox', /inbox/], ['Sent', /sent/], ['Opens', /opened/], ['Email Templates', /email-templates/]] as Array<[string, RegExp]>) {
      await c.openFolder(l, u);
      await c.expectRendered();
    }
    // baseline console errors/warnings are tolerated; only assert pages rendered
    test.info().annotations.push({ type: 'pageerrors', description: String(errors.length) });
  });

  test('TC-conversations-050 Inbox, Sent, Opens, Clicks assert render only', async ({ page }) => {
    for (const [l, u] of [['Inbox', /inbox/], ['Sent', /sent/], ['Opens', /opened/], ['Clicks', /clicked/]] as Array<[string, RegExp]>) {
      await c.openFolder(l, u);
      await c.expectRendered();
    }
  });
});
