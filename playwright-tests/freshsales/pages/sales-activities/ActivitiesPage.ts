import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from '../BasePage';
import { recordSA, isSACreated } from './tracker';

export const DASH = '/crm/sales/my_dashboards?tab=activities';
export const TYPES = '/crm/sales/settings/sales-activity-type';

export class ActivitiesPage extends BasePage {
  constructor(page: Page) { super(page); }

  get dialog(): Locator { return this.page.getByRole('dialog'); }
  get yes(): Locator { return this.page.getByRole('button', { name: 'Yes', exact: true }); }
  get no(): Locator { return this.page.getByRole('button', { name: 'No', exact: true }); }
  get empties(): Locator { return this.page.getByText("can't be empty"); }
  toast(text: string | RegExp): Locator { return this.page.getByText(text).first(); }
  saveBtn(scope?: Locator): Locator { return (scope ?? this.page).getByRole('button', { name: 'Save', exact: true }); }

  // ---------- dashboard ----------
  async gotoDashboard() {
    await this.page.goto(DASH);
    await expect(this.page.getByRole('button', { name: 'Add task' })).toBeVisible({ timeout: 30_000 });
    await this.dismissNoise();
  }
  get dueFilter(): Locator { return this.page.getByRole('button', { name: /\(\w{3} \d{2}\)|^(Next|Last) \d+ days|^Custom period/ }); }
  async filterDue(option: string) {
    await this.dueFilter.click();
    await this.page.getByText(option, { exact: true }).click();
    await expect(this.dueFilter).toContainText(option);
  }
  taskRow(title: string): Locator { return this.page.getByRole('row').filter({ hasText: title }); }
  async openAddTask() {
    await this.page.getByRole('button', { name: 'Add task' }).first().click();
    await expect(this.page.getByRole('textbox', { name: 'Title*' })).toBeVisible();
  }
  async addTask(title: string, description?: string) {
    await this.openAddTask();
    await this.page.getByRole('textbox', { name: 'Title*' }).fill(title);
    if (description) await this.page.getByRole('textbox', { name: 'Start typing the details about the task…' }).fill(description);
    await this.saveBtn(this.dialog).click();
    await expect(this.toast('You added a task.')).toBeVisible();
    recordSA({ type: 'task', identifier: title, url: DASH, note: 'task created by sales-activities suite' });
  }
  async deleteTask(title: string) {
    if (!isSACreated('task', title)) throw new Error(`Refusing to delete task "${title}": not created by this suite`);
    const row = this.taskRow(title);
    await row.getByRole('button').last().click();
    await this.page.getByText('Delete', { exact: true }).last().click();
    await expect(this.dialog.getByText('Delete this task?')).toBeVisible();
    await this.yes.click();
    await expect(this.toast('You deleted the task.')).toBeVisible();
    await expect(row).toHaveCount(0);
    recordSA({ type: 'task', identifier: title, url: DASH, note: 'deleted', deleted: true });
  }

  // ---------- quick create (+) ----------
  async openQuickCreate(item: string) {
    await this.page.locator('li.navbar-add').click();
    await this.page.getByText(item, { exact: false }).filter({ hasText: item }).first().click();
  }

  // ---------- activity types ----------
  async gotoTypes() {
    await this.page.goto(TYPES);
    await expect(this.page.getByRole('heading', { name: 'Sales Activities', level: 4, exact: true })).toBeVisible({ timeout: 30_000 });
    await this.dismissNoise();
  }
  typeRow(name: string): Locator { return this.page.getByRole('row').filter({ hasText: name }); }
  get typeNameInput(): Locator { return this.page.getByPlaceholder(/Facebook chat/); }
  async createType(name: string) {
    await this.page.getByRole('button', { name: 'Create sales activity' }).click();
    await this.typeNameInput.fill(name);
    await this.saveBtn().click();
    await expect(this.toast('You created a sales activity.')).toBeVisible();
    await expect(this.typeRow(name)).toHaveCount(1);
    recordSA({ type: 'sales-activity-type', identifier: name, url: TYPES, note: 'custom type created by suite' });
  }
  async deleteType(name: string) {
    if (!isSACreated('sales-activity-type', name)) throw new Error(`Refusing to delete type "${name}": not created by this suite`);
    const row = this.typeRow(name);
    await row.getByRole('button').last().click();
    await expect(this.dialog.getByText('Delete this activity?')).toBeVisible();
    await this.yes.click();
    await expect(this.toast('You deleted the sales activity.')).toBeVisible();
    await expect(this.typeRow(name)).toHaveCount(0);
    recordSA({ type: 'sales-activity-type', identifier: name, url: TYPES, note: 'deleted', deleted: true });
  }

  // ---------- goals ----------
  async gotoGoals() {
    await this.gotoDashboard();
    await this.page.getByRole('link', { name: 'View activity goals' }).click();
    await expect(this.page).toHaveURL(/\/crm\/sales\/activity-goals\/view\//);
    await expect(this.page.getByRole('button', { name: 'Add goal' }).first()).toBeVisible({ timeout: 30_000 });
    await this.dismissNoise();
  }
  async openAddGoal() {
    await this.page.getByRole('button', { name: 'Add goal' }).first().click();
    await expect(this.dialog.getByText('Add goal')).toBeVisible();
  }

  // ---------- throwaway ZZ contact (Related to for call logs / custom activities) ----------
  async createZZContact(last: string): Promise<{ id: string; full: string }> {
    await this.page.goto('/crm/sales/contacts');
    const email = this.page.locator('input[name="fragments/email-address[value]"]');
    await expect(this.page.locator('button:has-text("Add contact")').first()).toBeVisible({ timeout: 30_000 });
    await this.dismissNoise();
    await expect(async () => {
      if (!(await email.isVisible())) await this.page.locator('button:has-text("Add contact")').first().click();
      await expect(email).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 30_000 });
    await email.fill(`zz.sa.${last}@example.com`);
    await this.page.locator('input[name="contact[firstName]"]').fill('ZZSA');
    await this.page.locator('input[name="contact[lastName]"]').fill(last);
    await this.saveBtn().click();
    await expect(this.page).toHaveURL(/\/crm\/sales\/contacts\/\d+$/);
    const id = this.page.url().match(/contacts\/(\d+)/)![1];
    recordSA({ type: 'contact', identifier: id, url: this.page.url(), note: `ZZSA ${last}` });
    return { id, full: `ZZSA ${last}` };
  }
  async deleteZZContact(id: string) {
    if (!isSACreated('contact', id)) throw new Error(`Refusing to delete contact ${id}: not created by this suite`);
    await this.page.goto(`/crm/sales/contacts/${id}`);
    await expect(this.page.getByText('ZZSA').first()).toBeVisible({ timeout: 30_000 });
    await this.dismissNoise();
    // Kebab is the right-most unlabeled action-bar icon (same fixed position the lead-to-deal suite uses at 1440px).
    await this.page.mouse.click(1403, 119);
    await this.page.locator('.ember-basic-dropdown-content').getByText('Delete', { exact: true }).click();
    await this.page.getByRole('button', { name: /^(Delete|Confirm|Yes)/ }).last().click();
    await expect(this.page).toHaveURL(/\/crm\/sales\/contacts\/view\//);
    recordSA({ type: 'contact', identifier: id, url: `/crm/sales/contacts/${id}`, note: 'deleted', deleted: true });
  }
  /** Search-as-you-type record picker; retries because a new record takes a few seconds to be indexed. */
  async pickRecord(field: Locator, term: string, optionText: string) {
    await expect(async () => {
      await field.click();
      await this.page.keyboard.press('Control+A');
      await this.page.keyboard.type(term, { delay: 30 });
      const opt = this.page.getByRole('option').filter({ hasText: optionText }).first();
      await expect(opt).toBeVisible({ timeout: 4_000 });
      await opt.click();
    }).toPass({ timeout: 60_000, intervals: [2_000] });
  }
}
