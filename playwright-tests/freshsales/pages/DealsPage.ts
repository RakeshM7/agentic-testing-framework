import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage';

/** Default pipeline stage columns in left-to-right order (observed live; Won/Lost are closing stages, out of scope). */
export const OPEN_STAGES = ['New', 'Qualification', 'Discovery', 'Demo', 'Negotiation'] as const;

export class DealsPage extends BasePage {
  readonly addDealButton: Locator;
  readonly dealName: Locator;
  readonly dealValue: Locator;

  constructor(page: Page) {
    super(page);
    this.addDealButton = page.locator('button:has-text("Add deal")').first();
    this.dealName = page.locator('input[name="deal[name]"]');
    this.dealValue = page.locator('input[name="deal[amount]"]');
  }

  async goto() {
    await this.page.goto('/crm/sales/deals');
    await expect(this.addDealButton).toBeVisible();
    await this.dismissNoise();
  }

  async openAddDeal() {
    // The kanban re-renders while loading and can swallow the first click, so retry click+assert together.
    await expect(async () => {
      await this.addDealButton.click();
      await expect(this.dealName).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 20_000 });
  }

  /** The labelled power-select (Related contact / Related account) inside the Add deal drawer. */
  private selectField(label: string): Locator {
    return this.page.locator('.form-group, .group-field').filter({ has: this.page.getByText(label, { exact: true }) }).last();
  }

  async pickRelated(label: 'Related contact' | 'Related account', search: string) {
    await this.selectField(label).locator('.ember-power-select-trigger').first().click();
    // Fill the dropdown's own search box (typing on the keyboard right after the click can drop the first
    // characters into the form behind it).
    const searchBox = this.page.locator('.ember-power-select-search-input:visible, .ember-power-select-trigger-multiple-input:visible').last();
    await expect(searchBox).toBeVisible();
    await searchBox.fill(search);
    const option = this.page.locator('.ember-power-select-option').filter({ hasText: search }).filter({ hasNotText: /Add new|Create new/ }).first();
    // Results load async ('Loading options...' / 'Add new ...' show first); never pick the 'Add new'/'Create new' entry.
    await expect(option).toBeVisible();
    await option.click();
    // Selection is only committed once the field shows it: contact => chip, account => trigger text.
    await expect(this.selectField(label)).toContainText(search);
  }

  card(name: string): Locator {
    return this.page.locator('.each-kanban-card').filter({ hasText: name });
  }

  /** Kanban body columns, one per open stage, left to right. */
  get columns(): Locator {
    return this.page.locator('.funnel-container');
  }

  /** Index (0-based) of the stage column currently holding the named deal card. */
  async columnIndexOf(name: string): Promise<number> {
    const handles = await this.columns.all();
    for (let i = 0; i < handles.length; i++) {
      if ((await handles[i].locator('.each-kanban-card').filter({ hasText: name }).count()) > 0) return i;
    }
    return -1;
  }

  /** Drags a card into the target column with real mouse events (the board uses a JS drag library). */
  async dragCardToColumn(name: string, targetIndex: number) {
    const card = this.card(name).first();
    const target = this.columns.nth(targetIndex);
    // The board is flaky if a drag starts while it is still hydrating (it can blank out mid-drag), so let it settle.
    await this.page.waitForLoadState('networkidle');
    await expect(this.columns).toHaveCount(7);
    // Scroll the board horizontally first so the target column is on screen, and wait for the scroll to settle.
    await target.scrollIntoViewIfNeeded();
    let prev = -1;
    await expect.poll(async () => {
      const x = (await target.boundingBox())!.x;
      const settled = x === prev;
      prev = x;
      return settled;
    }).toBe(true);
    await expect(card).toBeVisible();
    const from = (await card.boundingBox())!;
    const to = (await target.boundingBox())!;
    const vw = this.page.viewportSize()!.width;
    // Aim at the visible part of the column, near its top (never the bottom edge, where the Won/Lost drop
    // zones appear during a drag).
    const left = Math.max(to.x, 0);
    const right = Math.min(to.x + to.width, vw);
    // Aim in the left part of the column: near the right viewport edge the board auto-scrolls mid-drag and the
    // pointer could end up over the Won/Lost columns.
    const x = Math.min(left + 70, right - 20);
    const y = to.y + 60;
    const m = this.page.mouse;
    await m.move(from.x + from.width / 2, from.y + 20);
    await m.down();
    await m.move(from.x + from.width / 2 + 15, from.y + 30, { steps: 5 });
    await m.move(x, y, { steps: 25 });
    // Safety: only release if the pointer is really over the intended open-stage column (never Won/Lost).
    const overTarget = await target.evaluate((el, p) => document.elementsFromPoint(p.x, p.y).some((e) => el.contains(e)), { x, y }); // the drag ghost sits on top, so check the whole stack
    if (!overTarget) {
      await this.page.keyboard.press('Escape');
      await m.move(from.x + from.width / 2, from.y + 20, { steps: 10 });
      await m.up();
      throw new Error(`Pointer not over target column ${targetIndex}; drag aborted before drop`);
    }
    await m.up();
  }
}
