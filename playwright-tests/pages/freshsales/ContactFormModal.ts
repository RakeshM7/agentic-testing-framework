import { Page, Locator } from '@playwright/test';

export interface ContactFormValues {
  firstName?: string;
  lastName?: string;
  email?: string;
}

/**
 * Page Object for the "Add Contact" quick-create form (opened from the Contacts list toolbar's
 * "Add contact" button — that button label is literal captured text, see
 * `artifacts/rakesh-freshsales-ind-sep21/explore/pages/contacts-list/dom-snapshot.md`).
 *
 * SELECTOR CAVEAT: explore-agent's dom-snapshot for this tenant captures page *text* (button
 * labels, headings, static copy), not a raw HTML/data-testid dump, and this run's own attempt to
 * log in and inspect the live authenticated form was blocked by a reCAPTCHA challenge on the
 * login page (see README.md "Known blocker" and tests/setup/auth.freshsales.setup.ts) — so the
 * exact field labels/DOM structure below were never directly observed this run. The field
 * locators use `getByLabel`, matching standard Freshworks CRM form conventions (labelled inputs),
 * as a best-effort placeholder. Tighten these with `data-testid` or confirmed labels once a
 * human or a future agent run has an authenticated session to inspect the live form against.
 */
export class ContactFormModal {
  readonly firstNameInput: Locator;
  readonly lastNameInput: Locator;
  readonly emailInput: Locator;
  readonly accountInput: Locator;
  readonly saveButton: Locator;

  constructor(private readonly page: Page) {
    this.firstNameInput = page.getByLabel('First Name', { exact: false });
    this.lastNameInput = page.getByLabel('Last Name', { exact: false });
    this.emailInput = page.getByLabel('Email', { exact: false });
    this.accountInput = page.getByLabel('Account', { exact: false });
    this.saveButton = page.getByRole('button', { name: 'Save', exact: true });
  }

  /** Fills only the provided fields, leaving others untouched (for negative/boundary cases). */
  async fillForm(values: ContactFormValues) {
    if (values.firstName !== undefined) await this.firstNameInput.fill(values.firstName);
    if (values.lastName !== undefined) await this.lastNameInput.fill(values.lastName);
    if (values.email !== undefined) await this.emailInput.fill(values.email);
  }

  /**
   * Types a new account name into the Account typeahead and selects the "Add new account"
   * affordance — this exact phrase is quoted verbatim in the clarifications doc's in-scope bullet
   * and in TC-lead-to-deal-pipeline-001's steps, both sourced from explore-agent's live crawl.
   */
  async createAccountInline(accountName: string) {
    await this.accountInput.fill(accountName);
    await this.page.getByText(`Add new account`, { exact: false }).click();
  }

  /**
   * The inline new-account name field shown once "Add new account" is selected. Not directly
   * observed this run (see class-level caveat) — assumes it reuses the typeahead input itself
   * (the typed `accountName` already populates it) rather than opening a distinct field.
   */
  async submit() {
    await this.saveButton.click();
  }

  /** Verified-in-spirit only: expected inline validation text pattern for a required text field. */
  lastNameError(): Locator {
    return this.page.getByText(/this field is required/i).first();
  }

  emailError(): Locator {
    return this.page.getByText(/enter a valid email/i).first();
  }

  accountNameError(): Locator {
    return this.page.getByText(/this field is required/i).first();
  }
}
