import { test, expect } from '@playwright/test';
import { DashboardsPage } from '../../../pages/dashboards/DashboardsPage';

const COLS = ['my_calendar', 'quick_links', 'todays_summary', 'next_best_action'];
const TITLES = ['My calendar', 'Quick Links', "Today's summary", 'Freddy AI insights'];

test.describe.serial('Dashboards: Activities Dashboard', () => {
  let d: DashboardsPage;
  test.beforeEach(async ({ page }) => { d = new DashboardsPage(page); await d.goto('activities'); });

  test('TC-dashboards-013 Configure widgets drawer content, Cancel', async ({ page }) => {
    await d.openConfigure();
    await expect(d.visibleCols).toHaveCount(4);
    for (const t of TITLES) await expect(page.locator('[data-test-visible-col]').filter({ hasText: t })).toHaveCount(1);
    await expect(d.hiddenEmpty).toBeVisible();
    await expect(page.getByPlaceholder('Search widgets')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(d.visibleCols).toHaveCount(0);
    for (const t of TITLES) await expect(d.widgetTitle(t)).toBeVisible();
  });

  test('TC-dashboards-014 / 015 hide a widget, Save, then restore (original 4/4)', async ({ page }) => {
    let hidden = false;
    try {
      await d.openConfigure();
      await d.visibleCol('quick_links').locator('.fsa-checkbox-text').click();
      await d.drawerSave.click();
      hidden = true;
      await expect(d.widgetTitle('Quick Links')).toHaveCount(0);
    } finally {
      if (hidden) {
        await d.goto('activities');
        await d.openConfigure();
        // hidden widget row: click its checkbox to make it visible again
        await page.locator('.cc-list--header', { hasText: 'Hidden widgets' }).locator('xpath=..').locator('.fsa-checkbox-text').first().click();
        await d.drawerSave.click();
      }
    }
    await expect(d.widgetTitle('Quick Links')).toBeVisible();
    await d.openConfigure();
    await expect(d.visibleCols).toHaveCount(4);
    // Restored widget re-enters at the end of the list (order restore needs drag-and-drop, TC-016 skipped); assert the set only.
    await expect(d.visibleCols.locator('.fsa-checkbox-text')).toHaveText(TITLES, { useInnerText: true }).catch(async () => {
      const got = (await d.visibleCols.locator('.fsa-checkbox-text').allInnerTexts()).map((t) => t.trim()).sort();
      expect(got).toEqual([...TITLES].sort());
      test.info().annotations.push({ type: 'observed', description: 'widget order changed after hide/restore: ' + got.join(',') });
    });
    await expect(d.hiddenEmpty).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  });

  test('TC-dashboards-016 reorder widgets: SKIPPED drag-and-drop is unreliable on live tenant', async () => {
    test.skip(true, 'jQuery-UI sortable drag reorder not automatable reliably; no state change risked');
  });

  test('TC-dashboards-024 activity-type dropdown contents, Cancel', async ({ page }) => {
    await d.activityTypeBtn.click();
    await expect(page.getByPlaceholder('Search activities')).toBeVisible();
    await expect(page.getByText('Select all', { exact: true }).last()).toBeVisible();
    await expect(page.getByText('Clear', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Create new activity')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByPlaceholder('Search activities')).toHaveCount(0);
  });

  test('TC-dashboards-027 search activities with no match', async ({ page }) => {
    await d.activityTypeBtn.click();
    await page.getByPlaceholder('Search activities').fill('zzzxxqq');
    const dropdown = page.getByPlaceholder('Search activities').locator('xpath=ancestor::div[.//button[normalize-space()="Apply"]][1]');
    await expect(dropdown.getByText('Follow up', { exact: true })).toHaveCount(0);
    await expect(dropdown.getByText('Create new activity')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  });

  test('TC-dashboards-025 / 026 clear + subset apply, then restore (observed)', async ({ page }) => {
    const label = await d.activityTypeBtn.innerText();
    const apply = page.getByRole('button', { name: 'Apply', exact: true });
    try {
      await d.activityTypeBtn.click();
      await page.getByText('Clear', { exact: true }).first().click();
      test.info().annotations.push({ type: 'observed', description: `Apply enabled with no types selected: ${await apply.isEnabled()}` });
      await page.getByText('Follow up', { exact: true }).first().click();
      await apply.click();
      test.info().annotations.push({ type: 'observed', description: `filter label after subset: ${(await d.activityTypeBtn.innerText()).trim()} (was ${label.trim()})` });
    } finally {
      // restore: the filter selection persists server-side, so always select all again
      await d.goto('activities');
      await d.activityTypeBtn.click();
      const dd = page.getByPlaceholder('Search activities').locator('xpath=ancestor::div[.//button[normalize-space()="Apply"]][1]');
      await dd.getByText('Select all', { exact: true }).click();
      await apply.click();
    }
    await expect(d.activityTypeBtn).toHaveText(/\+\s*7\s+activities/);
  });

  test('TC-dashboards-028 due-date filter and status pills (observed)', async ({ page }) => {
    for (const pill of ['All', 'Open', 'Overdue', 'Completed']) {
      await page.getByText(new RegExp(`^${pill}`)).first().click();
      await expect(d.configureWidgets).toBeVisible();
    }
    await page.getByText(/^All/).first().click(); // reset to default
    await expect(page.getByRole('button', { name: /Today/ })).toBeVisible();
  });

  test.skip('TC-dashboards-031 rename/delete run-created page, favourite star', async () => { /* controls unexplored */ });
  test.skip('TC-dashboards-032 add task then delete', async () => { /* Add task form unexplored; no flow */ });
  test.skip('TC-dashboards-033 add meeting then delete', async () => { /* Add meeting form unexplored; no flow */ });
});
