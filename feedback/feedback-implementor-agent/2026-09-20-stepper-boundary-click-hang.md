---
source_agent: feedback-implementor-agent
date: 2026-09-20
target: eventhub
related_files:
  - playwright-tests/pages/EventDetailPage.ts
  - playwright-tests/tests/functional/booking-widget.spec.ts
severity: medium
---

## Finding 1: `decrementQty`/`incrementQty` hang for the full test timeout when the target stepper button is legitimately disabled at a boundary

**Summary:** `EventDetailPage.decrementQty()` and `EventDetailPage.incrementQty()` (`playwright-tests/pages/EventDetailPage.ts:89-99`) call `.click()` unconditionally on the stepper button. At the ticket-quantity boundaries (qty = 1 for decrement, qty = 10 for increment) the live app correctly disables that button — but Playwright's default `.click()` actionability check waits for the element to become enabled rather than failing fast, so the call hangs for the entire test timeout (30s) instead of no-op'ing or failing clearly.

This was discovered as a side effect while verifying the fix for `feedback/playwright-automation-agent/2026-09-20-text-node-assertions.md` — it was previously masked because `getOrderSummary()`'s own bug (fixed in that file) timed out first on the same tests, hiding this second, independent problem.

**Evidence:** Real run, `npx playwright test tests/functional/booking-widget.spec.ts -g "does not go below 1|does not exceed 10"`:

```
1) tests/functional/booking-widget.spec.ts:46:5 › decrement at minimum quantity (1) does not go below 1
   Test timeout of 30000ms exceeded.
   Error: locator.click: Test timeout of 30000ms exceeded.
   Call log:
     - waiting for getByRole('button', { name: '−' })
       - locator resolved to <button disabled type="button" class="w-9 h-9 rounded-lg border ... disabled:opacity-40">−</button>
     - attempting click action
       - element is not enabled (retried ~56 times over 30s)
     at EventDetailPage.decrementQty (EventDetailPage.ts:97:34)
     at booking-widget.spec.ts:52:25

2) tests/functional/booking-widget.spec.ts:60:5 › increment at maximum quantity (10) does not exceed 10
   Test timeout of 30000ms exceeded.
   Error: locator.click: Test timeout of 30000ms exceeded.
   Call log:
     - waiting for getByRole('button', { name: '+' })
       - locator resolved to <button disabled type="button" class="w-9 h-9 rounded-lg border ... disabled:opacity-40">+</button>
     - attempting click action
       - element is not enabled (retried ~56 times over 30s)
     at EventDetailPage.incrementQty (EventDetailPage.ts:91:34)
     at booking-widget.spec.ts:69:25

2 failed, 1 passed (32.1s)
```

Both tests are specifically designed to exercise the boundary: `booking-widget.spec.ts:52` calls `decrementQty(1)` while quantity is already 1 (TC-event-booking-010, asserting the button is blocked), and `booking-widget.spec.ts:69` calls `incrementQty(1)` as the "10th click, attempting to exceed max" after already reaching 10 (TC-event-booking-011). In both cases the test's own intent is to click the disabled button and assert nothing changes — the page object's blind `.click()` fights that intent instead of supporting it.

**Suggested fix:** `decrementQty`/`incrementQty` should check `isDisabled()` before each click and stop early (no-op) rather than attempt a click Playwright will wait 30s on, e.g.:

```ts
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
```

This preserves the two tests' actual assertions (that quantity/total don't change past the boundary) while making the boundary-click itself a fast, deliberate no-op instead of a 30s timeout. Consider also asserting `toBeDisabled()` on the relevant button explicitly in `booking-widget.spec.ts:46` and `:60`, so the boundary behavior itself is asserted, not just inferred from the fact that quantity didn't change.

## Resolution (2026-09-20)

**Finding 1: Status — Fixed**

- **Files changed:**
  - `playwright-tests/pages/EventDetailPage.ts` — `incrementQty`/`decrementQty` now call `isDisabled()` on the respective button before each click and `return` early (no-op) if it's disabled, exactly as suggested in the finding, instead of blindly calling `.click()` and letting Playwright's actionability wait run out the clock.
  - `playwright-tests/tests/functional/booking-widget.spec.ts` — implemented the finding's secondary suggestion: added `await expect(eventDetailPage.decrementButton).toBeDisabled();` at the end of the "decrement at minimum quantity (1)" test (line ~46) and `await expect(eventDetailPage.incrementButton).toBeDisabled();` at the end of the "increment at maximum quantity (10)" test (line ~61), so boundary behavior is asserted directly rather than only inferred from quantity staying unchanged.
- **Verification:**
  - `npx tsc --noEmit` — clean, no type errors.
  - `npx playwright test tests/functional/booking-widget.spec.ts` — real run, all 7 tests in the file (including the `[setup]` auth step) passed in 8.4s; specifically both previously-hanging boundary tests (`decrement at minimum quantity (1) does not go below 1`, `increment at maximum quantity (10) does not exceed 10`) now pass in ~5.8s each instead of timing out at 30s.
  - `npx playwright test` (full suite) — 21 passed, 5 skipped (all 5 skips are in `booking-mutating.spec.ts`, unrelated to this change and pre-existing), 0 failed. No regressions introduced elsewhere.
