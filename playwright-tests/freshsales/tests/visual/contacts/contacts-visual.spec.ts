import { test, expect } from '@playwright/test';
import { ContactsModulePage } from '../../../pages/contacts/ContactsModulePage';

test('visual: Add contact drawer (empty)', async ({ page }) => {
  const m = new ContactsModulePage(page);
  await m.gotoList();
  await m.openAdd();
  await expect(page.locator('input[name="contact[firstName]"]')).toBeVisible();
  await expect(page).toHaveScreenshot('add-contact-drawer.png', { clip: { x: 821, y: 0, width: 619, height: 900 }, maxDiffPixelRatio: 0.03 });
});
