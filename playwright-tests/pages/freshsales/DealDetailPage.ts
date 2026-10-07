import { Page, Locator } from '@playwright/test';
import { TaskFormModal, CallLogFormModal, NoteComposer } from './ActivityForms';
import { waits } from '../../helpers/wait.helper';

/** The Default Pipeline's confirmed stage order (clarifications doc grounding reference). */
export const DEAL_STAGES = [
  'New',
  'Qualification',
  'Discovery',
  'Demo',
  'Negotiation',
  'Won',
  'Lost',
] as const;
export type DealStage = (typeof DEAL_STAGES)[number];

/**
 * Page Object for a Deal detail page (`/crm/sales/deals/<id>`).
 *
 * Literal captured text this class is grounded in (see
 * `artifacts/rakesh-freshsales-ind-sep21/explore/pages/deal-detail-explore-test-co/dom-snapshot.md`):
 * stage names `New -> Qualification -> Discovery -> Demo -> Negotiation` were clicked as pills in
 * "the deal-stage progress bar (top of deal detail page)", each producing a "Deal updated" success
 * toast (exact quoted phrase) and a `PUT /crm/sales/deals/<id>` request. `Won`/`Lost` complete the
 * stage list per the Kanban board's confirmed column order.
 */
export class DealDetailPage {
  readonly successToast: Locator;
  readonly taskButton: Locator;
  readonly callLogButton: Locator;
  readonly addNoteBox: Locator;

  constructor(private readonly page: Page) {
    this.successToast = this.page.getByText('Deal updated', { exact: true });
    this.taskButton = page.getByRole('button', { name: 'Task', exact: true });
    this.callLogButton = page.getByRole('button', { name: 'Call log', exact: true });
    this.addNoteBox = page.getByPlaceholder('Add a note...');
  }

  async goto(dealId: string) {
    await this.page.goto(`/crm/sales/deals/${dealId}`);
  }

  /** The clickable stage pill for a given stage name in the deal-stage progress bar. */
  stagePill(stage: DealStage): Locator {
    return this.page.getByRole('button', { name: stage, exact: true });
  }

  /** Clicks a stage pill and waits for the confirmed "Deal updated" success toast. */
  async moveToStage(stage: DealStage) {
    await this.stagePill(stage).click();
    await waits.forVisible(this.successToast);
  }

  async openTaskForm(): Promise<TaskFormModal> {
    await this.taskButton.click();
    return new TaskFormModal(this.page);
  }

  /** Best-effort — see ActivityForms.ts's CallLogFormModal doc comment (fields unconfirmed). */
  async openCallLogForm(): Promise<CallLogFormModal> {
    await this.callLogButton.click();
    return new CallLogFormModal(this.page);
  }

  noteComposer(): NoteComposer {
    return new NoteComposer(this.page);
  }
}
