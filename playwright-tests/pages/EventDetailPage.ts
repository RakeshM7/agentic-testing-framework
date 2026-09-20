import { Page, Locator, expect } from '@playwright/test';

export interface OrderSummary {
  pricePerTicket: number;
  quantity: number;
  lineTotal: number;
  total: number;
}

export interface BookingFormValues {
  fullName?: string;
  email?: string;
  phone?: string;
}

/** Page Object for an event detail page at /events/{id}, including the "Book Tickets" widget. */
export class EventDetailPage {
  readonly decrementButton: Locator;
  readonly incrementButton: Locator;
  readonly fullNameInput: Locator;
  readonly emailInput: Locator;
  readonly phoneInput: Locator;
  readonly confirmBookingButton: Locator;

  constructor(private readonly page: Page) {
    this.decrementButton = page.getByRole('button', { name: '−' });
    this.incrementButton = page.getByRole('button', { name: '+' });
    this.fullNameInput = page.getByPlaceholder('Your full name');
    this.emailInput = page.getByPlaceholder('you@email.com');
    this.phoneInput = page.getByPlaceholder('+91 98765 43210');
    this.confirmBookingButton = page.getByRole('button', { name: 'Confirm Booking' });
  }

  async goto(eventId: number) {
    await this.page.goto(`/events/${eventId}`);
  }

  heading(): Locator {
    return this.page.getByRole('heading', { level: 1 });
  }

  /**
   * Parses the available-seats pair into { available, total }. The DOM renders
   * "Available" (label) and "229 / 500 seats" (value) as two separate sibling
   * text nodes with no ":" joining them — there is no single "AVAILABLE: ..."
   * text node anywhere in the page.
   */
  async getAvailableSeats(): Promise<{ available: number; total: number }> {
    const label = this.page.getByText('Available', { exact: true });
    const text = await label.locator('xpath=following-sibling::p[1]').innerText();
    const match = text.match(/([\d,]+)\s*\/\s*([\d,]+)/);
    if (!match) throw new Error(`Could not parse available-seats text: "${text}"`);
    return { available: Number(match[1].replace(/,/g, '')), total: Number(match[2].replace(/,/g, '')) };
  }

  /**
   * Parses the order summary block into structured numbers. The line-item
   * ("$300 × 1 ticket") and its line total ("$300") are separate sibling
   * <span> text nodes with no "=" joining them; "Total" and its value ("$300")
   * are likewise separate sibling <span> text nodes with no ":" joining them.
   * This is the client-side-computed total the test cases assert on
   * (price/ticket × quantity) — no network call is involved.
   */
  async getOrderSummary(): Promise<OrderSummary> {
    const lineItemSpan = this.page
      .locator('form span')
      .filter({ hasText: /^\$[\d,]+\s*×\s*\d+\s*tickets?$/ });
    const lineText = await lineItemSpan.innerText();
    const lineMatch = lineText.match(/\$([\d,]+)\s*×\s*(\d+)\s*tickets?/);
    if (!lineMatch) throw new Error(`Could not parse order summary line: "${lineText}"`);

    const lineTotalText = await lineItemSpan.locator('xpath=following-sibling::span[1]').innerText();
    const lineTotalMatch = lineTotalText.match(/\$([\d,]+)/);
    if (!lineTotalMatch) throw new Error(`Could not parse line total text: "${lineTotalText}"`);

    const totalLabelSpan = this.page.locator('form span').filter({ hasText: /^Total$/ });
    const totalValueText = await totalLabelSpan.locator('xpath=following-sibling::span[1]').innerText();
    const totalMatch = totalValueText.match(/\$([\d,]+)/);
    if (!totalMatch) throw new Error(`Could not parse total text: "${totalValueText}"`);

    return {
      pricePerTicket: Number(lineMatch[1].replace(/,/g, '')),
      quantity: Number(lineMatch[2]),
      lineTotal: Number(lineTotalMatch[1].replace(/,/g, '')),
      total: Number(totalMatch[1].replace(/,/g, '')),
    };
  }

  async incrementQty(times = 1) {
    for (let i = 0; i < times; i++) {
      if (await this.incrementButton.isDisabled()) return;
      await this.incrementButton.click();
    }
  }

  async decrementQty(times = 1) {
    for (let i = 0; i < times; i++) {
      if (await this.decrementButton.isDisabled()) return;
      await this.decrementButton.click();
    }
  }

  /** Fills only the provided fields, leaving others untouched (for negative/boundary cases). */
  async fillBookingForm(values: BookingFormValues) {
    if (values.fullName !== undefined) await this.fullNameInput.fill(values.fullName);
    if (values.email !== undefined) await this.emailInput.fill(values.email);
    if (values.phone !== undefined) await this.phoneInput.fill(values.phone);
  }

  async clickConfirmBooking() {
    await this.confirmBookingButton.click();
  }

  /**
   * Asserts the booking widget's static shape (header, fields, default state)
   * without submitting. The header renders as three separate DOM nodes —
   * "Book Tickets" (heading), "$1,500" (sibling span), "per ticket" (sibling
   * paragraph) — with no em dash joining them into one text node.
   */
  async expectBookingWidgetVisible(pricePerTicket: number) {
    const heading = this.page.getByRole('heading', { name: 'Book Tickets' });
    await expect(heading).toBeVisible();
    await expect(heading.locator('xpath=following-sibling::span[1]')).toHaveText(
      `$${pricePerTicket.toLocaleString()}`
    );
    await expect(this.page.getByText('per ticket', { exact: true })).toBeVisible();
    await expect(this.fullNameInput).toBeVisible();
    await expect(this.fullNameInput).toHaveValue('');
    await expect(this.emailInput).toBeVisible();
    await expect(this.emailInput).toHaveAttribute('type', 'email');
    await expect(this.phoneInput).toBeVisible();
    await expect(this.phoneInput).toHaveAttribute('type', 'tel');
    await expect(this.confirmBookingButton).toBeVisible();
  }
}
