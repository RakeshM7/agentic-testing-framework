import { test, expect, recordCreatedEntity } from '../../../fixtures/freshsales';

/**
 * Negative / validation-only coverage — TC-lead-to-deal-pipeline-010 through 014
 * (`artifacts/rakesh-freshsales-ind-sep21/testcases/lead-to-deal-pipeline-testcases.csv`).
 *
 * TC-010 through TC-013 are Live-NonMutating: per the clarifications doc's Q8 clarification,
 * validation-only sub-cases expected to be rejected before any record is created are authorized
 * to run live regardless of mode. TC-014 is a best-effort case with an explicitly unconfirmed
 * expected outcome (Open Question 1) — its own ExpectedResult column instructs recording the
 * actual observed behavior rather than treating a mismatch as an automatic fail.
 *
 * KNOWN BLOCKER: same as lead-to-deal-pipeline.spec.ts — this file depends on 'setup-freshsales',
 * which is reproducibly blocked by a reCAPTCHA challenge in this environment (see README.md).
 */
test.describe('lead-to-deal pipeline validation @freshsales', () => {
  // TC-lead-to-deal-pipeline-010 (P1) — Contact creation blocked when Last Name is blank
  test('Validate if Add Contact form - submitting with Last Name blank - is blocked with a required-field error', async ({
    page,
    contactsPage,
  }) => {
    await contactsPage.goto();
    const form = await contactsPage.openAddContactForm();
    await form.fillForm({ firstName: 'NoLastName', email: 'no-last-name@example.com' });
    await form.submit();

    await expect(form.lastNameError()).toBeVisible();
  });

  // TC-lead-to-deal-pipeline-011 (P1) — Deal creation blocked when Deal Name is blank
  test('Validate if Add Deal form - submitting with Deal Name blank - is blocked with a required-field error', async ({
    contactsPage,
    contactDetailPage,
  }) => {
    // Precondition per the CSV: "On the Add Deal form (e.g. via 'Add deal' from a Contact or
    // Account; validation-only case)" — reached here via an existing tenant Contact rather than
    // one this run creates, since no mutation is expected regardless.
    await contactsPage.goto();
    await contactsPage.openFirstContact();
    const dealForm = await contactDetailPage.openAddDealForm();
    await dealForm.fillForm({ amount: '100' });
    await dealForm.submit();

    await expect(dealForm.dealNameError()).toBeVisible();
  });

  // TC-lead-to-deal-pipeline-012 (P2) — Inline Account creation blocked when Account Name is blank
  test('Validate if Add Contact form inline account - leaving the new Account Name blank - is blocked with a required-field error', async ({
    contactsPage,
  }) => {
    const form = await contactsPage.openAddContactForm();
    await form.fillForm({ firstName: 'NoAccountName', lastName: 'Test', email: 'no-account-name@example.com' });
    // Trigger "Add new account" without typing a name — per this class's own doc comment, the
    // exact inline-name-field structure is a best-effort placeholder pending live verification.
    await form.accountInput.click();
    await form.submit();

    await expect(form.accountNameError()).toBeVisible();
  });

  // TC-lead-to-deal-pipeline-013 (P1) — Contact creation blocked with invalid email format
  test('Validate if Add Contact form - submitting an invalid email format - is blocked with an email-format error', async ({
    contactsPage,
  }) => {
    const form = await contactsPage.openAddContactForm();
    await form.fillForm({ firstName: 'Invalid', lastName: 'Email', email: 'not-an-email' });
    await form.submit();

    await expect(form.emailError()).toBeVisible();
  });

  // TC-lead-to-deal-pipeline-014 (P2) — Duplicate-email check (best-effort, outcome unconfirmed)
  test('Validate if Add Contact form - submitting an email matching an existing Contact - surfaces a duplicate-detection UI (best-effort, outcome unconfirmed)', async ({
    page,
    contactsPage,
  }) => {
    // Uses the exploration-created Contact's email address (per this test case's own
    // Preconditions column) rather than depending on this run's own TC-001 having executed first,
    // so this spec can run standalone.
    const existingEmail = 'explore.agent.testlead@example.com';

    const form = await contactsPage.openAddContactForm();
    await form.fillForm({ firstName: 'Duplicate', lastName: 'EmailCheck', email: existingEmail });
    await form.submit();

    // UNCONFIRMED per the clarifications doc's Open Question 1: expect either (a) a
    // duplicate-warning UI referencing the existing Contact, or (b) the save is blocked outright.
    // Recording actual behavior rather than asserting a specific one, per this case's own
    // ExpectedResult column.
    const duplicateWarning = page.getByText(/duplicate/i).first();
    const stillOnAddContactForm = await form.saveButton.isVisible().catch(() => false);
    const sawDuplicateWarning = await duplicateWarning.isVisible().catch(() => false);

    test.info().annotations.push({
      type: 'observed-behavior',
      description: `duplicateWarningShown=${sawDuplicateWarning}, formStillOpen=${stillOnAddContactForm}. ` +
        'Flag this observation to a human reviewer for confirmation (Open Question 1) — see ' +
        'testcases-summary.md traceability matrix.',
    });

    // If a duplicate Contact was in fact created (the UNCONFIRMED "warn-and-allow" branch), a
    // human reviewer should decide whether to record/clean it up — this spec does not delete
    // pre-existing or newly-created Contacts (no delete/cancel action is in scope for this case).
    if (!sawDuplicateWarning && !stillOnAddContactForm) {
      recordCreatedEntity({
        type: 'contact',
        identifier: `Duplicate EmailCheck (${existingEmail})`,
        url: page.url(),
        createdAt: new Date().toISOString(),
        note:
          'TC-014: no duplicate-detection UI was observed and the Add Contact form appears to have ' +
          'submitted — flagging as a possible duplicate Contact created against the pre-existing ' +
          `explore-agent Contact email (${existingEmail}). Needs human review per Open Question 1.`,
      });
    }
  });
});
