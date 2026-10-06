import { test, expect } from '@playwright/test';
import { SettingsPage, PATHS } from '../../../pages/settings-data-model/SettingsPage';
import { recordEntity } from '../../../pages/settings-data-model/helpers';

// full-run: only ZZ-Explore stages created by this suite are deleted. Seeded stages and the two auto-rules are never touched.
const now = () => new Date().toISOString();
const SEEDED = ['Lead', 'Sales Qualified Lead', 'Customer'];

test.describe.serial('Settings data model: lifecycle stages (full-run, run-created only)', () => {
  let s: SettingsPage;
  test.beforeEach(async ({ page }) => { s = new SettingsPage(page); await s.goto(PATHS.lifecycle, s.addStageBtn); await expect(s.stageCard('Lead')).toBeVisible(); });

  test.afterAll(async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: test.info().project.use.storageState as string });
    const page = await ctx.newPage();
    const sp = new SettingsPage(page);
    await sp.goto(PATHS.lifecycle, sp.addStageBtn);
    await expect(sp.stageCard('Lead')).toBeVisible();
    for (let i = 0; i < 5; i++) {
      const left = page.locator('h5', { hasText: /^\s*ZZ-Explore/ });
      if (!(await left.count())) break;
      const name = (await left.first().innerText()).trim();
      await sp.deleteStage(name);
      await expect(sp.stageCard(name)).toHaveCount(0);
      recordEntity({ type: 'lifecycle-stage', identifier: name, createdAt: now(), note: 'removed by cleanup', deleted: true });
    }
    await ctx.close();
  });

  test('TC-settings-data-model-024 add stage with empty name/statuses is blocked', async ({ page }) => {
    await s.openAddStage();
    await s.stageSave.click();
    await expect(s.stageName).toBeVisible(); // drawer stays open: blocked
    await s.stageCancel.click();
    await expect(s.stageName).toHaveCount(0);
    for (const n of SEEDED) await expect(s.stageCard(n)).toHaveCount(1);
    await expect(page.locator('h5', { hasText: /^\s*ZZ-Explore/ })).toHaveCount(0);
  });

  test('TC-settings-data-model-011 create then delete a ZZ-Explore lifecycle stage', async ({ page }) => {
    const N = 'ZZ-Explore Stage';
    await s.openAddStage();
    await expect(s.stageStatusInputs).toHaveCount(2);
    await expect(s.stageDialog.getByText('Closed Lost')).toBeVisible();
    await s.stageName.fill(N);
    await s.stageStatusInputs.nth(0).fill('ZZ Open');
    await s.stageStatusInputs.nth(1).fill('ZZ Closed');
    await s.stageSave.click();
    await expect(s.stageCard(N)).toBeVisible();
    recordEntity({ type: 'lifecycle-stage', identifier: N, createdAt: now(), note: 'TC-011' });
    await expect(page.getByText('ZZ Open', { exact: true })).toBeVisible();
    await expect(page.getByText('ZZ Closed', { exact: true })).toBeVisible();
    await s.deleteStage(N);
    await expect(s.stageCard(N)).toHaveCount(0);
    recordEntity({ type: 'lifecycle-stage', identifier: N, createdAt: now(), note: 'TC-011 deleted', deleted: true });
    await page.reload();
    await expect(s.stageCard('Lead')).toBeVisible();
    await expect(s.stageCard(N)).toHaveCount(0);
    for (const n of SEEDED) await expect(s.stageCard(n)).toHaveCount(1);
    await expect(page.getByText("Whenever a deal is added, change contact's stage to").first()).toBeVisible();
  });

  test('TC-settings-data-model-036 observe lifecycle stage limit (cap 2 stages)', async ({ page }) => {
    const names = ['ZZ-Explore Limit Stage 1', 'ZZ-Explore Limit Stage 2'];
    let reached = false;
    for (const [i, n] of names.entries()) {
      await s.createStage(n, `ZZ Open ${i + 1}`, `ZZ Closed ${i + 1}`); // distinct status names so a block is not a duplicate-status rejection
      const ok = await s.stageName.waitFor({ state: 'hidden', timeout: 12_000 }).then(() => true, () => false);
      if (!ok) { reached = true; const toasts = (await page.locator('[class*=toast],[role=alert]').allInnerTexts()).join(' | ').replace(/\s+/g, ' '); const txt = `toast: ${toasts || '(none)'}; dialog: ` + (await s.stageDialog.innerText()).replace(/\s+/g, ' ').slice(0, 300); test.info().annotations.push({ type: 'observed', description: `TC-036 blocked at ${n}; dialog text: ${txt}` }); await page.screenshot({ path: test.info().outputPath('limit.png') }); await s.stageCancel.click(); break; }
      await expect(s.stageCard(n)).toBeVisible();
      recordEntity({ type: 'lifecycle-stage', identifier: n, createdAt: now(), note: 'TC-036' });
    }
    test.info().annotations.push({ type: 'observed', description: reached ? 'TC-036 limit/validation reached before cap' : 'TC-036 limit not reached within cap of 2' });
    for (const n of names) if (await s.stageCard(n).count()) { await s.deleteStage(n); await expect(s.stageCard(n)).toHaveCount(0); recordEntity({ type: 'lifecycle-stage', identifier: n, createdAt: now(), note: 'TC-036 deleted', deleted: true }); }
  });

  test('TC-settings-data-model-042 disable a stage that has contacts', async () => {
    test.skip(true, 'Not automatable without touching seeded config: the enable/disable toggle exists only on the seeded Lead and Sales Qualified Lead cards; a run-created stage shows no toggle (observed), and seeded stages must never be disabled.');
  });
});
