import { Page, Locator } from '@playwright/test';
import { DealStage } from './DealDetailPage';

/**
 * Page Object for the Deals Kanban board (`/crm/sales/deals/view/...`).
 * Column names are literal captured text — see
 * `artifacts/rakesh-freshsales-ind-sep21/explore/pages/deals-kanban/dom-snapshot.md`'s
 * "Pipeline stages (Kanban columns, left to right): New, Qualification, Discovery, Demo,
 * Negotiation, Won, Lost."
 */
export class DealsKanbanPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto('/crm/sales/deals');
  }

  /** The Kanban column container for a given stage name. */
  column(stage: DealStage): Locator {
    return this.page.getByRole('heading', { name: stage, exact: true }).locator('xpath=ancestor::*[3]');
  }

  /** The draggable card for a given deal name, scoped to its current column. */
  dealCard(dealName: string): Locator {
    return this.page.getByText(dealName, { exact: true });
  }

  /**
   * Drags a deal's card from its current column into the target stage column.
   * Secondary/nice-to-have interaction (TC-lead-to-deal-pipeline-009, P2) — pill-click on the deal
   * detail page (DealDetailPage.moveToStage) is the primary, required interaction method.
   */
  async dragDealToStage(dealName: string, targetStage: DealStage) {
    await this.dealCard(dealName).dragTo(this.column(targetStage));
  }
}
