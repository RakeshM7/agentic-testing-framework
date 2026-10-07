# Test case summary — lead-to-deal-pipeline

Target: `rakesh-freshsales-ind-sep21`
Source: `artifacts/rakesh-freshsales-ind-sep21/clarifications/lead-to-deal-pipeline-clarifications.md`
Output artifact: `artifacts/rakesh-freshsales-ind-sep21/testcases/lead-to-deal-pipeline-testcases.csv`

## Confirmed output format

**CSV** — confirmed directly from the clarifications doc's own "Confirmed test-case output format" section (line ~79-81), which itself states this was read verbatim from `run-config`'s `testcases.output_format` field. This matches the task instruction, so CSV was used with no ambiguity/default-fallback needed.

## Counts by category

| Category | Count | IDs |
|---|---|---|
| Happy Path | 7 | TC-001, TC-002, TC-003, TC-004, TC-006, TC-007, TC-008 |
| Boundary | 3 | TC-005 (Lost), TC-009 (drag-and-drop, secondary), TC-014 (duplicate email, open question) |
| Negative | 4 | TC-010 (Contact required field), TC-011 (Deal required field), TC-012 (inline Account required field), TC-013 (invalid email) |
| **Total** | **14** | TC-lead-to-deal-pipeline-001 through 014 |

Note: TC-004 (Won path) is categorized Happy Path since it is the confirmed primary positive path per the clarifications doc, even though it is also sourced from edge-case table row #1 (assumption-flagged, Q3) — see traceability matrix below for the cross-reference.

## Counts by priority

| Priority | Count | IDs |
|---|---|---|
| P0 | 5 | TC-001, TC-002, TC-003, TC-004, TC-006 |
| P1 | 6 | TC-005, TC-007, TC-008, TC-010, TC-011, TC-013 |
| P2 | 3 | TC-009, TC-012, TC-014 |

## Counts by execution type

| Execution type | Count | IDs |
|---|---|---|
| Live-Mutating | 9 | TC-001, TC-002, TC-003, TC-004, TC-005, TC-006, TC-007, TC-008, TC-009 |
| Live-NonMutating (validation-only) | 4 | TC-010, TC-011, TC-012, TC-013 |
| Live-Mutating-or-NonMutating (outcome TBD at execution) | 1 | TC-014 |

All mutating cases are authorized to run live under `authorizations.mode: full-run` per Q8; all validation-only cases are authorized to run live regardless of mode per the Q8 clarification. Every entity actually created during live execution must be recorded in this run's `created-entities.json`, following the format at `artifacts/rakesh-freshsales-ind-sep21/explore/created-entities.json`.

## Traceability matrix — clarifications doc -> test cases

| Clarifications item | Description | Test case(s) | Notes |
|---|---|---|---|
| Confirmed behavior Q1 | Contact-status substitution for lead create+qualify | TC-001, TC-002 | Core mechanism for this tenant (no Leads module) |
| Confirmed behavior Q2 | Leads-module 403 explicitly out of scope | — (no test case) | Deliberately not generated, per human answer; see Edge case #7 row below |
| Confirmed behavior Q5 | Task/Call/Note activities, all three required | TC-006 (Task), TC-007 (Call), TC-008 (Note) | Task priority P0 (confirmed captured via explore-agent); Call/Note P1 (endpoints not captured, to be discovered live) |
| Confirmed behavior Q7 | Account creation = inline auto-create only | TC-001 | No standalone/existing-account-link case generated, per scope |
| Confirmed behavior Q8 | Full-run live execution + created-entities.json tracking | All Live-Mutating cases (TC-001 -- TC-009) | Non-mutating validation cases (TC-010 -- TC-013) also authorized live per Q8 clarification |
| In-scope: Deal creation on Default Pipeline | — | TC-003 | |
| In-scope: pipeline stage-pill progression | — | TC-004 | |
| In-scope: field validation (required/invalid-email) | — | TC-010, TC-011, TC-012, TC-013 | |
| Out-of-scope: Leads module dedicated test | Explicitly excluded | — (no test case) | Confirmed absence is intentional |
| Out-of-scope: standalone Account creation | Explicitly excluded | — (no test case) | Confirmed absence is intentional |
| Out-of-scope: drag-and-drop as required coverage | Downgraded to secondary | TC-009 | Generated as P2/secondary, not primary |
| Out-of-scope: "Commit deal" button | Explicitly excluded | — (no test case) | Not part of scoped flow |
| Edge case #1 (Won) | Assumption-flagged (Q3, no human answer) | TC-004 | Primary positive path per orchestrator default; categorized Happy Path |
| Edge case #2 (Lost) | Assumption-flagged (Q3, no human answer) | TC-005 | Kept as a distinct case, not merged into Won path, per clarifications guidance; categorized Boundary |
| Edge case #3 (drag-and-drop) | Assumption-flagged (Q4, no human answer) | TC-009 | Secondary/nice-to-have, P2 |
| Edge case #4 (required field blank) | Unconfirmed case (Q6, no human answer, no enumerated field list) | TC-010 (Contact), TC-011 (Deal), TC-012 (Account inline) | Split across the three forms named in the in-scope bullet |
| Edge case #5 (invalid email) | Unconfirmed case (Q6) | TC-013 | Contact form only, per edge-case table |
| Edge case #6 (duplicate email) | Open question (Q6 / Open Question 1) | TC-014 | Best-effort case; expected result explicitly flags outcome as unconfirmed and instructs execution to record actual behavior rather than treat divergence as an automatic fail |
| Edge case #7 (Leads-module 403) | Explicitly excluded (Q2) | — (no test case) | Intentionally not generated; listed here to confirm the row was reviewed, not skipped by omission |
| Open Question 2 (no required-field enumeration) | Unresolved | TC-010, TC-011, TC-012 | Test cases use one representative required field per form (Contact Last Name, Deal Name, Account Name) since no full field matrix was confirmed; a fuller matrix would need either human confirmation or live DOM inspection at execution time |
| Open Question 3 (Won/Lost + drag-and-drop are assumptions, not human-confirmed) | Unresolved | TC-004, TC-005, TC-009 | Flagged in each case's TraceabilityRef column in the CSV; if a human reviewer later disagrees with treating Won as primary or drag-and-drop as secondary, these three cases are the ones to revisit |

## Cross-reference note on named identities / credentials

TC-006 (Task activity) references the deal owner defaulting to the currently logged-in sales user, observed during exploration as "Rakesh M." A `playwright-tests/.env` file already exists in this repo, but it holds `EVENTHUB_*` variables for a different target (EventHub), not Freshsales credentials for `rakesh-freshsales-ind-sep21`. No Freshsales-specific `.env` exists yet to cross-check against, so there is currently no risk of the named identity ("Org Admin") diverging from a credentials file — but TC-006's steps explicitly flag that whichever account is actually logged in at automation time should be confirmed, in case a Freshsales-specific `.env` is introduced later pointing at a differently-named (but equally capable) account.

## Format-ambiguity disclosure

Not applicable — the confirmed format (CSV) was unambiguous and taken verbatim from the clarifications doc, so no Markdown-table fallback was needed.

## Handoff

- Test cases: `artifacts/rakesh-freshsales-ind-sep21/testcases/lead-to-deal-pipeline-testcases.csv`
- This summary: `artifacts/rakesh-freshsales-ind-sep21/testcases/testcases-summary.md`
- Consumers: `playwright-automation-agent` (source cases to automate, especially the 9 Live-Mutating cases and 4 validation-only cases), `api-testing-agent` (functional cross-reference against the API endpoints listed in the clarifications doc's Grounding reference section, e.g. `POST /crm/sales/contacts`, `PUT /crm/sales/deals/<id>`, `POST /crm/sales/tasks`).
