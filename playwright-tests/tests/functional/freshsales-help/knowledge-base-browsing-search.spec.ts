import { test, expect } from '@playwright/test';
import { CategoryPage } from '../../../pages/freshsales-help/CategoryPage';
import { SearchResultsPage } from '../../../pages/freshsales-help/SearchResultsPage';
import { SupportHomePage } from '../../../pages/freshsales-help/SupportHomePage';

const categories = [
  {
    id: '001',
    name: 'Getting Started',
    path: '/support/solutions/160486',
    heading: 'Getting Started with Freshsales',
  },
  {
    id: '002',
    name: 'Leads, Contacts, & Accounts',
    path: '/support/solutions/160485',
    heading: 'Leads, Contacts, Accounts, Products, and Custom modules',
  },
  { id: '003', name: 'Deals', path: '/support/solutions/160694', heading: 'Deals' },
  { id: '004', name: 'Admin Settings', path: '/support/solutions/160489', heading: 'Admin Settings' },
];

test.describe('Freshsales Help Center knowledge base @freshsales-help', () => {
  for (const category of categories) {
    test(`TC-knowledge-base-browsing-search-${category.id}: browse ${category.name} landing page`, async ({ page }) => {
      const home = new SupportHomePage(page);
      await home.goto();
      await home.categoryLink(category.path).click();

      const categoryPage = new CategoryPage(page);
      await expect(page).toHaveURL(new RegExp(`${category.path.replaceAll('/', '\\/')}$`));
      await expect(categoryPage.heading(category.heading)).toBeVisible();
      await expect(categoryPage.searchInput).toBeVisible();
    });
  }

  for (const query of ['email', 'deals']) {
    test(`TC-knowledge-base-browsing-search-${query === 'email' ? '005' : '006'}: search for ${query} @unconfirmed-relevance`, async ({
      page,
    }) => {
      const home = new SupportHomePage(page);
      await home.goto();
      await home.search(query);

      const results = new SearchResultsPage(page);
      await expect.soft(results.relevantArticleLinks(query).first()).toBeVisible();
      await expect(results.errorMessage).toHaveCount(0);
    });
  }

  test('TC-knowledge-base-browsing-search-007: handle an empty search @unconfirmed-empty-query-behavior', async ({
    page,
  }) => {
    const home = new SupportHomePage(page);
    await home.goto();
    await home.search();

    const results = new SearchResultsPage(page);
    await expect.soft(results.main).toBeVisible();
    await expect(results.errorMessage).toHaveCount(0);
  });

  test('TC-knowledge-base-browsing-search-008: handle a whitespace-only search @unconfirmed-whitespace-query-behavior', async ({
    page,
  }) => {
    const home = new SupportHomePage(page);
    await home.goto();
    await home.search('   ');

    const results = new SearchResultsPage(page);
    await expect.soft(results.main).toBeVisible();
    await expect(results.errorMessage).toHaveCount(0);
  });

  test('TC-knowledge-base-browsing-search-009: handle a query with no matches @unconfirmed-no-results-copy', async ({
    page,
  }) => {
    const home = new SupportHomePage(page);
    await home.goto();
    await home.search(`zzzz-no-match-${Date.now()}`);

    const results = new SearchResultsPage(page);
    await expect.soft(results.articleLinks).toHaveCount(0);
    await expect.soft(results.noResultsState.first()).toBeVisible();
    await expect(results.errorMessage).toHaveCount(0);
  });
});