import { Page, Locator, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { BasePage } from '../BasePage';

export const SEQ_RUN = `${Date.now()}`;
const ENTITIES = path.join(__dirname, '..', '..', '..', '..', 'artifacts', 'rakesh-freshsales-ind-sep21', 'modules', 'sales-sequences', 'playwright', 'created-entities.json');

export function recordSeq(e: { identifier: string; url?: string; note: string; deleted?: boolean }) {
  fs.mkdirSync(path.dirname(ENTITIES), { recursive: true });
  const list: any[] = fs.existsSync(ENTITIES) ? JSON.parse(fs.readFileSync(ENTITIES, 'utf-8')) : [];
  const idOf = (x: string) => x.match(/\(id (\d+)\)\s*$/)?.[1];
  const i = list.findIndex((x) => x.identifier === e.identifier || (idOf(e.identifier) && idOf(x.identifier) === idOf(e.identifier)));
  const rec = { type: 'sales sequence', createdAt: new Date().toISOString(), ...e };
  if (i >= 0) list[i] = { ...list[i], ...e, ...(e.deleted ? { deletedAt: new Date().toISOString() } : {}) };
  else list.push(rec);
  fs.writeFileSync(ENTITIES, JSON.stringify(list, null, 2) + '\n');
}

export class SequencesPage extends BasePage {
  constructor(page: Page) { super(page); }

  get createBtn(): Locator { return this.page.locator('button', { hasText: 'Create sales sequence' }).first(); }
  get nameInput(): Locator { return this.page.locator('input.text-ellipsis').first(); }
  get pageSave(): Locator { return this.page.locator('[data-test-ss-save-btn]'); }
  get pageSaveStart(): Locator { return this.page.locator('[data-test-ss-savestart-btn]'); }
  get searchBox(): Locator { return this.page.getByPlaceholder('Search sales sequences'); }
  rows(name: string): Locator {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return this.page.locator('tr').filter({ has: this.page.locator('.sequence-title-text', { hasText: new RegExp(`^\\s*${esc}\\s*$`) }) });
  }
  /** Exact-title row (a name that is a prefix of another, e.g. '<x>' vs '<x> - Copy', must not match both). */
  row(name: string): Locator { return this.rows(name).first(); }

  async gotoList() {
    await this.page.goto('/crm/sales/sales-sequences');
    await expect(this.page).toHaveURL(/sales-sequences\/filters/, { timeout: 30_000 });
    await this.dismissNoise();
  }
  async gotoNew() {
    await this.page.goto('/crm/sales/sales-sequences/contact/new');
    await expect(this.pageSave).toBeVisible({ timeout: 30_000 });
    await this.dismissNoise();
  }
  async setName(name: string) {
    await this.nameInput.click();
    await this.nameInput.fill(name);
  }
  async openAddTask() {
    await this.page.getByText('Add task', { exact: true }).locator('visible=true').first().click();
    await expect(this.page.getByText('Follow-up task').first()).toBeVisible();
  }
  get taskDialog(): Locator { return this.page.locator('[role=dialog]').filter({ hasText: 'Enter task details' }); }
  dialogSave(): Locator { return this.taskDialog.getByRole('button', { name: 'Save', exact: true }); }

  /** Creates an Inactive contact sequence with a task step; returns id. Records it immediately. */
  async create(name: string): Promise<string> {
    await this.gotoNew();
    await this.setName(name);
    await this.openAddTask();
    await this.dialogSave().click();
    await this.pageSave.click();
    await expect(this.page).toHaveURL(/sales-sequences\/contact\/\d+/, { timeout: 30_000 });
    const id = this.page.url().match(/contact\/(\d+)/)![1];
    recordSeq({ identifier: `${name} (id ${id})`, url: this.page.url(), note: 'created by sales-sequences Playwright track' });
    return id;
  }

  rowTrigger(name: string): Locator { return this.row(name).locator('.fsa-dropdown-trigger'); }
  async rowAction(name: string, action: 'Edit' | 'Share' | 'Clone' | 'Delete') {
    await expect(this.row(name)).toBeVisible({ timeout: 30_000 });
    await this.rowTrigger(name).click();
    await this.page.getByText(action, { exact: true }).locator('visible=true').first().click();
  }
  get shareDialog(): Locator { return this.page.locator('[role=dialog]').filter({ hasText: 'Share with' }); }
  shareRadio(label: 'Just me' | 'Everyone' | 'Selected users, teams and territories'): Locator {
    return this.shareDialog.locator(`input[data-permission="${label}"]`);
  }
  async pickShare(label: 'Just me' | 'Everyone') {
    await this.shareDialog.locator('.fsa-radio-text', { hasText: new RegExp(`^${label}$`) }).click();
  }
  get confirmDialog(): Locator { return this.page.locator('[role=dialog]').filter({ hasText: /Are you sure/ }); }

  /** Deletes a ZZ-prefixed (run-created) sequence by name via the list. Refuses anything not ZZ-prefixed. */
  async safeDelete(name: string, id?: string) {
    if (!name.startsWith('ZZ Seq')) throw new Error(`refusing to delete non-run sequence ${name}`);
    await this.gotoList();
    const row = this.row(name);
    if (!(await row.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true, () => false))) return false;
    await this.rowAction(name, 'Delete');
    await expect(this.confirmDialog).toContainText('Are you sure you want to delete the sequence?');
    await this.confirmDialog.getByRole('button', { name: 'Yes' }).click();
    await expect(this.rows(name)).toHaveCount(0, { timeout: 20_000 });
    recordSeq({ identifier: id ? `${name} (id ${id})` : name, note: 'deleted via UI', deleted: true });
    return true;
  }
}
