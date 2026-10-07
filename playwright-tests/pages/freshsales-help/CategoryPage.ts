import { Locator, Page } from '@playwright/test';

export class CategoryPage {
  readonly searchInput: Locator;
  readonly searchButton: Locator;

  constructor(private readonly page: Page) {
    this.searchInput = page.getByRole('textbox', { name: 'Find some solutions here...' });
    this.searchButton = page.getByRole('button', { name: 'Search', exact: true });
  }

  heading(text: string): Locator {
    return this.page.getByRole('main').getByText(text, { exact: true });
  }
}