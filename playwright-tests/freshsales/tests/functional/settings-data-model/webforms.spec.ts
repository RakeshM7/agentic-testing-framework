import { test, expect } from '@playwright/test';
import { SettingsPage, PATHS } from '../../../pages/settings-data-model/SettingsPage';
import { recordEntity } from '../../../pages/settings-data-model/helpers';

// full-run: only ZZ-Explore web forms created by this suite are deleted. Forms are never published or embedded.
const now = () => new Date().toISOString();

test.describe.serial('Settings data model: web forms (full-run, run-created only)', () => {
  test.setTimeout(120_000);
  test.afterAll(async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await browser.newContext({ storageState: test.info().project.use.storageState as string });
    const page = await ctx.newPage();
    const sp = new SettingsPage(page);
    await sp.goto(PATHS.webForms, page.getByRole('button', { name: 'Add web form' }).first());
    await page.waitForLoadState('networkidle').catch(() => undefined);
    for (let i = 0; i < 4; i++) {
      const left = page.locator('table tbody tr a[title^="ZZ-Explore"]');
      if (!(await left.count())) break;
      const name = (await left.first().getAttribute('title')) || '';
      await sp.deleteWebForm(name);
      await expect(sp.webFormRow(name)).toHaveCount(0);
      recordEntity({ type: 'web-form', identifier: name, createdAt: now(), note: 'removed by cleanup', deleted: true });
    }
    await ctx.close();
  });

  test('TC-settings-data-model-014 / 044 build, save and delete a ZZ-Explore web form', async ({ page }) => {
    const N = 'ZZ-Explore Form 1';
    const s = new SettingsPage(page);
    await s.createWebForm(N);
    expect(await s.webFormSaved(), 'web form save navigates to its edit page').toBe(true);
    recordEntity({ type: 'web-form', identifier: N, createdAt: now(), note: 'TC-014' });
    await s.goto(PATHS.webForms, page.getByRole('button', { name: 'Add web form' }).first());
    await expect(s.webFormRow(N)).toHaveCount(1);
    await s.deleteWebForm(N);
    await expect(s.webFormRow(N)).toHaveCount(0);
    recordEntity({ type: 'web-form', identifier: N, createdAt: now(), note: 'TC-014 deleted', deleted: true });
    await page.reload();
    await expect(page.getByRole('button', { name: 'Add web form' }).first()).toBeVisible();
    await expect(s.webFormRow(N)).toHaveCount(0);
    // empty state is asserted by TC-013 (read-only view); other ZZ-Explore leftovers from a failed run must not make this case fail
  });

  test('TC-settings-data-model-037 observe web form limit (cap 2 forms)', async ({ page }) => {
    test.setTimeout(180_000);
    const s = new SettingsPage(page);
    const names = ['ZZ-Explore Limit Form 1', 'ZZ-Explore Limit Form 2'];
    let reached = false;
    for (const n of names) {
      await s.createWebForm(n);
      const saved = await s.webFormSaved();
      if (!saved) { reached = true; test.info().annotations.push({ type: 'observed', description: `TC-037 save blocked at ${n}` }); break; }
      recordEntity({ type: 'web-form', identifier: n, createdAt: now(), note: 'TC-037' });
    }
    test.info().annotations.push({ type: 'observed', description: reached ? 'TC-037 limit reached' : 'TC-037 limit not reached within cap of 2' });
    await s.goto(PATHS.webForms, page.getByRole('button', { name: 'Add web form' }).first());
    for (const n of names) if (await s.webFormRow(n).count()) { await s.deleteWebForm(n); await expect(s.webFormRow(n)).toHaveCount(0); recordEntity({ type: 'web-form', identifier: n, createdAt: now(), note: 'TC-037 deleted', deleted: true }); }
  });
});
