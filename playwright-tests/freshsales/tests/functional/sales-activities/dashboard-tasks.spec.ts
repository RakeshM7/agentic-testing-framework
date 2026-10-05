import { test, expect } from '@playwright/test';
import { ActivitiesPage } from '../../../pages/sales-activities/ActivitiesPage';
import { RUN } from '../../../pages/sales-activities/tracker';

const TITLE = `ZZ SA Task ${RUN}`;
const NOREL = `ZZ SA Task NoRel ${RUN}`;

test.describe.serial('Sales activities: dashboard and tasks', () => {
  let a: ActivitiesPage;
  test.beforeEach(async ({ page }) => { a = new ActivitiesPage(page); await a.gotoDashboard(); });

  test('TC-sales-activities-001 Activities Dashboard shows task list controls and widgets', async ({ page }) => {
    await expect(page).toHaveURL(/tab=activities/);
    await expect(page.getByRole('button', { name: 'Add task' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add meeting' })).toBeVisible();
    for (const t of ['Open', 'Overdue', 'Completed']) await expect(page.getByText(t, { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'View activity goals' })).toBeVisible();
    for (const t of ['My calendar', 'Quick Links', "Today's summary", 'Freddy AI insights']) {
      await expect(page.getByRole('heading', { name: t, level: 5, exact: true })).toBeVisible();
    }
  });

  test('TC-sales-activities-002 Filter by Due date Tomorrow', async ({ page }) => {
    await expect(a.dueFilter).toContainText('Today');
    await a.dueFilter.click();
    for (const o of ['Today', 'Tomorrow', 'Next 7 days', 'Next 30 days', 'Yesterday', 'Last 7 days', 'Last 30 days', 'Custom period']) {
      await expect(page.getByText(o, { exact: true }).first()).toBeVisible();
    }
    await page.getByText('Tomorrow', { exact: true }).click();
    await expect(a.dueFilter).toContainText(/Tomorrow \(/);
  });

  test('TC-sales-activities-003 Navigate to activity goals', async ({ page }) => {
    await page.getByRole('link', { name: 'View activity goals' }).click();
    await expect(page).toHaveURL(/\/crm\/sales\/activity-goals\/view\//);
    await expect(page.getByRole('button', { name: 'Add goal' }).first()).toBeVisible();
  });

  test('TC-sales-activities-025 / 032 Empty task title is rejected and nothing is created', async ({ page }) => {
    await a.openAddTask();
    await a.saveBtn(a.dialog).click();
    await expect(a.dialog.getByText("can't be empty")).toBeVisible();
    await expect(page.getByText('You added a task.')).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Title*' })).toBeVisible(); // dialog stays open
  });

  test('TC-sales-activities-004 / 033 Add a task without Related to (full-run)', async ({ page }) => {
    await a.addTask(TITLE, 'ZZ SA task description');
    await a.filterDue('Tomorrow');
    await expect(a.taskRow(TITLE)).toHaveCount(1);
    await expect(a.taskRow(TITLE)).toContainText('Follow up');
    await expect(a.taskRow(TITLE).getByRole('button', { name: 'Mark complete' })).toBeVisible();
    await a.addTask(NOREL);
    await a.filterDue('Tomorrow');
    await expect(a.taskRow(NOREL)).toHaveCount(1);
    await expect(page.getByText("can't be empty")).toHaveCount(0);
  });

  test('TC-sales-activities-005 Mark a task complete (Cancel keeps it open, Save completes it)', async ({ page }) => {
    await a.filterDue('Tomorrow');
    const row = a.taskRow(TITLE);
    await row.getByRole('button', { name: 'Mark complete' }).click();
    await expect(page.getByText('You marked the task complete.')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(row.getByRole('button', { name: 'Mark complete' })).toBeVisible();
    await row.getByRole('button', { name: 'Mark complete' }).click();
    await a.saveBtn().click();
    await expect(row).toContainText('Completed');
  });

  test('TC-sales-activities-008 Delete a task (No keeps it, Yes deletes it)', async ({ page }) => {
    await a.filterDue('Tomorrow');
    const row = a.taskRow(TITLE);
    await row.getByRole('button').last().click();
    await page.getByText('Delete', { exact: true }).last().click();
    await expect(a.dialog.getByText('Delete this task?')).toBeVisible();
    await a.no.click();
    await expect(row).toHaveCount(1);
    await a.deleteTask(TITLE);
  });

  test('CLEANUP delete the no-related task created by this suite', async () => {
    await a.filterDue('Tomorrow');
    await a.deleteTask(NOREL);
  });

  test('TC-sales-activities-038 Send SMS shows No provider connected (nothing sent)', async ({ page }) => {
    await a.openQuickCreate('Send SMS');
    await expect(page.getByText('No provider connected')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add an SMS provider' })).toBeVisible();
  });
});
