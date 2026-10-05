import { test, expect } from '@playwright/test';
import { ActivitiesPage } from '../../../pages/sales-activities/ActivitiesPage';

// Non-mutating meeting-form checks only: nothing is saved, so no invitation e-mails can be sent.
test.describe('Sales activities: meeting form (no save)', () => {
  let a: ActivitiesPage;
  test.beforeEach(async ({ page }) => { a = new ActivitiesPage(page); await a.gotoDashboard(); });

  test('TC-sales-activities-017 Add meeting form shows its fields; Cancel saves nothing', async ({ page }) => {
    await page.getByRole('button', { name: 'Add meeting' }).first().click();
    await expect(a.dialog.getByText('Add meeting').first()).toBeVisible();
    for (const t of ['All day', 'Time zone', 'Location', 'Attendees', 'Related to']) {
      await expect(a.dialog.getByText(t).first()).toBeVisible();
    }
    await a.dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(a.dialog).toHaveCount(0);
  });

  test('TC-sales-activities-027 Meeting with empty title is rejected', async ({ page }) => {
    await page.getByRole('button', { name: 'Add meeting' }).first().click();
    await expect(a.dialog.getByText('Add meeting').first()).toBeVisible();
    await a.saveBtn(a.dialog).click();
    await expect(a.dialog.getByText("can't be empty").first()).toBeVisible();
    await expect(a.dialog).toBeVisible();
    await a.dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  });

  // Not automated in this run (documented, reported as skipped):
  test.skip('TC-sales-activities-018/037/048 Save a meeting (with attendees / without Related to)', async () => {
    // Saving meetings may e-mail attendees; excluded to guarantee no invitations are sent.
  });
  test.skip('TC-sales-activities-030 Non-admin cannot create/edit types or goals', async () => {
    // Needs a second (non-admin) tenant user, which the run-config does not provide; user invites are out of scope.
  });
  test.skip('TC-sales-activities-041 Maximum number of custom activity types', async () => {
    // Would create many types against the shared tenant; excluded.
  });
});
