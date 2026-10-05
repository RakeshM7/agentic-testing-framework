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
      await a.openNameFilter();
      await page.getByRole('textbox').last().fill(name);
      await page.locator('li[role=option], .select2-result, li.ember-power-select-option').filter({ hasText: new RegExp(`^\\s*${name}\\s*$`, 'i') }).first().click();
      await page.getByRole('button', { name: 'Apply' }).click();
      await expect(page).toHaveURL(/view\/custom/);
      // SAFETY GATE: only proceed to Bulk actions if exactly one row (ours) is shown.
      const names = page.locator('a.display-name');
      await expect(names).toHaveCount(1);
      await expect(names.first()).toHaveText(name);
      await page.getByRole('button', { name: 'Bulk actions' }).click();
      await expect(page.getByText(/1 account selected/)).toBeVisible();
      // no bulk action is executed; leaving the page discards the selection (Cancel is clipped off-screen, see TC-033 flag)
    } finally {
      await a.resetFilter().catch(() => undefined);
      await a.safeDelete(id, name);
    }
  });
});
