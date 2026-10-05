import { test, expect } from '../../../fixtures/base';
import { AccountsPage } from '../../../pages/accounts/AccountsPage';

test('Accounts - Add account drawer visual baseline', async ({ page }) => {
  const a = new AccountsPage(page);
  await a.goto();
  await a.openAdd();
  await expect(a.dialog).toHaveScreenshot('add-account-drawer.png');
});
