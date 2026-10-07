# Clarifications — lead-to-deal-pipeline

Target: `rakesh-freshsales-ind-sep21` (Freshsales CRM, tenant `rakesh-freshsales-ind-sep21.myfreshworks.com`)
Run mode: `authorizations.mode: full-run` — this run is authorized for full UI/API mutation and live execution against this tenant, **scoped to entities the run itself creates** (tracked in `created-entities.json`; deletes/cancels are never permitted against pre-existing or other users' data).

Source grounding for this document: `artifacts/rakesh-freshsales-ind-sep21/explore/sitemap.json`, `.../explore/crawl-log.md`, `.../explore/created-entities.json`.

---

## Feature summary

Create and qualify a lead, convert it into a contact/account, create a deal from it, and move that deal across stages on the sales pipeline Kanban board — including logging an activity (task/call/note) against the deal along the way.

**Tenant-specific adaptation (grounded in crawl-log.md, lines 26-44):** this tenant/user role has **no accessible Leads module**. `GET /crm/sales/leads` returns 403 ("You are not authorised to perform this operation"), and no "Add Lead" option exists anywhere in the quick-create menu or left-nav icon list. Per the human-confirmed answer to Question 1, this feature is tested using the **Contact-status substitution** as the in-app equivalent of "create and qualify a lead":

- Create a Contact with default Status = `New` / Lifecycle stage = `New(Lead)`.
- Advance Contact Status to `Qualified`, which auto-promotes Lifecycle stage to `Sales Qualified Lead`.
- This Contact-status/lifecycle pipeline (full observed sequence: `New(Lead) -> Contacted -> Interested -> Qualified -> Won/Churned` for Status, with Lifecycle stage auto-promoting on reaching `Qualified`) is the tenant's lead-equivalent mechanism.

Downstream agents (testcase-generator-agent, playwright-automation-agent, api-testing-agent) must treat this substitution as the authoritative flow for "lead" steps in this feature — there is no separate Leads-module flow to generate for this tenant.

---

## In scope / Out of scope

**In scope:**
- Contact creation (as lead stand-in) with default Status/Lifecycle values.
- Advancing Contact Status to `Qualified` and confirming Lifecycle stage auto-promotes to `Sales Qualified Lead`.
- Account creation via the inline "Add new account" affordance on the Add Contact form (the path explore-agent actually exercised and the human-confirmed default/standard coverage — see Question 7).
- Deal creation from the qualified Contact/Account, on the Default Pipeline.
- Moving the Deal across pipeline Kanban stages via the stage-pill click interaction on the deal detail page: `New -> Qualification -> Discovery -> Demo -> Negotiation -> Won` as the primary positive path, plus a separate `Lost` case (see Edge cases / assumption in Question 3).
- Logging Task, Call, and Note activities against the Deal (standard/default coverage per Question 5 — all three types, not Task only).
- Live execution of all the above against this tenant, scoped to entities the run creates, per `authorizations.mode: full-run` and the human answer to Question 8. This applies to submissions that could succeed and mutate real data (e.g., valid Contact/Deal/Task creation, valid stage transitions).
- Negative/validation-only sub-cases that are expected to be blocked by client- or server-side validation before any mutation occurs (e.g., missing required field, malformed email format) are **not mutating** and are also authorized to run live, regardless of mode — this is not gated the same way as case (a) above, and is explicitly confirmed as in scope for live execution.
- Standard field validation coverage on Contact/Account/Deal creation forms: required-field-missing and invalid-email-format cases (assumption-flagged default; see Edge cases table).

**Out of scope:**
- Any dedicated test case targeting the Leads module itself (e.g., a negative/403 access-control case asserting `GET /crm/sales/leads` is forbidden). Human-confirmed explicitly out of scope (Question 2) — skip Leads-module coverage entirely.
- Standalone Account creation as an independent flow, or linking a Deal/Contact to a pre-existing Account not created by inline auto-create. (Standard/default coverage per Question 7 is interpreted as the inline auto-create path only, matching what was actually exercised and captured in artifacts; no separate standalone-Account-creation test case is required.)
- Settings/Admin area configuration (out of scope per crawl-log; not part of this feature).
- The deal detail page's "Commit deal" button — not part of the scoped flow; stage progression uses the pipeline stage-pill bar instead.
- Any deletion, cancellation, or destructive action against pre-existing or other users' data — never in scope under any mode, per the standing safety guardrail. Destructive actions (if any are generated at all, e.g., as part of a future cleanup pass) may only target entities this run's own agents create, tracked in `created-entities.json`.
- Drag-and-drop Kanban interaction is not required coverage (see Question 4) — only flagged as an optional secondary case.

---

## Confirmed behaviors

- **[Q1 — Human answer]** "Create and qualify a lead" = create a Contact with default Status `New`/Lifecycle `Lead`, then advance Contact Status to `Qualified`, which auto-promotes Lifecycle stage to `Sales Qualified Lead`. This is the lead-equivalent mechanism for this tenant since the Leads module 403s for this role.
- **[Q2 — Human answer]** Do not generate a dedicated negative/403 test case for Leads-module access. Rely solely on the Contact-substitution flow.
- **[Q5 — Human answer]** Cover all three activity types — Task, Call, and Note — logged against the Deal, using standard/default coverage for each (not Task-only, even though explore-agent's captured artifacts only exercised Task creation via `POST /crm/sales/tasks` -> 201).
- **[Q7 — Human answer]** Account-creation coverage = standard/default coverage, i.e. the inline auto-create-from-Contact-form path (as explore-agent exercised: Account "Explore Test Co" auto-created via the Add Contact form's inline "Add new account" affordance, resolvable via `GET /crm/sales/sales_accounts?name=Explore+Test+Co`). No standalone Account-creation or existing-Account-linking test case required.
- **[Q8 — Human answer]** Because `authorizations.mode: full-run`, all positive/mutating test cases in this feature (Contact create+qualify, Deal create, Kanban stage transitions, Task/Call/Note creation) are to be **executed live** against this tenant, not merely generated-but-skipped. Every entity created during live execution must be tracked in a `created-entities.json` file for this run, following the format already established at `artifacts/rakesh-freshsales-ind-sep21/explore/created-entities.json` (type, identifier, url, createdAt, note).
- **[Q8 clarification, stated per this agent's own instructions on distinguishing mutating vs. validation-only sub-cases]** Negative/validation-only sub-cases (e.g., submitting the Add Contact/Deal form with a missing required field, or a malformed email address, expected to be rejected client- or server-side before any record is created) are non-mutating and are authorized to run live regardless of mode — this ruling is separate from, and not overridden by, the full-run ruling for successful/mutating submissions above.
- **[Q9 — Confirmed directly from run-config, not the answers list]** Test-case output format: **CSV**.

---

## Edge cases

| # | Scenario | Expected behavior | Provenance |
|---|----------|--------------------|------------|
| 1 | Deal reaches the `Won` stage | Positive terminal-state path; include as the primary "full pipeline" positive test case (`New -> Qualification -> Discovery -> Demo -> Negotiation -> Won`) | Orchestrator config-applied default (`unconfirmed_behavior_policy = assume-standard-and-flag`) — **flagged as an unconfirmed assumption**, no human answer given (Q3) |
| 2 | Deal reaches the `Lost` stage | Include as a separate, distinct test case (not merged into the Won path) since Lost is an alternate terminal branch, not a step on the way to Won | Same as above — **flagged as an unconfirmed assumption** (Q3) |
| 3 | Kanban stage transition via drag-and-drop card between columns | Secondary/nice-to-have case only; pill-click (as explore-agent used and captured) is the primary/required interaction method | Orchestrator config-applied default (`unconfirmed_behavior_policy = assume-standard-and-flag`) — **flagged as an unconfirmed assumption**, no human answer given (Q4) |
| 4 | Required field left blank on Contact/Account/Deal creation form (e.g., Contact last name, Deal name) | Inline validation error shown; form does not submit; no record created | Orchestrator config-applied default (`unconfirmed_edge_case_policy = flag-as-unconfirmed-case`) — **flagged as an unconfirmed case**, no human answer given (Q6); no enumerated list of every required field was confirmed |
| 5 | Invalid email format entered on Contact creation form | Inline validation error shown; form does not submit; no record created | Same as #4 — **flagged as an unconfirmed case** (Q6) |
| 6 | Duplicate-email check on Contact creation | Not confirmed whether/how a duplicate-email warning or block is surfaced (a `/duplicates` endpoint was observed in network traffic per crawl-log, suggesting this check exists, but its exact UX was not exercised or confirmed) | **Open question** — see below (Q6, no specific answer covering duplicates) |
| 7 | Leads-module 403 for this role | Explicitly excluded from test coverage — do not write a test case asserting this | Human answer (Q2) |

---

## Non-functional constraints

None raised in Pass 1 or by the human answers. No performance, accessibility, or additional-auth constraints were identified as blocking for this feature. Standard first-party console/network health observed during exploration (no first-party JS errors; only third-party telemetry endpoints — `rum.haystack.es`, `freshworks-rts/_logs`, `fast.appcues.com` — returned non-actionable 503s/warnings) is noted for context only, not as a test requirement.

---

## Confirmed test-case output format

**CSV** — confirmed directly from `run-config` (`testcases.output_format` field), not from the Pass-1 answers list. This is the single value testcase-generator-agent should read verbatim.

---

## Grounding reference (for testcase-generator-agent / automation agents)

Use these concrete, tenant-specific values instead of placeholders when generating and executing test cases:

- **Contact (lead stand-in) fields observed:** Status field values include `New`, `Contacted`, `Interested`, `Qualified`, `Won`, `Churned`; Lifecycle stage auto-promotes to `Sales Qualified Lead` when Status reaches `Qualified`. Example created contact: "Explore AgentTestLead" (`explore.agent.testlead@example.com`), id `402219350782`.
- **Account:** created inline from the Add Contact form's "Add new account" affordance. Example: "Explore Test Co", resolvable via `GET /crm/sales/sales_accounts?name=Explore+Test+Co`.
- **Deal / pipeline:** Default Pipeline stage order confirmed on the Kanban board: `New, Qualification, Discovery, Demo, Negotiation, Won, Lost`. Example created deal: "Explore Test Co - Pipeline Kanban Test Deal", id `402012367593`, $2,500, moved via stage-pill clicks on the deal detail page (`/crm/sales/deals/<id>`), not drag-and-drop.
- **Activities:** Task creation confirmed via `POST /crm/sales/tasks` -> 201, visible in the deal's Activities > Tasks tab. Example: "Follow up with Explore Test Co on negotiation terms," due date set, owner assigned, not completed. Call and Note creation endpoints were not directly captured in this crawl but the same "+"-quick-create / deal-detail "Sales activities" action set (Add task, Add meeting, Add call log observed in the quick-create menu) is the mechanism to use — automation agents should discover the exact Call/Note endpoints live during test execution since they weren't captured by explore-agent.
- **Relevant API endpoints (from crawl-log, for api-testing-agent):**
  - Contacts: `POST /crm/sales/contacts`, `GET/PUT /crm/sales/contacts/<id>`, `/duplicates`, `/connections`, `/notes`
  - Accounts: `POST /crm/sales/sales_accounts`, `GET /crm/sales/sales_accounts`
  - Deals: `POST /crm/sales/deals`, `PUT /crm/sales/deals/<id>` (stage transitions), `GET /crm/sales/deals/<id>/tasks`, `/sales_activities`, `/activity_counts`
  - Activities: `POST /crm/sales/tasks` (confirmed 201)
  - Selectors/config: `/crm/sales/selector/{lifecycle_stages,contact_statuses,deal_pipelines,deal_stages,deal_reasons,owners,teams,territories,business_types,industry_types,sales_activity_entity_types}`, `/crm/sales/settings/deal_pipelines?include=deal_stages`
  - Kanban: `POST /crm/sales/deals/kanban_headers`, `/kanban_funnels`, `GET /crm/sales/deals/view/<id>/aggregated_data?group_by_type=deal_stage_id&group_by_value[]=...`
- **created-entities.json format to follow for this run's live execution** (established precedent from explore-agent's own file at `artifacts/rakesh-freshsales-ind-sep21/explore/created-entities.json`): an array of objects with `type`, `identifier`, `url`, `createdAt`, and `note` fields, one entry per entity created (account, contact, deal, task/call/note).

---

## Open questions

1. **Duplicate-email check UX** (edge case #6 above): the exact user-facing behavior when creating a Contact with an email that already exists (block vs. warn-and-allow, and what the warning looks like) was not confirmed by the human and was not directly exercised by explore-agent, despite a `/duplicates` endpoint being observed in network traffic. Flagged for human follow-up if precise duplicate-handling test cases are required beyond a best-effort assumption.
2. **Exact required-field list per form** (edge case #4/#5): no enumerated list of every required field on the Contact/Account/Deal creation forms was confirmed; only the general pattern (required-field-missing -> inline error, invalid email -> inline error) was defaulted. If a specific required-field matrix is needed, it should be confirmed with a human or derived directly from the live form's DOM during test execution.
3. **Won/Lost stage coverage and drag-and-drop Kanban interaction** (Questions 3 and 4) were answered via orchestrator config-applied defaults, not direct human confirmation. These are flagged as assumptions in the Edge cases table above; if a human reviewer disagrees with treating Won as the primary terminal path (rather than stopping at Negotiation, as explore-agent actually did) or with treating drag-and-drop as merely a nice-to-have, that should be raised before test execution proceeds on those specific cases.
