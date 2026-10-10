import { test, expect, observe, cleanupPending } from '../../../pages/products-quotes/PQ';
import { RUN, record } from '../../../pages/products-quotes/tracker';

/**
 * Document Templates: create/validation/delete (mode: full-run). TC-012, 049-052.
 * Only the ZZ template created here is ever deleted; the sample templates are never opened for change.
 */
test.describe.configure({ mode: 'serial' });

test.setTimeout(120_000);

test.describe('Document Templates (full-run, live)', () => {
  test.afterAll(async ({ browser }, info) => {
    test.setTimeout(300_000);
    await cleanupPending(browser, info.project.use.baseURL as string);
  });

  test('TC-products-quotes-049 create template with blank Template name and blank Quote type', async ({ page, pq }) => {
    await pq.gotoTemplates();
    await expect(page.getByRole('row')).toHaveCount(3); // header + 2 sample templates
    await pq.openCreateTemplate();
    await pq.createButton.click();
    await expect(page.getByText("Can't be empty", { exact: false }).first()).toBeVisible();
    observe(`Blank template error texts: ${(await page.getByText(/can't be empty/i).allInnerTexts()).join(' | ')}`);
    await expect(page.getByText(/can't be empty/i)).toHaveCount(2);
    await pq.gotoTemplates();
    await expect(page.getByRole('row')).toHaveCount(3);
  });

  test('TC-products-quotes-050 create template with blank Template name only', async ({ page, pq }) => {
    await pq.gotoTemplates();
    await pq.openCreateTemplate();
    await pq.pickQuoteType('Quote');
    await pq.createButton.click();
    await expect(page.getByText(/can't be empty/i).first()).toBeVisible();
    observe(`Blank Template name message: ${(await page.getByText(/can't be empty/i).allInnerTexts()).join(' | ')}`);
    await expect(pq.templateNameInput).toBeVisible();
    await pq.cancelButton.click();
  });

  test('TC-products-quotes-051 create template with blank Quote type only', async ({ page, pq }) => {
    const N = `ZZ Blank Type ${RUN}`;
    await pq.gotoTemplates();
    await pq.openCreateTemplate();
    await pq.templateNameInput.fill(N);
    record({ type: 'template', identifier: N, url: '', note: 'TC-051 blank quote type attempt (expected blocked)' });
    await pq.createButton.click();
    await expect(page.getByText(/can't be empty/i).first()).toBeVisible();
    observe(`Blank Quote type message: ${(await page.getByText(/can't be empty/i).allInnerTexts()).join(' | ')}`);
    await expect(pq.templateNameInput).toBeVisible();
    await pq.cancelButton.click();
    await pq.gotoTemplates();
    await expect(pq.templateRow(N)).toHaveCount(0);
  });

  test('TC-products-quotes-052 cancel the Create template drawer', async ({ page, pq }) => {
    const N = `ZZ Cancelled Template ${RUN}`;
    await pq.gotoTemplates();
    await pq.openCreateTemplate();
    await pq.templateNameInput.fill(N);
    await pq.cancelButton.click();
    await expect(pq.templateNameInput).toBeHidden();
    await expect(pq.templateRow(N)).toHaveCount(0);
  });

  test('TC-products-quotes-012 create a document template with valid data and delete it', async ({ page, pq }) => {
    const N = `ZZ Test Template ${RUN}`;
    await pq.gotoTemplates();
    await pq.openCreateTemplate();
    await pq.templateNameInput.fill(N);
    await pq.pickQuoteType('Quote');
    record({ type: 'template', identifier: N, url: '', note: 'TC-012 valid template' });
    await pq.createButton.click();
    await expect(pq.templateNameInput).toBeHidden({ timeout: 20_000 }).catch(() => undefined);
    observe(`URL after Create template: ${new URL(page.url()).pathname}`);
    await pq.gotoTemplates();
    await expect(pq.templateRow(N)).toBeVisible();
    await expect(pq.templateRow(N)).toContainText('Quote');
    await expect(pq.templateRow(N)).toContainText('Rakesh M');
    await pq.deleteTemplate(N);
    await expect(pq.templateRow('Sample Template').first()).toBeVisible();
    await expect(pq.templateRow('Sample Signature Template')).toBeVisible();
  });
});
