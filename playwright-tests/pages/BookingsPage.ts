import { Page, Locator } from '@playwright/test';

/** Page Object for /bookings ("My Bookings" — booking management for the authenticated account). */
export class BookingsPage {
  readonly heading: Locator;
  readonly subtitle: Locator;
  readonly clearAllBookingsButton: Locator;
  readonly clearAllBookingsHint: Locator;
  readonly emptyStateHeading: Locator;
  readonly emptyStateBody: Locator;
  readonly browseEventsButton: Locator;

  constructor(private readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'My Bookings' });
    // Verified live: "My Bookings" (h1) and "View and manage all your ticket bookings" (p) are
    // separate DOM nodes, not one em-dash-joined string.
    this.subtitle = page.getByText('View and manage all your ticket bookings', { exact: true });
    this.clearAllBookingsButton = page.getByRole('button', { name: 'Clear all bookings' });
    this.clearAllBookingsHint = page.getByText('Do this often for clean test data.', { exact: true });
    // Verified live: "No bookings yet" (h3) and the descriptive sentence (p) are separate nodes.
    // Scoped by role so it never collides with a "Browse Events" *link* (role=link) elsewhere.
    this.emptyStateHeading = page.getByText('No bookings yet', { exact: true });
    this.emptyStateBody = page.getByText(
      "You haven't booked any events yet. Browse upcoming events and grab your tickets!",
      { exact: true }
    );
    this.browseEventsButton = page.getByRole('button', { name: 'Browse Events' });
  }

  async goto() {
    await this.page.goto('/bookings');
  }
}
