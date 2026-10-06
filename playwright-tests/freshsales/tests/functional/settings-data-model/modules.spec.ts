import { test, expect } from '@playwright/test';
import { SettingsPage, PATHS } from '../../../pages/settings-data-model/SettingsPage';

test.describe('Settings data model: custom modules', () => {
  test('TC-settings-data-model-023 add module with empty required fields is blocked', async ({ page }) => {
    const s = new SettingsPage(page);
    await s.goto(PATHS.modules, page.getByText('No custom modules found.'));
    await page.getByRole('button', { name: 'Add module', exact: true }).first().click();
    const singular = page.locator('input[name="moduleSingular"]');
    await expect(singular).toBeVisible();
    await singular.fill('');
    await page.locator('input[name="modulePlural"]').fill('');
    await page.locator('input[name="moduleEntityName"]').fill('');
    await s.btn('Save').click();
    await expect(singular).toBeVisible(); // drawer stays open: blocked
    await s.btn('Cancel').click();
    await expect(singular).toHaveCount(0);
    await expect(page.getByText('No custom modules found.')).toBeVisible();
  });

  test('TC-settings-data-model-009 create then delete a ZZ-Explore custom module', async () => {
    test.skip(true, 'SKIPPED by design: Freshsales documents no way to delete a custom module (only its records/fields), so creating one would leave a permanent tenant leftover. Per the run brief, 009/035 are skipped and recorded.');
  });
  test('TC-settings-data-model-035 observe custom module limit', async () => {
    test.skip(true, 'SKIPPED by design: same reason as TC-009 (custom modules cannot be deleted, so probing the limit would leave permanent modules).');
  });
});
