import { Page, Locator } from '@playwright/test';

export interface DealFormValues {
  dealName?: string;
  amount?: string;
}

/**
 * Page Object for the "Add Deal" form, opened via the "Add deal" action on a Contact/Account
 * detail page (button label is literal captured text — see contact-detail dom-snapshot's "Top
 * action bar: ... | Add deal | ..." and deals-kanban's toolbar "... | Add deal").
 *
 * SELECTOR CAVEAT: same as ContactFormModal — field-level locators are best-effort
 * (`getByLabel`), not live-verified this run. See that class's doc comment for why.
 */
export class DealFormModal {
  readonly dealNameInput: Locator;
  readonly amountInput: Locator;
  readonly pipelineSelect: Locator;
  readonly saveButton: Locator;

  constructor(private readonly page: Page) {
    this.dealNameInput = page.getByLabel('Deal Name', { exact: false });
    this.amountInput = page.getByLabel('Amount', { exact: false });
    // "Default Pipeline" is the literal pipeline name confirmed in the clarifications doc's
    // grounding reference; this locator targets whatever control displays/selects it.
    this.pipelineSelect = page.getByText('Default Pipeline', { exact: false });
    this.saveButton = page.getByRole('button', { name: 'Save', exact: true });
  }

  /** Fills only the provided fields, leaving others untouched (for negative/boundary cases). */
  async fillForm(values: DealFormValues) {
    if (values.dealName !== undefined) await this.dealNameInput.fill(values.dealName);
    if (values.amount !== undefined) await this.amountInput.fill(values.amount);
  }

  async submit() {
    await this.saveButton.click();
  }

  dealNameError(): Locator {
    return this.page.getByText(/this field is required/i).first();
  }
}
