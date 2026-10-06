import { test, expect } from '@playwright/test';
import { AnalyticsPage } from '../../../pages/analytics/AnalyticsPage';
import { recordEntity, RUN_ID, ZZ_PREFIX } from './helpers';
import { sweepZZReports } from './cleanup';

const created: { name: string; url: string }[] = [];
const trashedUrls = new Set<string>();

/** Clicks Save and returns the new report URL when the app accepted it, or null if it stayed in the builder. */
async function save(a: AnalyticsPage, name: string, note: string): Promise<string | null> {
  await a.saveBtn.click();
  const left = await a.page.waitForURL(/analytics\/reports\/(?!new)[^/]+\/page\/1/, { timeout: 12_000 }).then(() => true, () => false);
  if (!left) return null;
  const url = a.page.url();
  recordEntity({ type: 'report', identifier: name, url, createdAt: new Date().toISOString(), note });
  created.push({ name, url });
  return url;
}
async function trash(a: AnalyticsPage, name: string, url: string, match = name) {
  await a.gotoReport(url);
  await a.trashCurrent(match);
  recordEntity({ type: 'report', identifier: name, url, createdAt: new Date().toISOString(), note: 'trashed by test', deleted: true });
  trashedUrls.add(url);
}

test.describe.serial('Analytics: report name boundaries (full-run)', () => {
  test.describe.configure({ timeout: 180_000 });
  let a: AnalyticsPage;
  test.beforeEach(({ page }) => { a = new AnalyticsPage(page); });
  test.afterAll(async ({ browser }) => {
    test.setTimeout(300_000);
    // 'Untitled Report' is not ZZ-prefixed, so trash anything this spec created that is still open
    const ctx = await browser.newContext({ storageState: test.info().project.use.storageState as string, viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const b = new AnalyticsPage(page);
    for (const c of created.filter((x) => !trashedUrls.has(x.url) && !x.name.startsWith(ZZ_PREFIX))) {
      try {
        await page.goto(c.url);
        await b.waitView();
        await b.trashCurrent(c.name.slice(0, 40));
        recordEntity({ type: 'report', identifier: c.name, url: c.url, createdAt: new Date().toISOString(), note: 'trashed by afterAll', deleted: true });
      } catch { /* already trashed */ }
    }
    await ctx.close();
    await sweepZZReports(browser, test.info().project.use.storageState as string);
  });

  test('TC-analytics-027 report cannot be saved with an empty name', async ({ page }, info) => {
    await a.openBuilder();
    await a.addGalleryDealsWidget();
    await a.nameInput.fill('');
    const url = await save(a, 'Untitled Report', 'TC-027 unexpectedly saved with empty name');
    info.annotations.push({ type: 'observed', description: `saved with empty name: ${url !== null}; builder text: ${(await a.f.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200)}` });
    expect(url, 'Save must be blocked for an empty name').toBeNull();
    await expect(page).toHaveURL(/reports\/new/);
  });

  test('TC-analytics-028 duplicate report name (observed)', async ({}, info) => {
    const name = `${ZZ_PREFIX} dup ${RUN_ID}`;
    const first = await a.createReport(name);
    recordEntity({ type: 'report', identifier: name, url: first, createdAt: new Date().toISOString(), note: 'TC-028 first' });
    created.push({ name, url: first });
    await a.openBuilder();
    await a.addGalleryDealsWidget();
    await a.nameInput.fill(name);
    const second = await save(a, name, 'TC-028 duplicate');
    info.annotations.push({ type: 'observed', description: second ? 'duplicate name allowed (second report created)' : 'duplicate name rejected' });
    expect(second === null || second !== first).toBe(true);
    if (second) await trash(a, name, second);
    await trash(a, name, first);
  });

  test('TC-analytics-029 over-long (300 char) report name (observed)', async ({}, info) => {
    const name = (`${ZZ_PREFIX} ${RUN_ID} ` + 'x'.repeat(300)).slice(0, 300);
    await a.openBuilder();
    await a.addGalleryDealsWidget();
    await a.nameInput.fill(name);
    const url = await save(a, name, 'TC-029');
    info.annotations.push({ type: 'observed', description: url ? 'accepted' : 'rejected / stayed in builder' });
    if (url) {
      await expect(a.reportTitle).toContainText(ZZ_PREFIX);
      await trash(a, name, url, name.slice(0, 40));
    } else {
      await expect(a.page).toHaveURL(/reports\/new/);
    }
  });

  test('TC-analytics-030 default name Untitled Report (observed)', async ({}, info) => {
    await a.openBuilder();
    await a.addGalleryDealsWidget();
    await expect(a.nameInput).toHaveValue('Untitled Report');
    const url = await save(a, 'Untitled Report', 'TC-030');
    info.annotations.push({ type: 'observed', description: url ? 'saved as Untitled Report' : 'blocked' });
    if (url) {
      await expect(a.f.locator('h2').filter({ has: a.chevron })).toContainText('Untitled Report');
      await trash(a, 'Untitled Report', url);
    } else {
      await expect(a.page).toHaveURL(/reports\/new/);
    }
  });
});
