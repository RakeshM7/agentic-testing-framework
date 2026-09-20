import { Page, Locator } from '@playwright/test';

/** Page Object for the "Upcoming Events" listing at /events. */
export class EventsListingPage {
  readonly searchInput: Locator;
  readonly categorySelect: Locator;
  readonly citySelect: Locator;
  readonly noEventsFoundHeading: Locator;
  readonly noEventsFoundBody: Locator;
  readonly clearFiltersButton: Locator;

  constructor(private readonly page: Page) {
    this.searchInput = page.getByPlaceholder(/Search events, venues/);
    // Neither <select> has a data-testid, aria-label, or id (confirmed live) to distinguish
    // Category from City, so DOM order is the only reliable signal — confirmed both live and in
    // explore-agent's dom-snapshot.md: search box, then "All Categories", then "All Cities".
    this.categorySelect = page.locator('select').nth(0);
    this.citySelect = page.locator('select').nth(1);
    // Verified live (read-only search of "zzz-no-match-zzz"): these render as two separate text
    // nodes (heading + paragraph), not one joined string.
    this.noEventsFoundHeading = page.getByText('No events found', { exact: true });
    this.noEventsFoundBody = page.getByText(
      "Try adjusting your filters or search terms to find what you're looking for.",
      { exact: true }
    );
    this.clearFiltersButton = page.getByRole('button', { name: 'Clear filters' });
  }

  async goto() {
    await this.page.goto('/events');
  }

  /**
   * Titles of all currently-visible event cards, in DOM order. Card titles render as an <h3>
   * inside the [data-testid="event-card"] wrapper (confirmed live), so this is scoped to cards
   * and can't accidentally match the same title text in a nav/footer link.
   */
  visibleEventTitles(): Locator {
    return this.page.getByTestId('event-card').locator('h3');
  }

  async getVisibleEventTitles(): Promise<string[]> {
    return this.visibleEventTitles().allTextContents();
  }

  async search(query: string) {
    await this.searchInput.fill(query);
  }

  async clearSearch() {
    await this.searchInput.fill('');
  }

  /**
   * Selects a category by its underlying <option value="..."> (e.g. "Festival", "Concert") —
   * confirmed live to be the plain category name with no emoji, even though the visible label
   * text is emoji-prefixed (e.g. "🎉 Festival"). Pass "" to reset to "All Categories".
   */
  async selectCategory(value: string) {
    await this.categorySelect.selectOption(value);
  }

  /** Selects a city by its <option value="..."> (plain city name, e.g. "Delhi"). Pass "" to reset to "All Cities". */
  async selectCity(value: string) {
    await this.citySelect.selectOption(value);
  }

  /**
   * Clicks the event card itself (the card/image wrapper link) — NOT the
   * separate "Book Now" button — for the event with the given id. Both the
   * card wrapper and the "Book Now" button link to the same href
   * (`/events/{eventId}`); the wrapper is the link without "Book Now" text.
   */
  async clickEventCard(eventId: number) {
    const link = this.page
      .locator(`a[href="/events/${eventId}"]`)
      .filter({ hasNotText: 'Book Now' })
      .first();
    await link.click();
  }

  /** Clicks the standalone "Book Now" button for the event with the given id. */
  async clickBookNow(eventId: number) {
    const link = this.page
      .locator(`a[href="/events/${eventId}"]`)
      .filter({ hasText: 'Book Now' })
      .first();
    await link.click();
  }
}
