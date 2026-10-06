import { test, expect } from '@playwright/test';
import { ConversationsPage } from '../../../pages/conversations/ConversationsPage';
import path from 'path';
import { RUN, markDeleted, pendingConv } from '../../../pages/conversations/tracker';

// full-run: creates/deletes ONLY ZZ-prefixed templates recorded in the track's created-entities.json.
// Seeded Public templates are never edited or deleted (delete guard in ConversationsPage.deleteIfExists).
const SESSION = path.join(__dirname, '..', '..', '..', '.auth', 'freshsales-handoff.json');
const A = `ZZ-TC-${RUN}`;
const B = `ZZ-TC-nameonly-${RUN}`;
const DUP = `ZZ-TC-dup-${RUN}`;
const SPECIAL = `ZZ <b>x</b> & q ${RUN}`;
const LONG = `ZZ-${RUN}-` + 'a'.repeat(300);

test.describe.serial('Conversations: email templates (full-run)', () => {
  let c: ConversationsPage;
  let seededBefore: string[] = [];
  test.beforeEach(async ({ page }) => { c = new ConversationsPage(page); });

  test('TC-conversations-047(a) Snapshot seeded (non-ZZ) template names before the suite', async () => {
    await c.gotoTemplates();
    await expect(c.rows.first()).toBeVisible();
    seededBefore = (await c.rows.locator('td a.strong').allInnerTexts()).map((s) => s.trim()).filter((n) => !n.startsWith('ZZ')).sort();
    expect(seededBefore.length).toBeGreaterThan(0);
  });

  test('TC-conversations-033/045 Empty name save is blocked', async ({ page }) => {
    await c.gotoTemplates();
    await c.openCreate();
    await c.clickSave();
    await expect(c.nameError).toBeVisible();
    await expect(c.nameInput).toBeVisible(); // drawer stays open
    await page.locator('.modal button.close').first().click();
  });

  test('TC-conversations-022 Create email template with name and subject', async ({ page }) => {
    await c.gotoTemplates();
    await c.createTemplate(A, 'ZZ subject');
    await c.reloadMine();
    await expect(c.row(A).first()).toBeVisible({ timeout: 20_000 });
    await expect(c.row(A).first().getByText('Private')).toBeVisible();
  });

  test('TC-conversations-023 Create email template with name only', async () => {
    await c.gotoTemplates();
    await c.createTemplate(B);
    await c.reloadMine();
    await expect(c.row(B).first()).toBeVisible({ timeout: 20_000 });
  });

  test('TC-conversations-024 Filter templates by Created by me', async ({ page }) => {
    await c.gotoTemplates();
    await page.getByRole('button', { name: 'Shared with me' }).first().click();
    for (const o of ['Created by me', 'Shared with me', 'Most recent']) await expect(page.getByText(o, { exact: true }).first()).toBeVisible();
    await page.getByText('Created by me', { exact: true }).first().click();
    await expect(page).toHaveURL(/filterParam=-301/);
    await expect(c.row(A).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Follow up after a meeting')).toHaveCount(0);
  });

  test('TC-conversations-030 Search templates with list search box', async ({ page }) => {
    await c.gotoTemplates(true);
    const box = page.getByRole('textbox', { name: 'Search by tags and templates' });
    await box.fill(A);
    await box.press('Enter');
    await expect(c.row(A).first()).toBeVisible({ timeout: 15_000 });
  });

  test('TC-conversations-025 Open Edit template drawer and cancel', async ({ page }) => {
    await c.gotoTemplates(true);
    await c.menuAction(A, 'Edit');
    await expect(page.getByText(/Edit template/i).first()).toBeVisible();
    await expect(c.nameInput).toHaveValue(A);
    await expect(c.subjectInput).toHaveValue('ZZ subject');
    await c.cancelDrawer();
    await expect(c.nameInput).toBeHidden();
    await c.reloadMine();
    await expect(c.row(A).first()).toBeVisible();
  });

  test('TC-conversations-029 Edit and save a run-created template', async ({ page }) => {
    await c.gotoTemplates(true);
    await c.menuAction(A, 'Edit');
    await c.subjectInput.fill('ZZ subject edited');
    await c.clickSave();
    await expect(c.nameInput).toBeHidden();
    await c.reloadMine();
    await c.menuAction(A, 'Edit');
    await expect(c.subjectInput).toHaveValue('ZZ subject edited');
    await c.cancelDrawer();
  });

  test('TC-conversations-044 Duplicate name is auto-suffixed with a timestamp', async ({ page }) => {
    await c.gotoTemplates();
    await c.createTemplate(DUP);
    await c.createTemplate(DUP);
    await c.reloadMine();
    await expect(c.row(DUP)).toHaveCount(2, { timeout: 20_000 });
    const names = (await c.row(DUP).locator('td a.strong').allInnerTexts()).map((s) => s.trim());
    expect(names.some((n) => n === DUP)).toBe(true);
    expect(names.some((n) => new RegExp(`^${DUP}\\s*\\[\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}\\]$`).test(n))).toBe(true);
  });

  test('TC-conversations-028 Clone a run-created template', async ({ page }) => {
    await c.gotoTemplates(true);
    const before = await c.row(A).count();
    await c.menuAction(A, 'Clone');
    // observed: Clone opens a prefilled drawer named '<name> - Copy'; saving creates the copy (prefix-covered by the A record)
    await expect(c.nameInput).toHaveValue(`${A} - Copy`);
    await c.clickSave();
    await expect(c.nameInput).toBeHidden();
    await c.reloadMine();
    await expect.poll(async () => c.row(A).count(), { timeout: 20_000 }).toBeGreaterThan(before);
  });

  test('TC-conversations-034/035/036 Boundary names: whitespace, very long, special characters', async ({ page }) => {
    await c.gotoTemplates();
    // whitespace-only: observed behaviour recorded, any created template is tracked and cleaned
    await c.openCreate();
    await c.nameInput.click();
    await c.nameInput.pressSequentially('   ', { delay: 20 });
    await c.clickSave();
    const blocked = await c.nameError.isVisible({ timeout: 5_000 }).catch(() => false);
    test.info().annotations.push({ type: 'whitespace-name', description: blocked ? 'rejected with name message' : 'accepted/other' });
    if (await c.nameInput.isVisible().catch(() => false)) await page.locator('.modal button.close').first().click();
    await c.gotoTemplates();
    await c.createTemplate(SPECIAL);
    await c.reloadMine();
    const sRow = c.row(RUN).filter({ hasText: 'x' }).first();
    await expect(sRow).toBeVisible({ timeout: 20_000 });
    // HTML must not render as markup: no <b> element inside the list rows
    await expect(c.rows.locator('b')).toHaveCount(0);
    await c.createTemplate(LONG);
    await c.reloadMine();
    await expect(c.row(`ZZ-${RUN}-`).first()).toBeVisible({ timeout: 20_000 });
  });

  test('TC-conversations-026 Delete a single run-created template', async ({ page }) => {
    await c.gotoTemplates(true);
    await c.menuAction(B, 'Delete');
    await expect(page.getByText('Are you sure you want to delete this template?')).toBeVisible();
    await expect(page.getByRole('button', { name: 'No', exact: true })).toBeVisible();
    await c.confirmYes();
    await c.reloadMine();
    await expect(c.row(B)).toHaveCount(0, { timeout: 20_000 });
    markDeleted(B);
  });

  test('TC-conversations-027/048 Bulk delete only one ZZ template among a mixed list', async ({ page }) => {
    await c.gotoTemplates(true);
    const name = (await c.row(DUP).first().locator('td a.strong').innerText()).trim();
    expect(name.startsWith('ZZ')).toBe(true);
    await c.row(name).first().locator('input[type=checkbox]').check({ force: true });
    await page.getByRole('button', { name: 'Delete', exact: true }).first().click();
    await expect(page.getByText('Are you sure you want to delete 1 template?')).toBeVisible();
    await c.confirmYes();
    await c.reloadMine();
    await expect(c.row(DUP)).toHaveCount(1, { timeout: 20_000 }); // the other ZZ dup remains
    markDeleted(name);
  });

  test('TC-conversations-037/047(b) Seeded Public templates untouched; guard rejects non-ZZ', async ({ page }) => {
    // Guard unit check: a seeded name can never pass the delete guard
    const { isConvCreated } = await import('../../../pages/conversations/tracker');
    expect(isConvCreated('Follow up after a meeting')).toBe(false);
    await c.gotoTemplates();
    await expect(c.rows.first()).toBeVisible();
    const afterNow = (await c.rows.locator('td a.strong').allInnerTexts()).map((s) => s.trim()).filter((n) => !n.startsWith('ZZ')).sort();
    expect(afterNow).toEqual(seededBefore);
    await expect(page.getByText('Public').first()).toBeVisible();
  });

  // Runs even when an earlier serial test failed: deletes only entities recorded by this track (guarded per row).
  test.afterAll(async ({ browser }) => {
    test.setTimeout(300_000);
    const ctx = await browser.newContext({ storageState: SESSION, viewport: { width: 1440, height: 900 }, baseURL: process.env.FRESHSALES_URL || 'https://rakesh-freshsales-ind-sep21.myfreshworks.com' });
    const page = await ctx.newPage();
    const cc = new ConversationsPage(page);
    await cc.cleanupPending(pendingConv().map((e) => e.identifier));
    await ctx.close();
  });
});

test.describe('Conversations: SMS template validation and skipped cases', () => {
  test('TC-conversations-039/046 SMS template empty-name save is blocked (nothing persisted)', async ({ page }) => {
    const c = new ConversationsPage(page);
    await c.goto();
    await c.openFolder('SMS Templates');
    await page.getByRole('button', { name: 'Create SMS template' }).first().click();
    await page.locator('.modal').getByRole('button', { name: 'Save', exact: true }).first().click();
    await expect(page.getByText('Give a name for your sms template.')).toBeVisible();
  });
  test('TC-conversations-038 Create SMS template with valid name/body', async () => { test.skip(true, 'SMS template creation excluded by authorization (observed: Template creation failed).'); });
  test('TC-conversations-052 SMS template valid-create boundary', async () => { test.skip(true, 'Placeholder per testcase: SMS provider not set up; creation excluded.'); });
});
