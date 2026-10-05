import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage';
import { isRunCreated, recordCreatedEntity, CreatedEntity } from '../utils/createdEntities';

export class DealDetailPage extends BasePage {
  readonly taskTitle: Locator;
  readonly callNotes: Locator;
  readonly noteBox: Locator;

  constructor(page: Page) {
    super(page);
    this.taskTitle = page.locator('input[name="title"]');
    this.callNotes = page.locator('[contenteditable="true"]').first();
    this.noteBox = page.locator('#notes-deal [contenteditable="true"]');
  }

  async goto(url: string) {
    await this.page.goto(url);
    await expect(this.page.getByRole('button', { name: 'Task', exact: true }).first()).toBeVisible();
    await this.dismissNoise();
  }

  async openTaskForm() {
    await this.page.getByRole('button', { name: 'Task', exact: true }).first().click();
    await expect(this.taskTitle).toBeVisible();
  }

  /** Deal page 'Call' is a Freshcaller dialer; the log form hides behind the chevron next to it. */
  async openCallLogForm() {
    await expect(async () => {
      await this.page.getByRole('button', { name: 'Call', exact: true }).first().locator('xpath=following-sibling::*[1]').click();
      await this.page.locator('.ember-basic-dropdown-content').getByText('Add call log').click({ timeout: 3_000 });
      await expect(this.callNotes).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 20_000 });
  }

  /**
   * Deletes a record through the kebab (three-dots) menu in the top action bar. Guarded: refuses to delete
   * anything not recorded in created-entities.json by this suite, and requires the expected name on the page.
   */
  async deleteViaMenu(type: CreatedEntity['type'], id: string, url: string, expectedName: string) {
    if (!id || !isRunCreated(type, id)) throw new Error(`Refusing to delete ${type} ${id}: not created by this suite`);
    await this.page.goto(url);
    await expect(this.page.getByText(expectedName).first()).toBeVisible();
    await this.dismissNoise();
    // The kebab is the right-most icon button of the action bar (no accessible name; fixed position at 1440px).
    await this.page.mouse.click(1403, 119);
    await this.page.locator('.ember-basic-dropdown-content').getByText('Delete', { exact: true }).click();
    await this.page.getByRole('button', { name: /^(Delete|Confirm|Yes)/ }).last().click();
    recordCreatedEntity({ type, identifier: id, url: this.page.url(), createdAt: new Date().toISOString(), note: `${expectedName} deleted by cleanup`, deleted: true });
  }
}
