import { Page, Locator } from '@playwright/test';
import { DealFormModal } from './DealFormModal';

/**
 * Page Object for a Contact detail page (`/crm/sales/contacts/<id>`).
 *
 * Literal captured text this class is grounded in (see
 * `artifacts/rakesh-freshsales-ind-sep21/explore/pages/contact-detail-explore-agenttestlead/dom-snapshot.md`):
 * "Lifecycle stage: Sales Qualified Lead", "Status pipeline: New -> Contacted -> Interested ->
 * Qualified (current) -> Won / Churned", and the top action bar's "Email | Call log | Task |
 * Meeting | Sales activities (dropdown) | Add deal | ... (kebab menu)".
 *
 * SELECTOR CAVEAT: that dom-snapshot is a text-content summary, not a raw DOM/data-testid dump,
 * and this run's live authenticated session was blocked (see README.md "Known blocker") before
 * this page could be inspected directly. `statusPill`/`lifecycleStageValue` below use a
 * best-effort "label text, then nearest value" pattern rather than asserting a single joined
 * string like "Lifecycle stage: Sales Qualified Lead" — per this agent's own hard rule against
 * reconstructing compound display strings that were never confirmed as a single DOM text node.
 * The exact status-change interaction (dropdown vs. clickable pill) is likewise a best-effort
 * guess and should be tightened once a real authenticated session is available.
 */
export class ContactDetailPage {
  readonly statusPill: Locator;
  readonly lifecycleStageValue: Locator;
  readonly addDealButton: Locator;
  readonly taskButton: Locator;
  readonly callLogButton: Locator;
  readonly addNoteBox: Locator;

  constructor(private readonly page: Page) {
    // Best-effort: the current Status value is presumed rendered as a clickable badge/pill near a
    // "Status" label — clicking it is assumed to open a menu of the pipeline values captured
    // above (New / Contacted / Interested / Qualified / Won / Churned).
    this.statusPill = page.getByText('Status', { exact: false }).locator('xpath=following::*[1]');
    this.lifecycleStageValue = page
      .getByText('Lifecycle stage', { exact: false })
      .locator('xpath=following::*[1]');
    this.addDealButton = page.getByRole('button', { name: 'Add deal', exact: true });
    this.taskButton = page.getByRole('button', { name: 'Task', exact: true });
    this.callLogButton = page.getByRole('button', { name: 'Call log', exact: true });
    // Literal captured text: "[Add a note...] box in the right rail."
    this.addNoteBox = page.getByPlaceholder('Add a note...');
  }

  async goto(contactId: string) {
    await this.page.goto(`/crm/sales/contacts/${contactId}`);
  }

  /** Opens the Status menu and selects the given pipeline value (e.g. "Qualified"). */
  async setStatus(status: string) {
    await this.statusPill.click();
    await this.page.getByRole('option', { name: status, exact: true }).click();
  }

  /** Opens the "Add Deal" form from this Contact's detail page and returns its Page Object. */
  async openAddDealForm(): Promise<DealFormModal> {
    await this.addDealButton.click();
    return new DealFormModal(this.page);
  }
}
