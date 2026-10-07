import { Page, Locator } from '@playwright/test';

export interface AdminEventRow {
  category: string;
  city: string;
  date: string;
  price: string;
  seats: string;
  actions: string;
}

/**
 * Page Object for /admin/events ("Manage Events") — the admin-only "+ New Event" creation form
 * and the "All Events" table. Per this suite's non-mutation stance, this POM never submits the
 * form (no method fills-and-clicks "+ Add Event"); it only exposes read-only field/table access.
 */
export class AdminEventsPage {
  readonly form: Locator;
  readonly titleInput: Locator;
  readonly addEventButton: Locator;
  readonly tableRows: Locator;

  constructor(private readonly page: Page) {
    this.form = page.getByTestId('admin-event-form');
    this.titleInput = page.getByTestId('event-title-input');
    this.addEventButton = page.getByTestId('add-event-btn');
    this.tableRows = page.getByTestId('event-table-row');
  }

  async goto() {
    await this.page.goto('/admin/events');
  }

  /**
   * Locates the "All Events" table row for the given event title. Uses a substring `hasText`
   * filter (not exact) because the title cell renders the title and its "(Featured)"/"Featured"
   * badge as separate sibling elements within the same <td>, not one joined text node — matching
   * on the title substring alone avoids guessing that concatenation.
   */
  rowByTitle(title: string): Locator {
    return this.tableRows.filter({ hasText: title });
  }

  /**
   * Reads the row's Category/City/Date/Price/Seats/Actions cells verbatim (columns 2-7; column 1
   * is Title, read separately via rowByTitle's own hasText match). Seats is intentionally read as
   * raw text, not asserted exactly by callers, since it's a live, shared-site counter that can
   * change between runs (same caution as the visual-regression spec's seat-count mask).
   */
  async getRowValues(title: string): Promise<AdminEventRow> {
    const cells = this.rowByTitle(title).locator('td');
    const [category, city, date, price, seats, actions] = await Promise.all([
      cells.nth(1).innerText(),
      cells.nth(2).innerText(),
      cells.nth(3).innerText(),
      cells.nth(4).innerText(),
      cells.nth(5).innerText(),
      cells.nth(6).innerText(),
    ]);
    return {
      category: category.trim(),
      city: city.trim(),
      date: date.trim(),
      price: price.trim(),
      seats: seats.trim(),
      actions: actions.trim(),
    };
  }
}
