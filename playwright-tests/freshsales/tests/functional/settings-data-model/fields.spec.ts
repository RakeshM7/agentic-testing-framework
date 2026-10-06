import { test, expect } from '@playwright/test';
import { SettingsPage, PATHS } from '../../../pages/settings-data-model/SettingsPage';
import { recordEntity } from '../../../pages/settings-data-model/helpers';

// full-run: only ZZ-Explore custom fields created by THIS suite are deleted. Seeded fields are never edited.
const L1 = 'ZZ-Explore Field 1';
const created = new Set<string>();
const now = () => new Date().toISOString();

async function cleanupFields(page: import('@playwright/test').Page, path: string, type: string) {
  const sp = new SettingsPage(page);
  await sp.goto(path, sp.fieldSearch);
  await expect(page.locator('li[data-test-field]').first()).toBeVisible();
  for (let i = 0; i < 6; i++) {
    const left = page.locator('li[data-test-field^="field-ZZ-Explore"]');
    if (!(await left.count())) break;
    const label = ((await left.first().getAttribute('data-test-field')) || '').replace(/^field-/, '');
    await sp.deleteField(label);
    await expect(sp.fieldItem(label)).toHaveCount(0);
    recordEntity({ type, identifier: label, createdAt: now(), note: 'removed by cleanup', deleted: true });
  }
}

test.describe('Settings data model: Contacts custom fields (full-run, run-created only)', () => {
  let s: SettingsPage;
  test.beforeEach(async ({ page }) => { s = new SettingsPage(page); await s.goto(PATHS.contacts, s.fieldSearch); await expect(page.locator('li[data-test-field]').first()).toBeVisible(); });

  test.afterAll(async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: test.info().project.use.storageState as string });
    await cleanupFields(await ctx.newPage(), PATHS.contacts, 'contact-field');
    await ctx.close();
  });

  test('TC-settings-data-model-029 save with empty label / internal name is blocked', async ({ page }) => {
    const before = await page.locator('li[data-test-field]').count();
    await s.openTextFieldForm();
    await s.fieldLabel.fill('');
    await s.fieldFormSave.click();
    await expect(s.fieldLabel).toBeVisible(); // form still open: blocked
    await s.fieldLabel.fill('ZZ-Explore Blocked');
    await s.fieldInternal.fill('');
    await s.fieldFormSave.click();
    await expect(s.fieldLabel).toBeVisible();
    await s.btn('Cancel').click();
    await expect(s.fieldLabel).toHaveCount(0);
    await expect(page.locator('li[data-test-field]')).toHaveCount(before);
    await expect(page.locator('li[data-test-field^="field-ZZ-Explore"]')).toHaveCount(0);
  });

  test('TC-settings-data-model-005 create then delete a ZZ-Explore custom text field', async ({ page }) => {
    await s.openTextFieldForm();
    await s.saveFieldForm(L1);
    await expect(page.getByText('You added 1 field.')).toBeVisible();
    created.add(L1);
    recordEntity({ type: 'contact-field', identifier: L1, createdAt: now(), note: 'TC-005' });
    await expect(s.fieldItem(L1)).toHaveCount(1);
    await expect(s.fieldItem(L1)).toHaveAttribute('data-test-field-name', /^cf_/);
    await s.deleteField(L1);
    await expect(s.fieldItem(L1)).toHaveCount(0);
    recordEntity({ type: 'contact-field', identifier: L1, createdAt: now(), note: 'TC-005 deleted', deleted: true });
    await page.reload();
    await expect(page.locator('li[data-test-field]').first()).toBeVisible();
    await expect(s.fieldItem(L1)).toHaveCount(0);
  });

  test('TC-settings-data-model-030 / 031 duplicate label and duplicate internal name (observe)', async ({ page }) => {
    // 030: seeded label 'Job title' (seeded field is never modified); 031: internal name of a run-created field
    await s.openTextFieldForm();
    await s.saveFieldForm('Job title', 'zz_dup_label');
    const savedDup = await s.fieldLabel.waitFor({ state: 'hidden', timeout: 12_000 }).then(() => true, () => false);
    test.info().annotations.push({ type: 'observed', description: `TC-030 duplicate label 'Job title' ${savedDup ? 'was SAVED' : 'was rejected/blocked'}` });
    if (savedDup) {
      // a field labelled 'Job title' now exists twice: delete only the newer, run-created one via its internal name
      const dup = page.locator('li[data-test-field-name="cf_zz_dup_label"]');
      recordEntity({ type: 'contact-field', identifier: 'Job title (cf_zz_dup_label)', createdAt: now(), note: 'TC-030 duplicate label saved' });
      await dup.scrollIntoViewIfNeeded();
      if (!(await dup.getByRole('button', { name: 'Delete field' }).isVisible())) await dup.locator('.view-more-arrow').click();
      await dup.getByRole('button', { name: 'Delete field' }).click();
      await s.confirmIfAsked();
      await expect(dup).toHaveCount(0);
      recordEntity({ type: 'contact-field', identifier: 'Job title (cf_zz_dup_label)', createdAt: now(), note: 'deleted', deleted: true });
    } else {
      await expect(s.fieldLabel).toBeVisible();
      await s.btn('Cancel').click();
    }
  });

  /** Try to create a ZZ-Explore text field; returns true if saved (toast), false if blocked. Records saved entities immediately. */
  async function tryCreate(page: import('@playwright/test').Page, sp: SettingsPage, label: string, internal: string | undefined, tc: string) {
    await sp.openTextFieldForm();
    await sp.saveFieldForm(label, internal);
    // The editor adds the row optimistically even when validation then blocks the save, so the row is NOT proof of a save.
    // Authoritative signal: the Add field form closes (and the row survives a reload).
    const ok = await sp.fieldLabel.waitFor({ state: 'hidden', timeout: 12_000 }).then(() => true, () => false);
    if (ok) { created.add(label); recordEntity({ type: 'contact-field', identifier: label, createdAt: now(), note: tc }); }
    else if (await sp.fieldLabel.isVisible()) {
      const msg = (await page.locator('#field-ui-form').innerText()).split('\n').map((x) => x.trim()).filter((x) => !/^Make this/.test(x) && /allowed|already|exist|taken|invalid|reserved|limit|required|must|cannot|not /i.test(x)).join(' | ');
      test.info().annotations.push({ type: 'observed', description: `${tc} blocked; validation text: ${msg || '(none captured)'}` });
      await sp.btn('Cancel').click();
    }
    return ok;
  }

  test('TC-settings-data-model-031 duplicate internal name (observe)', async ({ page }) => {
    const A = 'ZZ-Explore Dup A', B = 'ZZ-Explore Dup B';
    expect(await tryCreate(page, s, A, 'zz_dup_internal', 'TC-031 first')).toBe(true);
    const second = await tryCreate(page, s, B, 'zz_dup_internal', 'TC-031 second');
    test.info().annotations.push({ type: 'observed', description: `TC-031 second field with same internal name ${second ? 'was SAVED' : 'was rejected'}` });
    expect(second).toBe(false);
    for (const l of [A, B]) if (await s.fieldItem(l).count()) { await s.deleteField(l); await expect(s.fieldItem(l)).toHaveCount(0); recordEntity({ type: 'contact-field', identifier: l, createdAt: now(), note: 'TC-031 deleted', deleted: true }); }
  });

  test('TC-settings-data-model-032 invalid characters in internal name (observe)', async ({ page }) => {
    const L = 'ZZ-Explore Bad Name';
    const saved = await tryCreate(page, s, L, 'zz bad!name', 'TC-032');
    if (saved) {
      await page.reload(); await expect(page.locator('li[data-test-field]').first()).toBeVisible();
      const name = await s.fieldItem(L).getAttribute('data-test-field-name');
      test.info().annotations.push({ type: 'observed', description: `TC-032 saved; internal name sanitised to: ${name}` });
      await s.deleteField(L); await expect(s.fieldItem(L)).toHaveCount(0);
      recordEntity({ type: 'contact-field', identifier: L, createdAt: now(), note: 'TC-032 deleted', deleted: true });
    } else test.info().annotations.push({ type: 'observed', description: 'TC-032 rejected' });
  });

  test('TC-settings-data-model-033 internal name clashing with a system field (observe)', async ({ page }) => {
    const L = 'ZZ-Explore Email Clash';
    const saved = await tryCreate(page, s, L, 'email', 'TC-033');
    test.info().annotations.push({ type: 'observed', description: `TC-033 clash with 'email' ${saved ? 'was SAVED' : 'was rejected'}` });
    if (saved) { await s.deleteField(L); await expect(s.fieldItem(L)).toHaveCount(0); recordEntity({ type: 'contact-field', identifier: L, createdAt: now(), note: 'TC-033 deleted', deleted: true }); }
    await page.reload(); await expect(page.locator('li[data-test-field]').first()).toBeVisible();
    await expect(page.locator('li[data-test-field="field-Email"]')).toHaveCount(1); // seeded Email untouched
  });

  test('TC-settings-data-model-034 observe custom field limit (cap 3 fields)', async ({ page }) => {
    const labels = ['ZZ-Explore Limit 1', 'ZZ-Explore Limit 2', 'ZZ-Explore Limit 3'];
    let hit = false;
    for (const [i, l] of labels.entries()) {
      const ok = await tryCreate(page, s, l, `zz_limit_${i + 1}`, 'TC-034');
      if (!ok) { hit = true; break; }
    }
    test.info().annotations.push({ type: 'observed', description: hit ? 'TC-034 limit/validation reached before cap' : 'TC-034 limit not reached within cap of 3' });
    for (const l of labels) if (await s.fieldItem(l).count()) { await s.deleteField(l); await expect(s.fieldItem(l)).toHaveCount(0); recordEntity({ type: 'contact-field', identifier: l, createdAt: now(), note: 'TC-034 deleted', deleted: true }); }
  });
});

test.describe.serial('Settings data model: Accounts custom field (full-run, run-created only)', () => {
  const L = 'ZZ-Explore Acct Field 1';
  test.afterAll(async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: test.info().project.use.storageState as string });
    await cleanupFields(await ctx.newPage(), PATHS.accounts, 'account-field');
    await ctx.close();
  });
  test('TC-settings-data-model-006 create then delete a ZZ-Explore custom field on Accounts', async ({ page }) => {
    test.setTimeout(120_000);
    const s = new SettingsPage(page);
    await s.goto(PATHS.accounts, s.fieldSearch);
    await expect(page.locator('li[data-test-field]').first()).toBeVisible();
    await s.openTextFieldForm();
    await s.saveFieldForm(L);
    await expect(page.getByText('You added 1 field.')).toBeVisible();
    recordEntity({ type: 'account-field', identifier: L, createdAt: now(), note: 'TC-006' });
    await expect(s.fieldItem(L)).toHaveCount(1);
    await s.deleteField(L);
    await expect(s.fieldItem(L)).toHaveCount(0);
    recordEntity({ type: 'account-field', identifier: L, createdAt: now(), note: 'TC-006 deleted', deleted: true });
  });
});
