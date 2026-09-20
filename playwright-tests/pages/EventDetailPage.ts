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

  /** Parses "AVAILABLE: 8912 / 10000 seats" into { available, total }. */
  async getAvailableSeats(): Promise<{ available: number; total: number }> {
    const text = await this.page.getByText(/AVAILABLE:\s*[\d,]+\s*\/\s*[\d,]+\s*seats/i).innerText();
    const match = text.match(/([\d,]+)\s*\/\s*([\d,]+)/);
    if (!match) throw new Error(`Could not parse available-seats text: "${text}"`);
    return { available: Number(match[1].replace(/,/g, '')), total: Number(match[2].replace(/,/g, '')) };
  }

  /**
   * Parses the order summary block, e.g. "$300 × 1 ticket = $300" + "Total $300",
   * into structured numbers. This is the client-side-computed total the test
   * cases assert on (price/ticket × quantity) — no network call is involved.
   */
  async getOrderSummary(): Promise<OrderSummary> {
    const lineText = await this.page
      .getByText(/\$[\d,]+\s*×\s*\d+\s*tickets?\s*=\s*\$[\d,]+/)
      .innerText();
    const lineMatch = lineText.match(/\$([\d,]+)\s*×\s*(\d+)\s*tickets?\s*=\s*\$([\d,]+)/);
    if (!lineMatch) throw new Error(`Could not parse order summary line: "${lineText}"`);

    const totalText = await this.page.getByText(/^Total\s*\$[\d,]+/).innerText();
    const totalMatch = totalText.match(/\$([\d,]+)/);
    if (!totalMatch) throw new Error(`Could not parse total text: "${totalText}"`);

    return {
      pricePerTicket: Number(lineMatch[1].replace(/,/g, '')),
      quantity: Number(lineMatch[2]),
      lineTotal: Number(lineMatch[3].replace(/,/g, '')),
      total: Number(totalMatch[1].replace(/,/g, '')),
    };
  }

  async incrementQty(times = 1) {
    for (let i = 0; i < times; i++) {
      await this.incrementButton.click();
    }
  }

  async decrementQty(times = 1) {
    for (let i = 0; i < times; i++) {
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

  /** Asserts the booking widget's static shape (header, fields, default state) without submitting. */
  async expectBookingWidgetVisible(pricePerTicket: number) {
    await expect(this.page.getByText(`Book Tickets — $${pricePerTicket.toLocaleString()} per ticket`)).toBeVisible();
    await expect(this.fullNameInput).toBeVisible();
    await expect(this.fullNameInput).toHaveValue('');
    await expect(this.emailInput).toBeVisible();
    await expect(this.emailInput).toHaveAttribute('type', 'email');
    await expect(this.phoneInput).toBeVisible();
    await expect(this.phoneInput).toHaveAttribute('type', 'tel');
    await expect(this.confirmBookingButton).toBeVisible();
  }
}
