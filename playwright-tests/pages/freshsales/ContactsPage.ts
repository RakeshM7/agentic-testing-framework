import { Page, Locator } from '@playwright/test';
import { ContactFormModal } from './ContactFormModal';

/**
 * Page Object for the Contacts list (`/crm/sales/contacts`).
 * "Add contact" is literal captured button text (contacts-list dom-snapshot: "Customize table |
 * Import contacts | Add contact").
 */
export class ContactsPage {
  readonly addContactButton: Locator;

  constructor(private readonly page: Page) {
    this.addContactButton = page.getByRole('button', { name: 'Add contact', exact: true });
  }

  async goto() {
    await this.page.goto('/crm/sales/contacts');
  }

  /** Opens the Add Contact quick-create form and returns its Page Object. */
  async openAddContactForm(): Promise<ContactFormModal> {
    await this.addContactButton.click();
    return new ContactFormModal(this.page);
  }

  /**
   * Opens whichever Contact happens to be first in the list — used only by validation-only specs
   * that need *some* existing Contact to reach the "Add deal" form from, where the specific
   * Contact's identity doesn't matter (contacts-list dom-snapshot confirms each row links to
   * `/crm/sales/contacts/<id>`).
   */
  async openFirstContact() {
    await this.page.locator('table a[href*="/crm/sales/contacts/"]').first().click();
  }
}
