import { test as base, expect } from '@playwright/test';
import { ContactsPage } from '../pages/ContactsPage';
import { ContactDetailPage } from '../pages/ContactDetailPage';
import { DealDetailPage } from '../pages/DealDetailPage';
import { DealsPage } from '../pages/DealsPage';

type Fixtures = { contactsPage: ContactsPage; contactDetail: ContactDetailPage; dealsPage: DealsPage; dealDetail: DealDetailPage };

export const test = base.extend<Fixtures>({
  contactsPage: async ({ page }, use) => use(new ContactsPage(page)),
  contactDetail: async ({ page }, use) => use(new ContactDetailPage(page)),
  dealDetail: async ({ page }, use) => use(new DealDetailPage(page)),
  dealsPage: async ({ page }, use) => use(new DealsPage(page)),
});
export { expect };
