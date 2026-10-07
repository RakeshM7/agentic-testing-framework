import { test, expect, recordCreatedEntity, FRESHSALES, uniqueSuffix } from '../../../fixtures/freshsales';
import { frameworkConfig } from '../../../config/framework.config';

/**
 * Lead-to-deal pipeline — TC-lead-to-deal-pipeline-001 through 009
 * (`artifacts/rakesh-freshsales-ind-sep21/testcases/lead-to-deal-pipeline-testcases.csv`).
 *
 * All Live-Mutating per the clarifications doc's Q8 human answer (authorizations.mode: full-run
 * for this tenant), scoped to entities this run itself creates — each created entity is recorded
 * via recordCreatedEntity() into artifacts/rakesh-freshsales-ind-sep21/playwright/created-entities.json.
 *
 * Run as a single `describe.serial` block (rather than independent tests) because these test
 * cases form one genuinely stateful pipeline — TC-002 needs TC-001's Contact, TC-003 needs
 * TC-002's qualified Contact, TC-004 needs TC-003's Deal, etc. Contact/Deal identifiers are
 * captured in closure variables as each step creates them; `fullyParallel` would otherwise let
 * Playwright schedule these across separate workers/contexts in a non-deterministic order.
 *
 * KNOWN BLOCKER: this entire file depends on the 'setup-freshsales' project (see
 * playwright.config.ts), which performs a real login against this tenant. That login is
 * reproducibly blocked by a Google reCAPTCHA challenge in this environment (verified across
 * headless/headed Chromium and a real Chrome channel — see README.md "Known blocker" and
 * tests/setup/auth.freshsales.setup.ts). Every test below is written to execute for real once a
 * valid authenticated session is available; until then, Playwright will report them as skipped
 * due to the failed setup dependency, not silently absent.
 */
test.describe.serial('lead-to-deal pipeline @freshsales', () => {
  const runId = uniqueSuffix();
  let contactId = '';
  let contactUrl = '';
  const contactEmail = `agenttest.leadpipeline+${runId}@example.com`;
  const accountName = `AgentTest Pipeline Co ${runId}`;
  let dealId = '';
  let dealUrl = '';
  const dealName = `AgentTest Pipeline Deal ${runId}`;

  // TC-lead-to-deal-pipeline-001 (P0) — Create Contact with inline new Account creation
  test('Validate if Contacts module - creating a Contact with inline new Account creation - defaults Status to New and Lifecycle to Lead', async ({
    page,
    waits,
    contactsPage,
  }) => {
    await contactsPage.goto();
    const form = await contactsPage.openAddContactForm();
    await form.fillForm({
      firstName: 'AgentTest',
      lastName: `LeadPipeline-${runId}`,
      email: contactEmail,
    });
    await form.createAccountInline(accountName);
    await form.submit();

    // The new Contact detail page is expected to open post-save.
    await waits.forUrl(page, /\/crm\/sales\/contacts\/\d+/);
    contactUrl = page.url();
    const match = contactUrl.match(/\/crm\/sales\/contacts\/(\d+)/);
    if (!match) throw new Error(`Could not parse Contact ID from URL: ${contactUrl}`);
    contactId = match[1];

    await expect(page.getByText('New', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(accountName, { exact: false })).toBeVisible();

    recordCreatedEntity({
      type: 'account',
      identifier: accountName,
      url: `${frameworkConfig.urls.freshsales}/crm/sales/sales_accounts?name=${encodeURIComponent(accountName)}`,
      createdAt: new Date().toISOString(),
      note: "Auto-created via the Add Contact form's inline 'Add new account' affordance (TC-001).",
    });
    recordCreatedEntity({
      type: 'contact',
      identifier: `AgentTest LeadPipeline-${runId} (${contactEmail})`,
      url: contactUrl,
      createdAt: new Date().toISOString(),
      note: 'Created as the lead-equivalent stand-in per Q1 (TC-001), default Status=New/Lifecycle=Lead.',
    });
  });

  // TC-lead-to-deal-pipeline-002 (P0) — Advance Status to Qualified; Lifecycle auto-promotes
  test('Validate if Contact detail page - advancing Status to Qualified - auto-promotes Lifecycle stage to Sales Qualified Lead', async ({
    page,
    waits,
    contactDetailPage,
  }) => {
    test.skip(!contactId, 'Depends on TC-001 having created a Contact this run.');
    await contactDetailPage.goto(contactId);
    await contactDetailPage.setStatus('Qualified');

    await expect(contactDetailPage.statusPill).toHaveText('Qualified');
    await expect(contactDetailPage.lifecycleStageValue).toHaveText('Sales Qualified Lead');
  });

  // TC-lead-to-deal-pipeline-003 (P0) — Create a Deal from the qualified Contact/Account
  test('Validate if Contact detail page - creating a Deal from the qualified Contact - is created on Default Pipeline', async ({
    page,
    waits,
    contactDetailPage,
  }) => {
    test.skip(!contactId, 'Depends on TC-001/002 having created and qualified a Contact this run.');
    await contactDetailPage.goto(contactId);
    const dealForm = await contactDetailPage.openAddDealForm();
    await dealForm.fillForm({ dealName, amount: '2500' });
    await dealForm.submit();

    await waits.forUrl(page, /\/crm\/sales\/deals\/\d+/);
    dealUrl = page.url();
    const match = dealUrl.match(/\/crm\/sales\/deals\/(\d+)/);
    if (!match) throw new Error(`Could not parse Deal ID from URL: ${dealUrl}`);
    dealId = match[1];

    await expect(page.getByText(dealName, { exact: false })).toBeVisible();
    await expect(page.getByText(FRESHSALES.DEFAULT_PIPELINE, { exact: false })).toBeVisible();

    recordCreatedEntity({
      type: 'deal',
      identifier: dealName,
      url: dealUrl,
      createdAt: new Date().toISOString(),
      note: `Created from qualified Contact ${contactId} / Account "${accountName}", $2,500, Default Pipeline (TC-003).`,
    });
  });

  // TC-lead-to-deal-pipeline-004 (P0) — Full pipeline via stage-pill clicks to Won
  test('Validate if Deal detail page - moving the Deal through every stage pill - reaches Won', async ({
    dealDetailPage,
  }) => {
    test.skip(!dealId, 'Depends on TC-003 having created a Deal this run.');
    await dealDetailPage.goto(dealId);

    for (const stage of ['Qualification', 'Discovery', 'Demo', 'Negotiation', 'Won'] as const) {
      await dealDetailPage.moveToStage(stage);
      await expect(dealDetailPage.stagePill(stage)).toBeVisible();
    }
  });

  // TC-lead-to-deal-pipeline-005 (P1) — A separate Deal moved to Lost (distinct terminal branch)
  test('Validate if Deal detail page - moving a separate fresh Deal to Lost - reaches Lost without also showing Won', async ({
    page,
    waits,
    contactsPage,
    contactDetailPage,
    dealDetailPage,
  }) => {
    // Precondition: a second, distinct Deal this run creates (repeat of TC-001-003 with unique
    // values), per this test case's own preconditions column.
    const lostRunId = `${runId}-lost`;
    const lostEmail = `agenttest.leadpipeline+${lostRunId}@example.com`;
    const lostAccountName = `AgentTest Pipeline Co ${lostRunId}`;
    const lostDealName = `AgentTest Pipeline Deal ${lostRunId}`;

    await contactsPage.goto();
    const contactForm = await contactsPage.openAddContactForm();
    await contactForm.fillForm({ firstName: 'AgentTest', lastName: `LeadPipeline-${lostRunId}`, email: lostEmail });
    await contactForm.createAccountInline(lostAccountName);
    await contactForm.submit();
    await waits.forUrl(page, /\/crm\/sales\/contacts\/\d+/);
    const lostContactId = page.url().match(/\/crm\/sales\/contacts\/(\d+)/)?.[1];
    if (!lostContactId) throw new Error('Could not parse Contact ID for the Lost-path Deal precondition.');
    recordCreatedEntity({
      type: 'account',
      identifier: lostAccountName,
      url: `${frameworkConfig.urls.freshsales}/crm/sales/sales_accounts?name=${encodeURIComponent(lostAccountName)}`,
      createdAt: new Date().toISOString(),
      note: 'Auto-created inline for the Lost-path Deal precondition (TC-005).',
    });
    recordCreatedEntity({
      type: 'contact',
      identifier: `AgentTest LeadPipeline-${lostRunId} (${lostEmail})`,
      url: page.url(),
      createdAt: new Date().toISOString(),
      note: 'Created solely as the precondition Contact/Account for the Lost-path Deal (TC-005).',
    });

    const dealForm = await contactDetailPage.openAddDealForm();
    await dealForm.fillForm({ dealName: lostDealName, amount: '1000' });
    await dealForm.submit();
    await waits.forUrl(page, /\/crm\/sales\/deals\/\d+/);
    const lostDealId = page.url().match(/\/crm\/sales\/deals\/(\d+)/)?.[1];
    if (!lostDealId) throw new Error('Could not parse Deal ID for the Lost-path Deal.');
    recordCreatedEntity({
      type: 'deal',
      identifier: lostDealName,
      url: page.url(),
      createdAt: new Date().toISOString(),
      note: `Created distinct from the TC-004 Deal specifically to exercise the Lost terminal branch (TC-005).`,
    });

    await dealDetailPage.goto(lostDealId);
    await dealDetailPage.moveToStage('Lost');
    await expect(dealDetailPage.stagePill('Lost')).toBeVisible();
    await expect(dealDetailPage.stagePill('Won')).not.toHaveAttribute('aria-pressed', 'true');
  });

  // TC-lead-to-deal-pipeline-006 (P0) — Log a Task activity against the Deal
  test('Validate if Deal detail page - logging a Task activity - creates the Task under Activities > Tasks', async ({
    page,
    waits,
    dealDetailPage,
  }) => {
    test.skip(!dealId, 'Depends on TC-003 having created a Deal this run.');
    await dealDetailPage.goto(dealId);
    const taskTitle = `Follow up with ${accountName} on negotiation terms`;
    const taskForm = await dealDetailPage.openTaskForm();
    await taskForm.fillAndSave(taskTitle);

    await expect(page.getByText(taskTitle, { exact: false })).toBeVisible();

    recordCreatedEntity({
      type: 'task',
      identifier: taskTitle,
      url: `${dealUrl}?tab=recent-activities.tasks`,
      createdAt: new Date().toISOString(),
      note: 'Task activity logged against the pipeline Deal (TC-006), owner defaults to the logged-in user.',
    });
  });

  // TC-lead-to-deal-pipeline-007 (P1) — Log a Call activity against the Deal
  // Call log field structure is unconfirmed (see ActivityForms.ts's CallLogFormModal doc comment):
  // explore-agent never captured this form's fields/endpoint, and this run could not reach a live
  // authenticated session (reCAPTCHA blocker — see README.md "Known blocker") to discover them
  // per the clarifications doc's own instruction to discover this live. Left as fixme (steps
  // documented, not executed) rather than deleted or guessed, same convention as the EventHub
  // suite's booking-mutating.spec.ts.
  test.fixme(
    'Validate if Deal detail page - logging a Call activity - creates the call log under Activities',
    async ({ dealDetailPage }) => {
      // Step 1 (not executed): Would open the Deal detail page and click "Call log".
      // Step 2 (not executed): Would fill in whatever fields the live form presents (outcome,
      // notes) — never captured by explore-agent.
      // Step 3 (not executed): Would save and assert the call activity appears under Activities.
    }
  );

  // TC-lead-to-deal-pipeline-008 (P1) — Log a Note against the Deal
  test('Validate if Deal detail page - logging a Note - appears in the Notes/Activities feed', async ({
    page,
    waits,
    dealDetailPage,
  }) => {
    test.skip(!dealId, 'Depends on TC-003 having created a Deal this run.');
    await dealDetailPage.goto(dealId);
    const noteText = 'Negotiation terms discussed; pricing confirmed at $2,500.';
    await dealDetailPage.noteComposer().addNote(noteText);

    await expect(page.getByText(noteText, { exact: false })).toBeVisible();

    recordCreatedEntity({
      type: 'note',
      identifier: noteText,
      url: dealUrl,
      createdAt: new Date().toISOString(),
      note: 'Note logged against the pipeline Deal (TC-008).',
    });
  });

  // TC-lead-to-deal-pipeline-009 (P2, secondary/optional) — Drag-and-drop Kanban stage move
  test('Validate if Deals Kanban board - dragging the Deal card to an adjacent column - updates its stage (secondary interaction)', async ({
    page,
    waits,
    contactDetailPage,
    dealsKanbanPage,
  }) => {
    test.skip(!contactId, 'Depends on TC-001/002 having created and qualified a Contact this run.');
    // A dedicated third Deal, still in its initial "New" stage, so the drag targets an adjacent
    // column as the CSV's own example describes ("e.g. from New to Qualification") — the TC-004
    // and TC-005 Deals are already at their terminal Won/Lost stages by this point in the run.
    const kanbanDealName = `AgentTest Pipeline Deal ${runId}-kanban`;
    await contactDetailPage.goto(contactId);
    const dealForm = await contactDetailPage.openAddDealForm();
    await dealForm.fillForm({ dealName: kanbanDealName, amount: '500' });
    await dealForm.submit();
    await waits.forUrl(page, /\/crm\/sales\/deals\/\d+/);
    recordCreatedEntity({
      type: 'deal',
      identifier: kanbanDealName,
      url: page.url(),
      createdAt: new Date().toISOString(),
      note: 'Created solely for the drag-and-drop Kanban interaction (TC-009, secondary/optional coverage).',
    });

    // Secondary/nice-to-have per Q4 — failure here should not gate the feature as failing (per
    // the CSV's own ExpectedResult column for this case).
    await dealsKanbanPage.goto();
    await dealsKanbanPage.dragDealToStage(kanbanDealName, 'Qualification');
    await expect(dealsKanbanPage.column('Qualification')).toContainText(kanbanDealName);
  });
});
