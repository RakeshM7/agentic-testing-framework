import { Locator, Page } from '@playwright/test';

export class SearchResultsPage {
  readonly main: Locator;
  readonly articleLinks: Locator;
  readonly errorMessage: Locator;
  readonly noResultsState: Locator;

  constructor(page: Page) {
    this.main = page.getByRole('main');
    this.articleLinks = this.main.locator('a[href*="/support/solutions/articles/"]');
    this.errorMessage = page.getByText(/internal server error|application error|something went wrong/i);
    this.noResultsState = this.main.getByRole('img', { name: 'no results' });
  }

  relevantArticleLinks(query: string): Locator {
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return this.articleLinks.filter({ hasText: new RegExp(escapedQuery, 'i') });
  }
}