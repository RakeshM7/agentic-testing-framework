# Clarifications: Sales Sequences (track sales-sequences)

## Feature summary
Freshsales Sales Sequences: list, create (Outbound contact sequence with a task step), clone, share, edit and delete sequences. Canonical entry: Conversations > Sales Sequences (/crm/sales/sales-sequences, redirects to /filters). Create page: /crm/sales/sales-sequences/contact/new. Flows covered (explore/flows/index.json): view-sequences-list, create-sales-sequence, clone-and-share-sequence.

Basis for live execution: `authorizations.mode` = full-run (set explicitly by the user for their own trial tenant). Deletes/cancels only for entities this run created (plus the one explicitly approved leftover below).

## In scope / Out of scope
In scope:
- View list (empty state, with-data state, search, columns, "Showing: All sequences").
- Create sequence with task step; empty-steps validation; Save (Inactive result).
- Row actions: Edit, Share, Clone, Delete on run-created sequences.
- Clone wizard (including discard-confirmation path), Share dialog options.
- Other step types (email, email reminder, LinkedIn task, call reminder, SMS), Accounts-type sequences, Classic/Smart configuration (answered "Yes" to in-scope; see Open questions for provider-dependence).
- Entry/exit rules as exposed by the filter options on the page.

Out of scope / not testable:
- Enrolment of contacts end to end: cannot be tested without real contacts (answer to entry/exit question).
- Template cards, video, external links (skipped by explore; no answer bringing them into scope).

## Confirmed behaviors
- Canonical entry point is Conversations > Sales Sequences, not Quick-create (+) (Q: entry point; answer Yes).
- Entry and exit rules are defined by the filter options present on the page; tests verify those options only (Q: exit/entry rules).
- Enrolment cannot be tested without real contacts (same Q).
- The leftover sequence "Explore Test Sequence" (id 402000016478) is to be deleted via an approved delete (Q: leftover sequence).
- Observed (explore, not a human ruling): create with no steps shows inline error "Add at least 1 step to this sequence"; default name "New Sequence"; Save with a task step yields Inactive sequence at /sales-sequences/contact/<id> with all metrics 0; row actions menu = Edit, Share, Clone, Delete; Share dialog radios = Just me (default), Everyone, Selected users, teams and territories; Clone wizard prefilled "<name> - Copy" with Step 1, Cancel prompts "Are you sure want to discard?".
- Edit and Delete in scope for run-created sequences (answer Yes, compound question; see Open questions for unanswered parts).
- Clone-save may be executed live on a run-created sequence (answer Yes; copy to be deleted afterwards).
- Share save of options may be tested on a run-created sequence (answer Yes).

### Live-execution rulings
- (a) Submissions that could succeed and mutate data (create, clone-save, share-save, edit-save, activate, delete): executed live under full-run, only on entities the run created (and 402000016478 for delete).
- (b) Validation-blocked submissions (e.g. Save with no steps): non-mutating, run live regardless of mode.

## Edge cases
| Scenario | Expected behavior |
|---|---|
| Save with no steps | Inline error "Add at least 1 step to this sequence"; stays on /contact/new (observed) |
| Empty sequence name | Not confirmed (see Open questions) |
| Duplicate sequence name | Not confirmed (blocked / suffixed / allowed unknown) |
| Maximum name length | Not confirmed |
| Clone then Cancel | Confirm "Are you sure want to discard?"; Yes returns to list, nothing saved (observed) |
| Share dialog Cancel | Nothing saved (observed) |
| Activate task-only sequence with no enrolled contacts | Answer "Yes" is ambiguous; see Open questions |
| Enrolment of contacts | Not testable without real contacts |

## Non-functional constraints
- Auth: Owner/admin user (Rakesh M) with create rights; session-state login.
- List page takes a few seconds to render; tests need generous waits.
- Cleanup: every created sequence (and clone copy) deleted at end of run; track in created-entities.json.

## Confirmed test-case output format
CSV

## Open questions
1. Sequence name validation (empty, duplicate, max length): answer was a bare "Yes" to an open "blocked, auto-suffixed or allowed" question. Not spec. Expected behavior unknown.
2. Activation: answer "Yes" to "may tests use Save and start / status toggle ... or must every sequence remain Inactive?". Ambiguous; assumed NOT confirmed. Treat activation as permitted only if the human confirms; default is keep created sequences Inactive.
3. Clone: "Yes" confirms live clone-save, but the expected result (Inactive, named "<original> - Copy", same steps) is not explicitly confirmed beyond the prefilled name observed.
4. Share: expected visibility for another user and availability of a second user were not answered ("Yes" to a compound question). Visibility assertions for other users are not specified; only the dialog save is in scope.
5. Edit/Delete: confirmation dialog text and post-delete behavior (removed from list; Trash/recoverable vs permanent) not answered.
6. Other step types (email, SMS, etc.): in scope per "Yes", but dependence on unconfigured mailbox/SMS providers was not resolved; tests may be blocked on provider setup.
7. Which entry/exit filter options exactly must be asserted: the answer points to the page; the option list was not explored (coverage gap).
8. Coverage gaps from crawl-log: step-type dialogs other than task, Accounts sequence type, advanced settings, Edit page, activation/enrolment, filter dropdown options; DOM snapshots/network files are stubs (screenshots real).
9. Quick-create (+) path: whether a sequence entry exists there was not checked.

## Follow-up Questions
- [Edge Case][Nice-to-have] The earlier "duplicate/empty/max-length name" answer was a bare "Yes"; what is the actual outcome when saving a sequence with an empty or already-used name (blocked with message, auto-suffixed, or allowed)? Navigate: Conversations > Sales Sequences > Create sales sequence, clear or reuse the name at the top, add a task step, Save (flow create-sales-sequence).
- [Behavior][Nice-to-have] After Delete on a run-created sequence, what confirmation text appears and is the sequence permanently removed or recoverable? Navigate: Conversations > Sales Sequences > row actions > Delete (flow clone-and-share-sequence).
- [Behavior][Nice-to-have] Should activation (Save and start / status toggle) be exercised on a task-only sequence with no contacts, given the answer was an ambiguous "Yes"? Navigate: Conversations > Sales Sequences > Create sales sequence > add task step > Save and start (flow create-sales-sequence).
- [Scope][Nice-to-have] Are email/SMS step types to be tested only if a mailbox/SMS provider is configured, otherwise skipped? Navigate: Conversations > Sales Sequences > Create sales sequence > Add step options (flow create-sales-sequence).
