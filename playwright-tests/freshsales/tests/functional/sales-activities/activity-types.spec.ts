import { test, expect } from '@playwright/test';
import { ActivitiesPage } from '../../../pages/sales-activities/ActivitiesPage';
import { RUN } from '../../../pages/sales-activities/tracker';

const NAME = `ZZ SA Type ${RUN}`;
const RENAMED = `ZZ SA Type R ${RUN}`;

test.describe.serial('Sales activities: activity types settings', () => {
  let a: ActivitiesPage;
  let current = NAME;
  test.beforeEach(async ({ page }) => { a = new ActivitiesPage(page); await a.gotoTypes(); });

  test('TC-sales-activities-009 Default activity types are listed', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Default sales activities', level: 4 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Custom sales activities', level: 4 })).toBeVisible();
    for (const n of ['Task', 'Meeting', 'Phone', 'Email', 'Reminder', 'SMS', 'Chat']) {
      await expect(page.getByRole('row', { name: new RegExp(`^${n}\\b`) }).first()).toBeVisible();
    }
    for (const n of ['Task', 'Meeting', 'Phone']) {
      await expect(page.getByRole('row', { name: new RegExp(`^${n}\\b`) }).first().getByRole('button', { name: 'Edit activity' })).toBeVisible();
    }
    for (const n of ['Email', 'Reminder', 'SMS', 'Chat']) {
      await expect(page.getByRole('row', { name: new RegExp(`^${n}\\b`) }).first().getByRole('button', { name: 'Edit activity' })).toHaveCount(0);
    }
  });

  test("TC-sales-activities-026 Custom type with empty name is rejected", async ({ page }) => {
    await page.getByRole('button', { name: 'Create sales activity' }).click();
    await expect(a.typeNameInput).toBeVisible();
    await a.saveBtn().click();
    await expect(a.empties).toBeVisible();
    await expect(page.getByText('You created a sales activity.')).toHaveCount(0);
  });

  test('TC-sales-activities-010 Create a custom sales activity type (full-run)', async ({ page }) => {
    await a.createType(NAME);
    await expect(a.typeRow(NAME).getByRole('button', { name: 'Edit activity' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Customize fields' })).toBeVisible();
  });

  test('TC-sales-activities-011 Rename a custom type', async ({ page }) => {
    await a.typeRow(NAME).getByRole('button', { name: 'Edit activity' }).click();
    await expect(a.typeNameInput).toHaveValue(NAME);
    await a.typeNameInput.fill(RENAMED);
    await a.saveBtn().click();
    await expect(a.toast('You updated the sales activity.')).toBeVisible();
    await expect(a.typeRow(RENAMED)).toHaveCount(1);
    current = RENAMED;
    // keep tracker in step with the new name
    const { recordSA } = await import('../../../pages/sales-activities/tracker');
    recordSA({ type: 'sales-activity-type', identifier: RENAMED, url: page.url(), note: `renamed from ${NAME}` });
    recordSA({ type: 'sales-activity-type', identifier: NAME, url: page.url(), note: 'renamed', deleted: true });
  });

  test('TC-sales-activities-013 Custom activity fields page', async ({ page }) => {
    await page.getByRole('button', { name: 'Customize fields' }).click();
    await expect(page).toHaveURL(/\/settings\/sales_activities\/forms/);
    await expect(page.getByRole('heading', { name: 'Custom sales activities' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add field' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Manage field dependencies' })).toBeVisible();
  });

  test('TC-sales-activities-015 Field dependencies empty state', async ({ page }) => {
    await page.goto('/crm/sales/settings/sales_activities/field-dependency-configurations');
    await expect(page.getByRole('button', { name: 'Create dependency' }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/You haven.t set any dependencies/)).toBeVisible();
  });

  test('TC-sales-activities-012 Delete a custom type with no activities (No keeps, Yes deletes)', async ({ page }) => {
    await a.typeRow(current).getByRole('button').last().click();
    await expect(a.dialog.getByText("If you delete this activity, data you've collected from this activity will also be deleted permanently.")).toBeVisible();
    await a.no.click();
    await expect(a.typeRow(current)).toHaveCount(1);
    await a.deleteType(current);
  });

  test.afterAll(async ({ browser }) => {
    // safety net: remove any suite-created type left behind by a failed test
    const ctx = await browser.newContext({ storageState: test.info().project.use.storageState as string });
    const page = await ctx.newPage();
    const a2 = new ActivitiesPage(page);
    try {
      await a2.gotoTypes();
      for (const n of [NAME, RENAMED]) {
        if (await a2.typeRow(n).count()) await a2.deleteType(n);
      }
    } catch { /* best effort */ }
    await ctx.close();
  });
});
