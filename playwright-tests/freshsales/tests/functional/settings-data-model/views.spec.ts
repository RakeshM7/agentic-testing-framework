import { test, expect } from '@playwright/test';
import { SettingsPage, PATHS, SEEDED_TAGS, SETTINGS } from '../../../pages/settings-data-model/SettingsPage';

// Read-only views of the data-model settings pages. Nothing here changes tenant data.
test.describe('Settings data model: read-only views', () => {
  let s: SettingsPage;
  test.beforeEach(({ page }) => { s = new SettingsPage(page); });

  test('TC-settings-data-model-001 reach every data-model settings page from Admin Settings', async ({ page }) => {
    const tiles: Array<[string, RegExp]> = [
      ['Contacts', /settings\/contacts\/forms/], ['Accounts', /settings\/sales_accounts\/forms/], ['Custom Modules', /settings\/module-customization/],
      ['Contact Lifecycle Stages', /settings\/lifecycle_stages/], ['Contact Scoring', /settings\/predictive_scoring/], ['Web Forms', /settings\/integrations\/webform\/classic/],
      ['CRM Code Library', /settings\/integrations\/freshsales-web/], ['LinkedIn Lead Gen Forms', /settings\/linkedin-lead-capture/],
    ];
    await s.goto(SETTINGS);
    await page.getByText('Leads, Contacts, & Accounts', { exact: true }).first().click();
    for (const [name, url] of tiles) {
      await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
      await page.getByText(name, { exact: true }).first().click();
      await expect(page).toHaveURL(url);
      await page.goto(SETTINGS);
      await page.getByText('Leads, Contacts, & Accounts', { exact: true }).first().click();
    }
  });

  test('TC-settings-data-model-002 Contacts fields, groups and controls', async ({ page }) => {
    await s.goto(PATHS.contacts, page.getByPlaceholder('Search fields'));
    await expect(page.getByText('Basic information', { exact: true }).first()).toBeVisible();
    for (const f of ['Email', 'First name', 'Last name', 'Account', 'Job title', 'Mobile', 'Work phone', 'Sales owner']) {
      await expect(page.getByText(f, { exact: true }).first()).toBeAttached();
    }
    await expect(s.fieldSearch).toBeVisible();
    for (const b of ['Rename module', 'Preview', 'Add field', 'Add group']) await expect(page.getByRole('button', { name: b, exact: true }).first()).toBeVisible();
    await expect(page.getByText('Manage field dependencies').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit field', exact: true }).first()).toBeVisible();
  });

  test('TC-settings-data-model-003 Accounts fields', async ({ page }) => {
    await s.goto(PATHS.accounts, page.getByPlaceholder('Search fields'));
    await expect(page.getByText('Basic information', { exact: true }).first()).toBeVisible();
    for (const f of ['Name', 'Website', 'Phone', 'Sales owner', 'Industry type', 'Business type', 'Number of employees']) {
      await expect(page.getByText(f, { exact: true }).first()).toBeAttached();
    }
  });

  test('TC-settings-data-model-004 / 007 / 021 Add field drawer, Add selected enablement, Cancel creates nothing', async ({ page }) => {
    await s.goto(PATHS.contacts, page.getByPlaceholder('Search fields'));
    await s.addFieldBtn.click();
    await expect(s.addSelected).toBeVisible();
    await expect(s.addSelected).toBeDisabled(); // TC-021
    await expect(page.getByText(/Select from \d+ available fields/)).toBeVisible();
    for (const t of ['Text field', 'Text area', 'Number', 'Dropdown', 'Checkbox', 'Radio button', 'Date picker', 'Lookup', 'Multiselect', 'URL', 'Formula', 'Auto-number']) {
      await expect(page.getByText(t, { exact: true }).first()).toBeVisible();
    }
    // TC-007: choosing a type enables 'Add selected'
    await page.getByText('Text field', { exact: true }).first().click();
    await expect(s.addSelected).toBeEnabled();
    await s.addSelected.click();
    await expect(s.fieldLabel).toBeVisible();
    await expect(s.fieldLabel).toHaveAttribute('placeholder', 'Give a name for your field');
    await expect(s.fieldInternal).toBeVisible();
    for (const l of ['Make this a required field', 'Show field in quick-add view', 'Make this a read-only field', 'Make this a unique field', "Track this field's edit history"]) {
      await expect(page.getByText(l, { exact: true })).toBeVisible();
    }
    await s.btn('Cancel').click();
    await expect(s.fieldLabel).toHaveCount(0);
  });

  test('TC-settings-data-model-008 Custom Modules empty state and Add module form (Cancel)', async ({ page }) => {
    await s.goto(PATHS.modules, page.getByText('No custom modules found.'));
    await page.getByRole('button', { name: 'Add module', exact: true }).first().click();
    await expect(page.locator('input[name="moduleSingular"]')).toBeVisible();
    await expect(page.locator('input[name="modulePlural"]')).toBeVisible();
    await expect(page.locator('input[name="moduleEntityName"]')).toBeVisible();
    await expect(page.locator('textarea[name="moduleDescription"]')).toBeVisible();
    await s.btn('Cancel').click();
    await expect(page.locator('input[name="moduleSingular"]')).toHaveCount(0);
    await expect(page.getByText('No custom modules found.')).toBeVisible();
  });

  test('TC-settings-data-model-010 lifecycle stages, statuses, rules', async ({ page }) => {
    await s.goto(PATHS.lifecycle, page.getByRole('button', { name: 'Add lifecycle stage' }));
    for (const t of ['Lead', 'Sales Qualified Lead', 'Customer', 'New', 'Contacted', 'Interested', 'Unqualified', 'Qualified', 'Lost', 'Won', 'Churned']) {
      await expect(page.getByText(t, { exact: true }).first()).toBeVisible();
    }
    await expect(page.getByText("Whenever a deal is added, change contact's stage to").first()).toBeVisible();
    await expect(page.getByText("Whenever a deal is won, change contact's stage to").first()).toBeVisible();
  });

  test('TC-settings-data-model-012 / 026 Contact Scoring view, Save settings disabled', async ({ page }) => {
    await s.goto(PATHS.scoring, page.getByText("You’ve not added any signals.").first());
    await expect(page.getByText("You’ve not added any signals.")).toHaveCount(2);
    await expect(page.getByText('Add signal', { exact: true }).first()).toBeVisible();
    for (const t of ['Country', 'Industry type', 'Email', 'Phone']) await expect(page.getByRole('button', { name: t, exact: true }).first()).toBeVisible();
    for (const b of ['Import contacts', 'Import deals', 'Migrate from another CRM']) await expect(page.getByText(b, { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Likely to buy').first()).toBeVisible();
    await expect(s.btn('Save settings')).toBeDisabled();
  });

  test('TC-settings-data-model-013 Web Forms empty state', async ({ page }) => {
    await s.goto(PATHS.webForms, page.getByRole('button', { name: 'Add web form' }).first());
    await expect(page.getByText('No web forms found.')).toBeVisible();
  });

  test('TC-settings-data-model-015 CRM Code Library languages', async ({ page }) => {
    await s.goto(PATHS.codeLibrary, page.getByText('Ruby', { exact: true }).first());
    for (const l of ['Ruby', 'Java', 'PHP', 'Python']) await expect(page.getByText(l, { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Get started' })).toHaveCount(4);
  });

  test('TC-settings-data-model-016 LinkedIn Lead Gen Forms empty state', async ({ page }) => {
    await s.goto(PATHS.linkedin, page.getByText('Add LinkedIn form', { exact: true }).first());
    await expect(page.getByText('Add LinkedIn form', { exact: true }).first()).toBeVisible();
  });

  test('TC-settings-data-model-018 Record Tags list (13 seeded tags)', async ({ page }) => {
    await s.goto(PATHS.tags, s.tagInput);
    for (const t of ['Record Tags', 'Email Template Tags', 'SMS Template Tags', 'File Tags']) await expect(page.getByRole('menuitem', { name: t })).toBeVisible();
    await expect(page.getByText('Enable private suggestions')).toBeVisible();
    await expect(s.tagRows.first()).toBeVisible();
    for (const t of SEEDED_TAGS) await expect(s.tagRow(t)).toHaveCount(1);
  });

  test('TC-settings-data-model-020 other Tags tabs open', async ({ page }) => {
    await s.goto(PATHS.tags, s.tagInput);
    for (const t of ['Email Template Tags', 'SMS Template Tags', 'File Tags']) {
      await page.getByRole('menuitem', { name: t }).click();
      await expect(page.getByRole('menuitem', { name: t })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Tags' })).toBeVisible();
    }
  });

  test('TC-settings-data-model-017 LinkedIn form build/save/delete: BLOCKED', async () => {
    test.skip(true, 'BLOCKED: requires an external LinkedIn authentication; not completable by automation');
  });
  test('TC-settings-data-model-028 non-admin access: BLOCKED', async () => {
    test.skip(true, 'BLOCKED: no non-admin credential supplied');
  });
  test('TC-settings-data-model-027 / 044 LinkedIn form without connection: observe only', async ({ page }) => {
    await s.goto(PATHS.linkedin, page.getByText('Add LinkedIn form', { exact: true }).first());
    test.skip(true, 'Not executed: clicking Add LinkedIn form starts external LinkedIn auth; case 027/044 recorded as BLOCKED precondition');
  });
});
