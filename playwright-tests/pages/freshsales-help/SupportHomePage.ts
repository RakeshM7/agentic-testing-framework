import { Locator, Page } from '@playwright/test';

export class SupportHomePage {
  readonly searchInput: Locator;
  readonly searchButton: Locator;

  constructor(private readonly page: Page) {
    this.searchInput = page.getByRole('textbox', { name: 'Go ahead, ask us anything' });
    this.searchButton = page.getByRole('button', { name: 'Search', exact: true });
  }

  async goto() {
    await this.page.goto('/support/home');
  }

  categoryLink(path: string): Locator {
    return this.page.locator(`a[href$="${path}"]`);
  }

  async search(query?: string) {
    if (query !== undefined) {
      await this.searchInput.fill(query);
    }
    await this.searchButton.click();
  }
}