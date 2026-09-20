import { Page } from '@playwright/test';

/** Page Object for the "Upcoming Events" listing at /events. */
export class EventsListingPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto('/events');
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
