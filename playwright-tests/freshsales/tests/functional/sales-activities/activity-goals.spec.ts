import { test, expect, Page } from '@playwright/test';
import { ActivitiesPage } from '../../../pages/sales-activities/ActivitiesPage';
import { recordSA, isSACreated } from '../../../pages/sales-activities/tracker';

// Goals use the built-in Task activity (no custom type needed) and are always deleted at the end.
const GOAL_ID = 'Weekly user goal (Rakesh M) for Task, target 100';

test.describe.serial('Sales activities: activity goals', () => {
  let a: ActivitiesPage;
  test.beforeEach(async ({ page }) => { a = new ActivitiesPage(page); await a.gotoGoals(); });

  const rowOf = (page: Page) => page.getByRole('row').filter({ hasText: 'Rakesh M' }).filter({ hasText: 'Task' });

  test('TC-sales-activities-028 Goal with no user is rejected', async ({ page }) => {
    await a.openAddGoal();
    await a.saveBtn(a.dialog).click();
    await expect(a.dialog.getByText("can't be empty")).toBeVisible();
    await expect(page.getByText('You added a goal.')).toHaveCount(0);
  });

  test('TC-sales-activities-021 Add an activity goal (full-run)', async ({ page }) => {
    const existing = await rowOf(page).count();
    test.skip(existing > 0, 'a Task goal for this user already exists (not created by this suite); refusing to touch it');
    await a.openAddGoal();
    await expect(a.dialog.getByRole('radio', { name: 'Weekly' })).toBeChecked();
    await expect(a.dialog.getByRole('spinbutton')).toHaveValue('100');
    await a.dialog.getByRole('searchbox', { name: 'Select users' }).fill('Rakesh');
    await page.getByRole('option', { name: /Rakesh M/ }).first().click();
    await expect(a.dialog.getByRole('button', { name: 'Task', exact: true })).toBeVisible(); // default activity
    await a.saveBtn(a.dialog).click();
    await expect(a.toast('You added a goal.')).toBeVisible();
    recordSA({ type: 'activity-goal', identifier: GOAL_ID, url: page.url(), note: 'goal created by suite' });
    await expect(rowOf(page)).toContainText('Weekly');
    await expect(rowOf(page)).toContainText('0 / 100');
  });

  test('TC-sales-activities-024 Delete the goal created by this suite (No keeps, Yes deletes)', async ({ page }) => {
    test.skip(!isSACreated('activity-goal', GOAL_ID), 'no goal was created by this suite');
    await rowOf(page).getByRole('button').last().click();
    await page.getByText('Delete goal', { exact: true }).click();
    await expect(a.dialog.getByText('Delete this goal?')).toBeVisible();
    await a.no.click();
    await expect(rowOf(page)).toHaveCount(1);
    await rowOf(page).getByRole('button').last().click();
    await page.getByText('Delete goal', { exact: true }).click();
    await a.yes.click();
    await expect(a.toast('You deleted the goal.')).toBeVisible();
    await expect(rowOf(page)).toHaveCount(0);
    recordSA({ type: 'activity-goal', identifier: GOAL_ID, url: page.url(), note: 'deleted', deleted: true });
  });
});
