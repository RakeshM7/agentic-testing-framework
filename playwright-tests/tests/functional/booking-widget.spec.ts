import { test, expect, EVENTS } from '../../fixtures/base';

// TC-event-booking-003 — Booking widget renders required fields and default ticket quantity (P1)
test('Validate if Event Detail page - loading the booking widget - renders required fields, default quantity, and the Confirm Booking button', async ({
  eventDetailPage,
}) => {
  // Step 1: Navigate to the World Tech Summit event detail page.
  await eventDetailPage.goto(EVENTS.WORLD_TECH_SUMMIT.id);

  // Step 2: Verify the booking widget is visible with the correct price.
  await eventDetailPage.expectBookingWidgetVisible(EVENTS.WORLD_TECH_SUMMIT.price);
  // Step 3: Verify the default ticket quantity is 1.
  const summary = await eventDetailPage.getOrderSummary();
  expect(summary.quantity).toBe(1);
  // Step 4: Verify Full Name, Email, and Phone inputs are all empty by default.
  await expect(eventDetailPage.fullNameInput).toHaveValue('');
  await expect(eventDetailPage.emailInput).toHaveValue('');
  await expect(eventDetailPage.phoneInput).toHaveValue('');
});

// TC-event-booking-004 — Order total is correctly calculated at default quantity (P0)
test('Validate if Event Detail page - viewing the order summary at default quantity - shows the order total equal to price × 1', async ({ eventDetailPage }) => {
  // Step 1: Navigate to the Dilli Diwali Mela event detail page.
  await eventDetailPage.goto(EVENTS.DILLI_DIWALI_MELA.id);

  // Step 2: Read the order summary and verify price per ticket, quantity, line total, and total.
  const summary = await eventDetailPage.getOrderSummary();
  expect(summary.pricePerTicket).toBe(EVENTS.DILLI_DIWALI_MELA.price);
  expect(summary.quantity).toBe(1);
  expect(summary.lineTotal).toBe(EVENTS.DILLI_DIWALI_MELA.price);
  expect(summary.total).toBe(EVENTS.DILLI_DIWALI_MELA.price);
});

// TC-event-booking-006 — Order total recalculates when ticket quantity changes (mid-range) (P1)
test('Validate if Event Detail page - increasing ticket quantity from 1 to 5 - recalculates the order total live', async ({ eventDetailPage }) => {
  const { price } = EVENTS.WORLD_TECH_SUMMIT;
  // Step 1: Navigate to the World Tech Summit event detail page.
  await eventDetailPage.goto(EVENTS.WORLD_TECH_SUMMIT.id);

  // Step 2: Verify the initial quantity is 1 and total equals price × 1.
  let summary = await eventDetailPage.getOrderSummary();
  expect(summary.quantity).toBe(1);
  expect(summary.total).toBe(price * 1);

  // Step 3: Click the increment ("+") button 4 times to raise quantity to 5.
  await eventDetailPage.incrementQty(4);

  // Step 4: Verify quantity is now 5 and line total/total equal price × 5.
  summary = await eventDetailPage.getOrderSummary();
  expect(summary.quantity).toBe(5);
  expect(summary.lineTotal).toBe(price * 5);
  expect(summary.total).toBe(price * 5);
});

// TC-event-booking-010 — Ticket stepper at minimum (qty = 1): "−" is blocked (P1)
test('Validate if Event Detail page - clicking the ticket stepper "−" at minimum quantity (1) - does not go below 1 and disables the button', async ({ eventDetailPage }) => {
  // Step 1: Navigate to the Dilli Diwali Mela event detail page.
  await eventDetailPage.goto(EVENTS.DILLI_DIWALI_MELA.id);

  // Step 2: Verify the initial quantity is 1.
  let summary = await eventDetailPage.getOrderSummary();
  expect(summary.quantity).toBe(1);

  // Step 3: Click the decrement ("−") button once, attempting to go below the minimum.
  await eventDetailPage.decrementQty(1);

  // Step 4: Verify quantity stays at 1, total is unchanged, and the "−" button is disabled.
  summary = await eventDetailPage.getOrderSummary();
  expect(summary.quantity).toBe(1);
  expect(summary.total).toBe(EVENTS.DILLI_DIWALI_MELA.price);
  await expect(eventDetailPage.decrementButton).toBeDisabled();
});

// TC-event-booking-011 — Ticket stepper at maximum (qty = 10): "+" is blocked (P1)
test('Validate if Event Detail page - clicking the ticket stepper "+" at maximum quantity (10) - does not exceed 10 and disables the button', async ({ eventDetailPage }) => {
  const { price } = EVENTS.DILLI_DIWALI_MELA;
  // Step 1: Navigate to the Dilli Diwali Mela event detail page.
  await eventDetailPage.goto(EVENTS.DILLI_DIWALI_MELA.id);

  // Step 2: Click the increment ("+") button 9 times to raise quantity to the maximum of 10.
  await eventDetailPage.incrementQty(9);
  let summary = await eventDetailPage.getOrderSummary();
  expect(summary.quantity).toBe(10);
  expect(summary.total).toBe(price * 10);

  // Step 3: Click the increment ("+") button once more, attempting to exceed the maximum.
  await eventDetailPage.incrementQty(1); // 10th click, attempting to exceed max
  // Step 4: Verify quantity stays at 10, total is unchanged, and the "+" button is disabled.
  summary = await eventDetailPage.getOrderSummary();
  expect(summary.quantity).toBe(10);
  expect(summary.total).toBe(price * 10);
  await expect(eventDetailPage.incrementButton).toBeDisabled();
});

// TC-event-booking-019 — Order total recalculates correctly across a full stepper sequence,
// including at the max boundary (P1)
test('Validate if Event Detail page - running a full sequence of ticket stepper changes up to and back down from the max - keeps the order total correct at every step', async ({
  eventDetailPage,
}) => {
  const { price } = EVENTS.HOLLYWOOD_MONSOON_NIGHT;
  // Step 1: Navigate to the Hollywood Monsoon Night event detail page.
  await eventDetailPage.goto(EVENTS.HOLLYWOOD_MONSOON_NIGHT.id);

  // Step 2: Verify the initial quantity is 1 and total equals price × 1.
  let summary = await eventDetailPage.getOrderSummary();
  expect(summary.quantity).toBe(1);
  expect(summary.total).toBe(price * 1);

  // Step 3: Increment quantity by 2 (to 3) and verify the total.
  await eventDetailPage.incrementQty(2); // -> 3
  summary = await eventDetailPage.getOrderSummary();
  expect(summary.quantity).toBe(3);
  expect(summary.total).toBe(price * 3);

  // Step 4: Increment quantity by 7 more (to 10, the maximum) and verify the total.
  await eventDetailPage.incrementQty(7); // -> 10 (max)
  summary = await eventDetailPage.getOrderSummary();
  expect(summary.quantity).toBe(10);
  expect(summary.total).toBe(price * 10);

  // Step 5: Decrement quantity by 4 (to 6) and verify the total.
  await eventDetailPage.decrementQty(4); // -> 6
  summary = await eventDetailPage.getOrderSummary();
  expect(summary.quantity).toBe(6);
  expect(summary.total).toBe(price * 6);
});
