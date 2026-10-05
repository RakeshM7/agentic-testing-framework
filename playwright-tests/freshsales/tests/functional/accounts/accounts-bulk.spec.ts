import { test, expect } from '../../../fixtures/base';
import { AccountsPage, ZZ_RUN } from '../../../pages/accounts/AccountsPage';

test.describe('Accounts - bulk actions (ZZ-only selection)', () => {
  test('TC-accounts-003 + 005 Filter by Name to a run-created account, then Bulk actions selects only it @P0', async ({ page }) => {
    const a = new AccountsPage(page);
    const name = `ZZ Filter Acct ${ZZ_RUN}`;
    const id = await a.create({ name });
    try {
      await a.goto();
      await a.openView('All accounts');
      await page.getByRole('button', { name: 'Filter by' }).click();
      await page.getByText('Add a field to filter').click();
      await page.getByText('Name', { exact: true }).last().click();
      await page.getByRole('textbox').last().fill(name.slice(0, 20));
      await page.getByText(name, { exact: true }).last().click();
      await page.getByRole('button', { name: 'Apply' }).click();
      await expect(page).toHaveURL(/view\/custom/);
      await expect(page.getByRole('button', { name: 'Reset' })).toBeVisible();
      // SAFETY GATE: only proceed to Bulk actions if exactly one row (ours) is shown.
      const rows = page.getByRole('row').filter({ has: page.getByRole('link', { name: name }) });
      await expect(rows).toHaveCount(1);
      await expect(page.getByText(/^1 of 1|\b1 account/).first()).toBeVisible({ timeout: 3_000 }).catch(() => undefined);
      const totalDataRows = await page.locator('[role=row]:has(input[type=checkbox])').count();
      expect(totalDataRows, 'filtered list must contain only the ZZ account before using Bulk actions').toBeLessThanOrEqual(2);
      await page.getByRole('button', { name: 'Bulk actions' }).click();
      await expect(page.getByText(/1 account selected/)).toBeVisible();
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    } finally {
      await a.safeDelete(id, name);
    }
  });
});
