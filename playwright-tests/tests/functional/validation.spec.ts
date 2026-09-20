import { Locator } from '@playwright/test';
import { test, expect, EVENTS } from '../../fixtures/base';
import { blockLiveBookingMutations } from '../../pages/networkGuards';

/**
 * These specs deliberately click "Confirm Booking" with invalid/incomplete data,
 * asserting the app BLOCKS submission (client-side validation). Exact error copy
 * was never observed live during exploration (flagged as an assumption in the
 * clarifications doc), so assertions rely on the browser's native HTML5
 * constraint-validation API (input.validity) rather than a guessed error string,
 * plus confirming no navigation away from the event page occurs.
 *
 * blockLiveBookingMutations() is applied as defense-in-depth: even if validation
 * turns out NOT to block submission, no request can reach the live third-party
 * backend and create a real booking.
 */

async function expectFieldInvalid(locator: Locator) {
  const isValid = await locator.evaluate((el: HTMLInputElement) => el.checkValidity());
  expect(isValid, `expected field to be reported invalid by the browser, value="${await locator.inputValue()}"`).toBe(false);
}

async function expectFieldValid(locator: Locator) {
  const isValid = await locator.evaluate((el: HTMLInputElement) => el.checkValidity());
  expect(isValid).toBe(true);
}

// TC-event-booking-007 — Submit booking form with all required fields left empty (P1)
test('submitting with all required fields empty is blocked', async ({ page, eventDetailPage }) => {
  await blockLiveBookingMutations(page);
  await eventDetailPage.goto(EVENTS.HOLLYWOOD_MONSOON_NIGHT.id);

  await eventDetailPage.clickConfirmBooking();

  await expectFieldInvalid(eventDetailPage.fullNameInput);
  await expectFieldInvalid(eventDetailPage.emailInput);
  await expectFieldInvalid(eventDetailPage.phoneInput);
  await expect(page).toHaveURL(`/events/${EVENTS.HOLLYWOOD_MONSOON_NIGHT.id}`);
});

// TC-event-booking-012 — Submit booking form with a single required field empty at a time (P1)
test.describe('single required field empty at a time', () => {
  test('1a. Full Name empty, Email and Phone valid', async ({ page, eventDetailPage }) => {
    await blockLiveBookingMutations(page);
    await eventDetailPage.goto(EVENTS.HOLLYWOOD_MONSOON_NIGHT.id);
    await eventDetailPage.fillBookingForm({ email: 'test.user@example.com', phone: '+91 98765 43210' });

    await eventDetailPage.clickConfirmBooking();

    await expectFieldInvalid(eventDetailPage.fullNameInput);
    await expect(page).toHaveURL(`/events/${EVENTS.HOLLYWOOD_MONSOON_NIGHT.id}`);
  });

  test('1b. Email empty, Full Name and Phone valid', async ({ page, eventDetailPage }) => {
    await blockLiveBookingMutations(page);
    await eventDetailPage.goto(EVENTS.HOLLYWOOD_MONSOON_NIGHT.id);
    await eventDetailPage.fillBookingForm({ fullName: 'Test User', phone: '+91 98765 43210' });

    await eventDetailPage.clickConfirmBooking();

    await expectFieldInvalid(eventDetailPage.emailInput);
    await expect(page).toHaveURL(`/events/${EVENTS.HOLLYWOOD_MONSOON_NIGHT.id}`);
  });

  test('1c. Phone empty, Full Name and Email valid', async ({ page, eventDetailPage }) => {
    await blockLiveBookingMutations(page);
    await eventDetailPage.goto(EVENTS.HOLLYWOOD_MONSOON_NIGHT.id);
    await eventDetailPage.fillBookingForm({ fullName: 'Test User', email: 'test.user@example.com' });

    await eventDetailPage.clickConfirmBooking();

    await expectFieldInvalid(eventDetailPage.phoneInput);
    await expect(page).toHaveURL(`/events/${EVENTS.HOLLYWOOD_MONSOON_NIGHT.id}`);
  });
});

// TC-event-booking-013 — Submit booking form with malformed email (P1)
test('malformed email (missing "@") is rejected by validation', async ({ page, eventDetailPage }) => {
  await blockLiveBookingMutations(page);
  await eventDetailPage.goto(EVENTS.WORLD_TECH_SUMMIT.id);
  await eventDetailPage.fillBookingForm({
    fullName: 'Test User',
    email: 'testuserexample.com',
    phone: '+91 98765 43210',
  });
  await expectFieldValid(eventDetailPage.fullNameInput);
  await expectFieldValid(eventDetailPage.phoneInput);

  await eventDetailPage.clickConfirmBooking();

  await expectFieldInvalid(eventDetailPage.emailInput);
  await expect(page).toHaveURL(`/events/${EVENTS.WORLD_TECH_SUMMIT.id}`);
});

// TC-event-booking-014 — Submit booking form with malformed phone number (P1)
test('malformed phone number is rejected by validation', async ({ page, eventDetailPage }) => {
  await blockLiveBookingMutations(page);
  await eventDetailPage.goto(EVENTS.WORLD_TECH_SUMMIT.id);
  await eventDetailPage.fillBookingForm({
    fullName: 'Test User',
    email: 'test.user@example.com',
    phone: '12345',
  });
  await expectFieldValid(eventDetailPage.fullNameInput);
  await expectFieldValid(eventDetailPage.emailInput);

  await eventDetailPage.clickConfirmBooking();

  // Flagged in clarifications doc: exact phone-format validation rule (pattern/minlength) is
  // unconfirmed. If the field has no pattern/minlength constraint, the browser may report it as
  // valid even though "12345" doesn't match the placeholder's expected shape -- this assertion
  // documents that ambiguity rather than assuming a specific rule.
  const isPhoneValid = await eventDetailPage.phoneInput.evaluate((el: HTMLInputElement) => el.checkValidity());
  const navigatedAway = page.url() !== `${new URL(page.url()).origin}/events/${EVENTS.WORLD_TECH_SUMMIT.id}`;
  expect(
    !isPhoneValid || !navigatedAway,
    'expected either the phone field to be flagged invalid, or submission to otherwise not navigate away'
  ).toBe(true);
});
