import { test, expect } from '@playwright/test';
import { ActivitiesPage } from '../../../pages/sales-activities/ActivitiesPage';
import { RUN } from '../../../pages/sales-activities/tracker';

// One throwaway ZZ contact + one throwaway custom type; both are deleted at the end (the type delete also removes its activities).
const LAST = `Act${RUN}`;
const TYPE = `ZZ SA Custom ${RUN}`;

test.describe.serial('Sales activities: call logs and custom activities against a ZZ contact (full-run)', () => {
  let a: ActivitiesPage;
  let contactId = '';
  let typeCreated = false;
  test.beforeEach(({ page }) => { a = new ActivitiesPage(page); });

  test('SETUP create ZZ contact and ZZ custom activity type', async () => {
    contactId = (await a.createZZContact(LAST)).id;
    await a.gotoTypes();
    await a.createType(TYPE);
    typeCreated = true;
  });

  const openCallLog = async () => {
    await a.gotoDashboard();
    await a.openQuickCreate('Add call log');
    await expect(a.dialog.getByText('Call type', { exact: true })).toBeVisible();
  };

  test('TC-sales-activities-034 Call log without Outcome is blocked', async () => {
    await openCallLog();
    await a.pickRecord(a.dialog.getByRole('button', { name: 'Enter last name' }), LAST, `ZZSA ${LAST}`);
    await a.saveBtn(a.dialog).click();
    await expect(a.dialog.getByText("can't be empty")).toBeVisible();
    await expect(a.dialog).toBeVisible();
  });

  test('TC-sales-activities-035 Call log without Name/associated record is blocked', async () => {
    await openCallLog();
    await a.dialog.getByRole('button', { name: 'Select an outcome' }).click();
    await a.dialog.page().getByRole('option', { name: 'Interested', exact: true }).click();
    await a.saveBtn(a.dialog).click();
    await expect(a.dialog).toBeVisible();
  });

  test('TC-sales-activities-019 Save a call log against the ZZ contact', async ({ page }) => {
    await openCallLog();
    await expect(a.dialog.getByRole('button', { name: 'Outgoing' })).toBeVisible();
    await expect(a.dialog.getByRole('button', { name: 'Existing Contact' })).toBeVisible();
    await a.dialog.getByRole('button', { name: 'Select an outcome' }).click();
    await page.getByRole('option', { name: 'Interested', exact: true }).click();
    await a.pickRecord(a.dialog.getByRole('button', { name: 'Enter last name' }), LAST, `ZZSA ${LAST}`);
    await expect(a.dialog.getByRole('button', { name: new RegExp(`ZZSA ${LAST}`) })).toBeVisible();
    await expect(a.dialog.getByRole('button', { name: /Interested/ })).toBeVisible();
    // The first click only blurs the Name combobox in this form; retry until the POST is actually issued (never double-submits).
    const saved = page.waitForResponse(r => r.url().includes('/crm/sales/phone_calls') && r.request().method() === 'POST');
    await expect(async () => {
      if (await a.dialog.count()) await a.saveBtn(a.dialog).click({ timeout: 3000 });
      await expect(a.dialog).toHaveCount(0, { timeout: 2500 });
    }).toPass({ timeout: 15000 });
    expect((await saved).status()).toBe(201);
  });

  test('TC-sales-activities-029 Custom activity with empty form shows Title and Related to errors', async () => {
    await a.gotoDashboard();
    await a.openQuickCreate(`Add ${TYPE}`);
    await expect(a.dialog.getByText('Add sales activity')).toBeVisible();
    await a.saveBtn(a.dialog).click();
    await expect(a.dialog.getByText("can't be empty")).toHaveCount(2);
  });

  test('TC-sales-activities-036 Custom activity without Related to is blocked', async () => {
    await a.gotoDashboard();
    await a.openQuickCreate(`Add ${TYPE}`);
    await a.dialog.getByRole('textbox', { name: 'Title *' }).fill('ZZ SA No Related');
    await a.saveBtn(a.dialog).click();
    await expect(a.dialog.getByText("can't be empty")).toHaveCount(1);
    await expect(a.dialog).toBeVisible();
  });

  test('TC-sales-activities-020 Save a custom activity related to the ZZ contact', async () => {
    await a.gotoDashboard();
    await a.openQuickCreate(`Add ${TYPE}`);
    await a.dialog.getByRole('textbox', { name: 'Title *' }).fill('ZZ SA Custom Activity');
    // Related to is the first power-select multi-input in the form (Collaborators is the second).
    await a.pickRecord(a.dialog.locator('input.ember-power-select-trigger-multiple-input').first(), LAST, `ZZSA ${LAST}`);
    await a.saveBtn(a.dialog).click();
    await expect(a.dialog).toHaveCount(0);
  });

  test('TC-sales-activities-031 Delete the custom type that has activities (activities go with it)', async ({ page }) => {
    await a.gotoTypes();
    await a.typeRow(TYPE).getByRole('button').last().click();
    await expect(a.dialog.getByText('Delete this activity?')).toBeVisible();
    await a.yes.click();
    await expect(a.toast('You deleted the sales activity.')).toBeVisible();
    await expect(a.typeRow(TYPE)).toHaveCount(0);
    const { recordSA } = await import('../../../pages/sales-activities/tracker');
    recordSA({ type: 'sales-activity-type', identifier: TYPE, url: page.url(), note: 'deleted (TC-031)', deleted: true });
    typeCreated = false;
  });

  test.afterAll(async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: test.info().project.use.storageState as string });
    const page = await ctx.newPage();
    const a2 = new ActivitiesPage(page);
    try {
      if (typeCreated) { await a2.gotoTypes(); if (await a2.typeRow(TYPE).count()) await a2.deleteType(TYPE); }
    } catch { /* best effort */ }
    try { if (contactId) await a2.deleteZZContact(contactId); } catch { /* best effort */ }
    await ctx.close();
  });
});
