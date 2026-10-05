import { test, expect } from '../../../fixtures/base';
import { AccountsPage } from '../../../pages/accounts/AccountsPage';

test.describe('Accounts - read-only / rejected-before-mutation', () => {
  test('TC-accounts-001 Open Accounts list from left nav @P0', async ({ page }) => {
    await page.goto('/crm/sales/dashboards').catch(() => undefined);
    const a = new AccountsPage(page);
    await a.goto();
    await expect(page).toHaveURL(/\/crm\/sales\/accounts\/view\/\d+/);
    for (const col of ['Name', 'Related contacts', 'Website', 'Phone', 'Number of employees', 'Open deals amount', 'Tags', 'Industry type', 'Sales owner']) {
      await expect(page.getByRole('columnheader', { name: col, exact: true }).first()).toBeVisible();
    }
  });

  test('TC-accounts-002 Switch between account views @P1', async ({ page }) => {
    const a = new AccountsPage(page);
    await a.goto();
    await a.openView('All accounts');
    await expect(page).toHaveURL(/\/accounts\/view\/\d+/);
    await a.openView('Recycle Bin');
    await expect(page.getByText('The Recycle Bin stores deleted records for 90 days before deleting them forever')).toBeVisible();
  });

  test('TC-accounts-034 Create account with empty Name is blocked @P0', async ({ page }) => {
    const a = new AccountsPage(page);
    await a.goto();
    await a.openAdd();
    await a.save();
    await expect(a.dialog.getByText("can't be empty")).toBeVisible();
    await expect(page.getByText('Review 1 field for errors')).toBeVisible();
    await expect(page).not.toHaveURL(/\/accounts\/\d+/);
  });

  test('TC-accounts-035 Invalid Website "not a url" is blocked @P0', async ({ page }) => {
    const a = new AccountsPage(page);
    await a.goto();
    await a.openAdd();
    await a.nameInput.fill('ZZ BadSite Acct 001');
    await a.websiteInput.fill('not a url');
    await a.save();
    await expect(page.getByText('Failed to create Account. The value for website is not in required format.')).toBeVisible();
    await expect(page).not.toHaveURL(/\/accounts\/\d+/);
  });

  test('TC-accounts-046 Name filter needs at least 2 characters @P2', async ({ page }) => {
    const a = new AccountsPage(page);
    await a.goto();
    await page.getByRole('button', { name: 'Filter by' }).click();
    await page.getByText('Add a field to filter').click();
    await page.getByText('Name', { exact: true }).last().click();
    await page.getByRole('textbox').last().fill('Z');
    await expect(page.getByText('Please enter 2 or more characters')).toBeVisible();
  });

  test('TC-accounts-032 Per-page selector offers 10/25/50/100 @P2', async ({ page }) => {
    const a = new AccountsPage(page);
    await a.goto();
    await page.locator('button:has-text("per_page"), [class*="per-page"]').first().click({ timeout: 5_000 }).catch(async () => {
      await page.getByRole('button', { name: /per.?page/i }).click();
    });
    for (const n of ['10', '25', '50', '100']) {
      await expect(page.getByText(n, { exact: true }).last()).toBeVisible();
    }
  });
});
