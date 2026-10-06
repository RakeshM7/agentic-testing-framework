import { Browser } from '@playwright/test';
import { AnalyticsPage } from '../../../pages/analytics/AnalyticsPage';
import { recordEntity, readEntities, ZZ_PREFIX } from './helpers';

/**
 * Safety net: finds library reports whose name starts with the suite's own ZZ prefix (i.e. run-created, or left by a
 * cut-off earlier run of this suite), deletes the ZZ schedules on them and moves them to trash.
 * Never touches a report without the prefix, so curated/system and other tracks' reports are untouched.
 */
export async function sweepZZReports(browser: Browser, storageState: string) {
  const ctx = await browser.newContext({ storageState, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const a = new AnalyticsPage(page);
  try {
    for (let i = 0; i < 12; i++) {
      await a.gotoLibrary();
      await page.waitForTimeout(2500);
      const name = a.f.getByRole('gridcell').filter({ hasText: new RegExp('^' + ZZ_PREFIX) }).first();
      if (!(await name.count())) break;
      const title = (await name.innerText()).trim();
      await name.getByText(title, { exact: true }).first().click();
      await page.waitForURL(/analytics\/reports\/(?!new)[^/]+\/page\/1/, { timeout: 30_000 });
      const url = page.url();
      await a.waitView();
      await a.deleteSchedulesNamed('ZZ');
      await page.reload();
      await a.waitView();
      await a.trashCurrent(title);
      const known = readEntities().filter((e) => e.type === 'report' && e.url === url);
      if (known.length) recordEntity({ ...known[0], deleted: true, note: known[0].note + '; trashed by sweep' });
      else recordEntity({ type: 'report', identifier: title, url, createdAt: new Date().toISOString(), note: 'found by ZZ-prefix sweep (orphan of a prior run)', deleted: true });
    }
  } finally {
    await ctx.close();
  }
}
