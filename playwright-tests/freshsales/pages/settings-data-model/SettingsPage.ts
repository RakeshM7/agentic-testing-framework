import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from '../BasePage';

export const SETTINGS = '/crm/sales/settings';
export const PATHS = {
  contacts: `${SETTINGS}/contacts/forms`,
  accounts: `${SETTINGS}/sales_accounts/forms`,
  modules: `${SETTINGS}/module-customization`,
  lifecycle: `${SETTINGS}/lifecycle_stages`,
  scoring: `${SETTINGS}/predictive_scoring`,
  webForms: `${SETTINGS}/integrations/webform/classic`,
  codeLibrary: `${SETTINGS}/integrations/freshsales-web`,
  linkedin: `${SETTINGS}/linkedin-lead-capture`,
  tags: `${SETTINGS}/tags`,
};

export const SEEDED_TAGS = ['Decision maker', 'Industry Expert', 'Influencer', 'High-Value Customer', 'Customer Advocate', 'Key Stakeholder', 'Champion', 'Enterprise', 'Mid-Market', 'Small Business', 'High-Value', 'Low-Value', 'Likely to buy'];

/** Admin Settings data-model pages (fields, modules, lifecycle, tags, forms). Ember app: waits are on visible anchors, never fixed sleeps. */
export class SettingsPage extends BasePage {
  constructor(page: Page) { super(page); }

  async goto(path: string, anchor?: Locator) {
    await this.page.goto(path);
    await (anchor ?? this.page.getByText('Admin Settings', { exact: true }).first()).waitFor();
    await this.dismissNoise();
  }

  btn(name: string): Locator { return this.page.getByRole('button', { name, exact: true }); }

  // Fields (Contacts / Accounts)
  get fieldSearch(): Locator { return this.page.getByPlaceholder('Search fields'); }
  get addFieldBtn(): Locator { return this.page.getByRole('button', { name: 'Add field', exact: true }).first(); }
  get fieldLabel(): Locator { return this.page.locator('input[name="label"]'); }
  get fieldInternal(): Locator { return this.page.locator('input[name="model[internal_name]"]'); }
  get addSelected(): Locator { return this.btn('Add selected'); }
  get fieldFormSave(): Locator { return this.page.locator('button.fsa-btn-primary', { hasText: /^\s*Save\s*$/ }).last(); }
  get toast(): Locator { return this.page.locator('.fsa-toast, .toast, [class*="toast"], [role="alert"]').last(); }

  async openTextFieldForm() {
    await this.addFieldBtn.click();
    await this.page.getByText('Text field', { exact: true }).first().click();
    await this.addSelected.click();
    await expect(this.fieldLabel).toBeVisible();
  }

  fieldRow(label: string): Locator {
    return this.page.locator('.field-item, [class*="field-row"], li, tr').filter({ has: this.page.getByText(label, { exact: true }) });
  }

  // Tags
  get tagInput(): Locator { return this.page.getByPlaceholder('Enter tag name'); }
  get tagAdd(): Locator { return this.page.getByRole('button', { name: 'Add', exact: true }); }
  get tagRows(): Locator { return this.page.locator('table tbody tr'); }
  tagRow(name: string): Locator { return this.page.locator('table tbody tr').filter({ has: this.page.locator('.tag-content', { hasText: new RegExp(`^\\s*${name}\\s*$`) }) }); }

  /** Adds a record tag and records it the moment it exists. */
  async addTag(name: string) {
    await this.tagInput.fill(name);
    await this.tagAdd.click();
    await expect(this.tagRow(name).first()).toBeVisible();
  }

  /** Deletes a (run-created) tag via the row's hover Delete button; confirms if prompted. */
  async deleteTag(name: string) {
    const row = this.tagRow(name).first();
    await row.hover();
    await row.locator('button[data-original-title="Delete"]').click({ force: true });
    await this.confirmIfAsked();
  }

  /** The sortable row <li> of a field in the editor (the inner collapse div shares data-test-field, so scope to li). */
  fieldItem(label: string): Locator { return this.page.locator(`li[data-test-field="field-${label}"]`); }

  /** Fills label (+ optional internal name) in the open Text field form and clicks Save. */
  async saveFieldForm(label: string, internal?: string) {
    await this.fieldLabel.fill(label);
    if (internal !== undefined) await this.fieldInternal.fill(internal);
    await this.fieldFormSave.click();
  }

  /** Deletes a field by label. Hard guard: only ever acts on labels with the ZZ-Explore prefix (run-created). */
  async deleteField(label: string) {
    if (!label.startsWith('ZZ-Explore')) throw new Error(`refusing to delete non run-created field: ${label}`);
    const li = this.fieldItem(label);
    await li.scrollIntoViewIfNeeded();
    const del = li.getByRole('button', { name: 'Delete field' });
    // a just-created field is auto-expanded; only toggle when the actions are not already showing
    if (!(await del.isVisible())) await li.locator('.view-more-arrow').click();
    await del.click();
    await this.confirmIfAsked();
  }

  // Lifecycle stages
  get addStageBtn(): Locator { return this.page.getByRole('button', { name: 'Add lifecycle stage', exact: true }); }
  get stageDialog(): Locator { return this.page.locator('[role=dialog]').filter({ has: this.page.locator('input[name="stageName"]') }); }
  get stageName(): Locator { return this.page.locator('input[name="stageName"]'); }
  get stageStatusInputs(): Locator { return this.stageDialog.locator('input.ember-text-field:not([name="stageName"])'); }
  get stageSave(): Locator { return this.stageDialog.locator('xpath=ancestor::div[contains(@class,"ui-modal")]').getByRole('button', { name: 'Save', exact: true }); }
  get stageCancel(): Locator { return this.stageDialog.locator('xpath=ancestor::div[contains(@class,"ui-modal")]').getByRole('button', { name: 'Cancel', exact: true }); }
  stageCard(name: string): Locator { return this.page.locator('h5', { hasText: new RegExp(`^\\s*${name}\\s*$`) }); }
  /** Seeded stage names; the guard below refuses to delete anything else than ZZ-Explore stages. */
  async openAddStage() { await this.addStageBtn.click(); await expect(this.stageName).toBeVisible(); }
  async createStage(name: string, s1: string, s2: string) {
    await this.openAddStage();
    await this.stageName.fill(name);
    await this.stageStatusInputs.nth(0).fill(s1);
    await this.stageStatusInputs.nth(1).fill(s2);
    await this.stageSave.click();
  }
  async deleteStage(name: string) {
    if (!name.startsWith('ZZ-Explore')) throw new Error(`refusing to delete non run-created stage: ${name}`);
    const card = this.stageCard(name);
    await card.scrollIntoViewIfNeeded();
    await card.hover();
    await this.page.locator(`ul[data-test-stage-operation="${name}"] svg[data-test-btn="delete"]`).click({ force: true });
    await this.confirmIfAsked();
  }

  // Web forms
  get webFormsEmpty(): Locator { return this.page.getByText('No web forms found.'); }
  webFormRow(name: string): Locator { return this.page.locator('table tbody tr').filter({ has: this.page.locator(`a[title="${name}"]`) }); }
  /** Opens the builder, names the form, picks the mandatory hidden Lifecycle stage default (Lead) and saves. Public embedding is never done. */
  async createWebForm(name: string) {
    await this.goto(PATHS.webForms, this.page.getByRole('button', { name: 'Add web form' }).first());
    // the first click can land before the Ember handler is attached: retry until the builder opens
    await expect(async () => {
      if (!/\/new$/.test(this.page.url())) await this.page.getByRole('button', { name: 'Add web form' }).first().click({ timeout: 3_000 });
      // the builder sometimes renders blank on first load: reload it once if the form never appears
      const ready = await this.page.locator('input[name="name"]').waitFor({ timeout: 10_000 }).then(() => true, () => false);
      if (!ready) await this.page.reload();
      await expect(this.page.locator('input[name="name"]')).toBeVisible({ timeout: 15_000 });
    }).toPass({ timeout: 50_000 });
    await this.page.locator('input[name="name"]').fill(name);
    await this.page.getByText('Click to select').first().click();
    await this.page.locator('.ember-power-select-option').filter({ hasText: /^\s*Lead\s*$/ }).click();
    await this.btn('Save').click();
  }
  /** A saved form navigates to .../classic/<id>/edit (the toast is too brief to rely on). */
  async webFormSaved(timeout = 15_000): Promise<boolean> {
    return this.page.waitForURL(/webform\/classic\/\d+\/edit/, { timeout }).then(() => true, () => false);
  }
  async deleteWebForm(name: string) {
    if (!name.startsWith('ZZ-Explore')) throw new Error(`refusing to delete non run-created web form: ${name}`);
    const row = this.webFormRow(name);
    await row.hover();
    await row.locator('.row-actions .fsa-dropdown-trigger').click();
    await this.page.locator('.ember-basic-dropdown-content').getByText('Delete', { exact: true }).click();
    await this.confirmIfAsked();
  }

  /** Clicks the confirmation button if a confirm dialog appears (web forms ask 'Yes'; others delete immediately). Waits, since isVisible() does not. */
  async confirmIfAsked(wait = 4_000) {
    const yes = this.page.getByRole('button', { name: /^(Yes|Confirm|OK)$/ }).last();
    if (await yes.waitFor({ timeout: wait }).then(() => true, () => false)) await yes.click();
  }
}
