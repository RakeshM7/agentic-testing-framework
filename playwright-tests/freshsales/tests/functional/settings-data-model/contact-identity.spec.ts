import { test, expect } from '@playwright/test';
import { ContactHelper } from '../../../pages/settings-data-model/ContactHelper';
import { SettingsPage, PATHS } from '../../../pages/settings-data-model/SettingsPage';
import { recordEntity } from '../../../pages/settings-data-model/helpers';

// Contact-save identity rule (any one of Email / Mobile / External ID). full-run: only contacts created here are deleted, by id.
const RUN = Date.now();
const now = () => new Date().toISOString();
const made: string[] = [];

test.describe('Settings data model: contact identity rule (run-created only)', () => {
  test.afterAll(async ({ browser }) => {
    if (!made.length) return;
    const ctx = await browser.newContext({ storageState: test.info().project.use.storageState as string });
    const c = new ContactHelper(await ctx.newPage());
    for (const id of made.splice(0)) await c.deleteById(id, 'afterAll safety net').catch(() => undefined);
    await ctx.close();
  });

  test('TC-settings-data-model-038 save contact with none of Email / Mobile / External ID', async ({ page }) => {
    const c = new ContactHelper(page);
    await c.openAdd();
    const r = await c.fillAndSave({ first: 'ZZ-Explore', last: `NoIdentity${RUN}` }, 'TC-038 (unexpectedly created)');
    if (r) { made.push(r.id); await c.deleteById(r.id, 'TC-038'); made.pop(); }
    expect(r, 'contact without Email/Mobile/External ID must not be created').toBeNull();
    await expect(c.drawerSave).toBeVisible(); // drawer remains open
  });

  test('TC-settings-data-model-039 save contact with only Email, then delete it', async ({ page }) => {
    const c = new ContactHelper(page);
    await c.openAdd();
    const r = await c.fillAndSave({ last: `ZZ-Explore Email Only ${RUN}`, email: `zz-explore-email-${RUN}@example.com` }, 'TC-039');
    expect(r).not.toBeNull();
    made.push(r!.id);
    await expect(page.getByText(`ZZ-Explore Email Only ${RUN}`).first()).toBeVisible();
    await c.deleteById(r!.id, 'TC-039'); made.pop();
  });

  test('TC-settings-data-model-040 save contact with only Mobile, then delete it', async ({ page }) => {
    const c = new ContactHelper(page);
    await c.openAdd();
    const r = await c.fillAndSave({ last: `ZZ-Explore Mobile Only ${RUN}`, mobile: '+14155550142' }, 'TC-040');
    // Live quick-add shows "You need to fill this field" under Email: Email is effectively required there, contradicting the
    // clarification ("either Email / Mobile / External ID"). Kept as a real assertion of the clarified rule.
    expect(r, 'clarified rule: Mobile alone should be enough to save').not.toBeNull();
    made.push(r!.id);
    await expect(page.getByText(`ZZ-Explore Mobile Only ${RUN}`).first()).toBeVisible();
    await c.deleteById(r!.id, 'TC-040'); made.pop();
  });

  test('TC-settings-data-model-041 save contact with only External ID', async ({ page }) => {
    const c = new ContactHelper(page);
    await c.openAdd();
    const hasExt = await page.getByText('External ID', { exact: false }).first().isVisible().catch(() => false);
    test.skip(!hasExt, 'BLOCKED precondition: External ID is not on the Add contact form; adding it would be a tenant layout change to a seeded form.');
  });

  test('TC-settings-data-model-043 delete a lifecycle stage that has contacts: contact falls back to Lead', async ({ page }) => {
    const STAGE = 'ZZ-Explore Stage 2';
    const s = new SettingsPage(page);
    const c = new ContactHelper(page);
    let cid: string | null = null;
    let stageMade = false;
    try {
      await s.goto(PATHS.lifecycle, s.addStageBtn);
      await expect(s.stageCard('Lead')).toBeVisible();
      await s.createStage(STAGE, 'ZZ Open 43', 'ZZ Closed 43');
      await expect(s.stageCard(STAGE)).toBeVisible();
      stageMade = true;
      recordEntity({ type: 'lifecycle-stage', identifier: STAGE, createdAt: now(), note: 'TC-043' });
      await c.openAdd();
      const r = await c.fillAndSave({ last: `ZZ-Explore Stage Contact ${RUN}`, email: `zz-explore-stage-${RUN}@example.com` }, 'TC-043');
      expect(r).not.toBeNull();
      cid = r!.id; made.push(cid);
      // assign the run-created stage to the run-created contact
      await page.locator('xpath=(//*[normalize-space(text())="Lifecycle stage"])[1]/following::h3[1]').click();
      const pick = async (idx: number, option: string) => {
        const opt = page.locator('.ember-power-select-option').filter({ hasText: option }).first();
        await expect(async () => {
          if (!(await opt.isVisible())) await page.locator('.ember-power-select-trigger:visible').nth(idx).click({ timeout: 3_000 });
          await expect(opt).toBeVisible({ timeout: 3_000 });
        }).toPass({ timeout: 25_000 });
        await opt.click();
      };
      await pick(0, STAGE);
      await pick(1, 'ZZ Open 43');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.getByText('Contact updated.')).toBeVisible();
      await page.reload();
      await expect(page.getByText(STAGE).first()).toBeVisible();
      // delete the stage, then re-read the contact
      await s.goto(PATHS.lifecycle, s.addStageBtn);
      await expect(s.stageCard('Lead')).toBeVisible();
      await s.deleteStage(STAGE);
      await expect(s.stageCard(STAGE)).toHaveCount(0);
      stageMade = false;
      recordEntity({ type: 'lifecycle-stage', identifier: STAGE, createdAt: now(), note: 'TC-043 deleted', deleted: true });
      await page.goto(`/crm/sales/contacts/${cid}`);
      // Clarified rule: contacts move to the first lifecycle stage (Lead). Live tenant: the stage header renders blank after the stage is deleted.
      await expect(page.locator('xpath=(//*[normalize-space(text())="Lifecycle stage"])[1]/following::h3[1]')).toHaveText('Lead');
    } finally {
      if (stageMade) { await s.goto(PATHS.lifecycle, s.addStageBtn); await expect(s.stageCard('Lead')).toBeVisible(); await s.deleteStage(STAGE); recordEntity({ type: 'lifecycle-stage', identifier: STAGE, createdAt: now(), note: 'TC-043 deleted in finally', deleted: true }); }
      if (cid) { await c.deleteById(cid, 'TC-043'); made.splice(made.indexOf(cid), 1); }
    }
  });
});
