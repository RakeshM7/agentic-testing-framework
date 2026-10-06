import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from '../BasePage';
import { isConvCreated, markDeleted, recordConv } from './tracker';

export const TEMPLATES_URL = '/crm/sales/conversations/email-templates';
export const MINE_URL = `${TEMPLATES_URL}?filterParam=-301`;

const GROUPS: Record<string, string> = {
  Opens: 'Email Tracking', Clicks: 'Email Tracking', Bounces: 'Email Tracking',
  'Bulk email metrics': 'Bulk Email', 'Bulk emails scheduled': 'Bulk Email', 'Bulk email drafts': 'Bulk Email',
  'All phone calls': 'Phone', Voicemail: 'Phone', 'All SMS': 'SMS', 'SMS Templates': 'SMS',
};

export class ConversationsPage extends BasePage {
  constructor(page: Page) { super(page); }

  async goto(path = '/crm/sales/conversations/awaiting_response') {
    await this.page.goto(path);
    await this.dismissNoise();
  }

  /** Click a left sub-nav link by its exact label and wait for the SPA route. */
  async openFolder(label: string, urlPart?: string | RegExp) {
    const link = this.page.getByRole('link', { name: label, exact: true }).first();
    if (!(await link.isVisible())) {
      // sub-nav groups are collapsible: expand the group that owns this link
      const group = GROUPS[label];
      if (group) await this.page.getByText(group, { exact: true }).first().click();
    }
    await link.click();
    if (urlPart) await expect(this.page).toHaveURL(urlPart);
  }

  async expectSubNav() {
    await expect(this.page.getByRole('link', { name: 'Inbox', exact: true })).toBeVisible();
    await expect(this.page.getByRole('link', { name: 'Email Templates', exact: true })).toBeVisible();
  }

  /** Render check: sub-nav still present and no crash page. */
  async expectRendered() {
    await this.expectSubNav();
    await expect(this.page.getByText(/something went wrong|500|Internal Server Error/i)).toHaveCount(0);
  }

  // ---- Email templates ----
  async gotoTemplates(mine = false) {
    await this.page.goto(mine ? MINE_URL : TEMPLATES_URL);
    await expect(this.createBtn).toBeVisible();
    await this.dismissNoise();
  }

  get createBtn(): Locator { return this.page.getByRole('button', { name: 'Create EMAIL template' }); }
  get drawer(): Locator { return this.page.getByRole('dialog').first(); }
  get nameInput(): Locator { return this.page.locator('input[name="name"]'); }
  get subjectInput(): Locator { return this.page.locator('input[name="subject"]'); }
  get nameError(): Locator { return this.page.getByText('Give a name for your email template.'); }
  get rows(): Locator { return this.page.locator('tbody tr'); }

  row(name: string): Locator { return this.rows.filter({ hasText: name }); }

  async openCreate() {
    await this.createBtn.click();
    await expect(this.nameInput).toBeVisible();
  }

  async typeName(name: string) {
    await this.nameInput.click();
    await this.nameInput.pressSequentially(name, { delay: name.length > 100 ? 2 : 25 });
  }

  /** Cancel can be swallowed while the editor settles: retry until the drawer is gone. */
  async cancelDrawer() {
    await expect(async () => {
      if (await this.nameInput.isVisible()) await this.page.getByRole('button', { name: 'Cancel', exact: true }).click({ timeout: 2_000 });
      await expect(this.nameInput).toBeHidden({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
  }

  async clickSave() { await this.page.locator('.modal').getByRole('button', { name: 'Save', exact: true }).first().click(); }

  /** Creates a ZZ-prefixed template; entity is recorded before Save (so a cut-off run leaves a cleanup trail). */
  async createTemplate(name: string, subject?: string) {
    if (!name.startsWith('ZZ')) throw new Error('refusing to create non-ZZ template');
    await this.openCreate();
    await this.typeName(name);
    if (subject) { await this.subjectInput.click(); await this.subjectInput.pressSequentially(subject, { delay: 20 }); }
    recordConv({ type: 'email-template', identifier: name, url: `${TEMPLATES_URL}?filterParam=-301`, note: 'created via Create template drawer' });
    await this.clickSave();
    await expect(this.nameInput).toBeHidden();
  }

  /** Template list does not refresh in place: reload filtered to own templates. */
  async reloadMine() { await this.gotoTemplates(true); }

  async kebab(name: string) {
    await expect(this.row(name).first()).toBeVisible({ timeout: 20_000 });
    await this.row(name).first().locator('td').last().locator('.fsa-dropdown-trigger').click();
  }

  async menuAction(name: string, action: 'Edit' | 'Clone' | 'Delete') {
    await expect(async () => {
      await this.kebab(name);
      const item = this.page.locator('.ember-basic-dropdown-content').getByText(action, { exact: true }).locator('visible=true').first();
      await item.click({ timeout: 3_000 });
    }).toPass({ timeout: 25_000 });
  }

  async confirmYes() { await this.page.getByRole('button', { name: 'Yes', exact: true }).click(); }

  /** Delete every still-pending run-created template (each row guarded by the tracker; seeded rows can never match). */
  async cleanupPending(pending: string[]) {
    for (let i = 0; i < 40; i++) {
      await this.gotoTemplates(true);
      await this.page.waitForTimeout(1500);
      const names = (await this.rows.locator('td a.strong').allInnerTexts()).map((n) => n.trim());
      const target = names.find((n) => isConvCreated(n));
      if (!target) break;
      await this.menuAction(target, 'Delete');
      await this.confirmYes();
      await expect(this.page.getByText('Are you sure')).toBeHidden({ timeout: 10_000 }).catch(() => undefined);
    }
    await this.gotoTemplates(true);
    await this.page.waitForTimeout(1500);
    const left = (await this.rows.locator('td a.strong').allInnerTexts()).map((n) => n.trim());
    for (const id of pending) if (!left.some((n) => n.startsWith(id))) markDeleted(id);
  }
}
