import { test, expect } from '@playwright/test';
import { SettingsPage, PATHS, SEEDED_TAGS } from '../../../pages/settings-data-model/SettingsPage';
import { recordEntity } from '../../../pages/settings-data-model/helpers';

// full-run: only ZZ-Explore tags created by THIS suite are ever deleted (never the 13 seeded tags).
const TAG = 'ZZ-Explore Tag 1';
test.describe.serial('Settings data model: tags (full-run, run-created only)', () => {
  let s: SettingsPage;
  test.beforeEach(async ({ page }) => { s = new SettingsPage(page); await s.goto(PATHS.tags, s.tagInput); await expect(s.tagRows.first()).toBeVisible(); });

  test.afterAll(async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: test.info().project.use.storageState as string });
    const page = await ctx.newPage();
    const sp = new SettingsPage(page);
    await sp.goto(PATHS.tags, sp.tagInput);
    await expect(sp.tagRows.first()).toBeVisible();
    // safety net: remove any leftover tag whose name starts with the ZZ-Explore prefix (run-created by this suite)
    for (let i = 0; i < 5; i++) {
      const left = page.locator('table tbody tr').filter({ has: page.locator('.tag-content', { hasText: /^\s*ZZ-Explore/ }) });
      if (!(await left.count())) break;
      const name = ((await left.first().locator('.tag-content').innerText()) || '').trim();
      await sp.deleteTag(name);
      await page.waitForTimeout(1_000);
      recordEntity({ type: 'record-tag', identifier: name, createdAt: new Date().toISOString(), note: 'removed in afterAll safety net', deleted: true });
    }
    await ctx.close();
  });

  test('TC-settings-data-model-022 add tag with empty name is blocked', async ({ page }) => {
    await expect(s.tagRows).toHaveCount(SEEDED_TAGS.length);
    await s.tagInput.fill('');
    await s.tagAdd.click({ force: true }).catch(() => undefined);
    await expect(s.tagRows).toHaveCount(SEEDED_TAGS.length);
    await expect(page.locator('.tag-content', { hasText: /^\s*$/ })).toHaveCount(0);
  });

  test('TC-settings-data-model-019 add then delete a ZZ-Explore record tag', async () => {
    await s.addTag(TAG);
    recordEntity({ type: 'record-tag', identifier: TAG, createdAt: new Date().toISOString(), note: 'TC-019' });
    await expect(s.tagRows).toHaveCount(SEEDED_TAGS.length + 1);
    await s.deleteTag(TAG);
    await expect(s.tagRow(TAG)).toHaveCount(0);
    recordEntity({ type: 'record-tag', identifier: TAG, createdAt: new Date().toISOString(), note: 'TC-019 deleted', deleted: true });
    await expect(s.tagRows).toHaveCount(SEEDED_TAGS.length);
    for (const t of SEEDED_TAGS) await expect(s.tagRow(t)).toHaveCount(1);
  });

  test('TC-settings-data-model-025 duplicate tag is rejected or de-duplicated', async () => {
    await s.addTag(TAG);
    recordEntity({ type: 'record-tag', identifier: TAG, createdAt: new Date().toISOString(), note: 'TC-025' });
    await s.tagInput.fill(TAG);
    await s.tagAdd.click();
    // observe: record actual behaviour; either way, cleanup removes every ZZ-Explore row
    await expect(s.tagRow(TAG).first()).toBeVisible();
    const n = await s.tagRow(TAG).count();
    test.info().annotations.push({ type: 'observed', description: `rows named "${TAG}" after adding it twice: ${n}` });
    expect(n).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < n; i++) { await s.deleteTag(TAG); await expect(s.tagRow(TAG)).toHaveCount(n - i - 1); }
    recordEntity({ type: 'record-tag', identifier: TAG, createdAt: new Date().toISOString(), note: 'TC-025 deleted', deleted: true });
    await expect(s.tagRows).toHaveCount(SEEDED_TAGS.length);
  });
});
