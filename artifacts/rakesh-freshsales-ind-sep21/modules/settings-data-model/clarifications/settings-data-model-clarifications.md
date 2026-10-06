# Clarifications: settings-data-model

## Feature summary
Verify and navigate the Freshsales admin data-model settings: contact and account fields/layouts, custom modules, contact lifecycle stages, contact scoring, web forms, CRM code library, LinkedIn Lead Gen forms, and tags. Coverage target is every flow in `explore/flows/index.json` (11 flows): open-settings-data-model-pages, view-add-contact-field-options, view-contact-fields-list, view-account-fields-list, view-custom-modules-and-add-module-form, view-lifecycle-stages, view-contact-scoring, view-web-forms, view-crm-code-library, view-linkedin-lead-gen, view-tags. No requirement documents were supplied; behavior comes from explore artifacts plus the human answers (round 1 and round 2).

Basis for live execution: `authorizations.mode = full-run` (set explicitly by the user for their own trial tenant). Deletes/cancels are limited to entities the run itself created (tracked in `created-entities.json`; currently `[]`).

## In scope / Out of scope
In scope:
- Admin Settings > Leads, Contacts, & Accounts group: Contacts and Accounts field/layout editors, Add field overlay (Text field and other types), Custom Modules (Add module), Contact Lifecycle Stages, Contact Scoring, Web Forms, CRM Code Library, LinkedIn Lead Gen Forms.
- Admin Settings > Account Settings > Tags (confirmed as the intended "tags" flow).
- Create-then-delete of run-owned ZZ-Explore fields, tags, custom module, lifecycle stages, web form (and LinkedIn Lead Gen form if a connection is available).
- Negative/validation-only submissions on Add field, Add module, Add lifecycle stage, Add tag.

Out of scope:
- Modifying or deleting pre-existing/seeded data (13 existing tags, seeded fields, seeded lifecycle stages and rules) except as noted under Open questions.
- Website Embed Code (marketer-app link, not followed).
- Field dependencies page, per-field Edit field panel internals, and other items in the crawl-log Coverage gaps unless a human adds them (see Open questions).

## Confirmed behaviors
- Mode and format: full-run; output format CSV (run-config + "output format" answer).
- Feature mapping (Q: feature-mapping caveat): Account Settings > Tags and the Contacts/Accounts field/layout editors are the intended "tags" and "contact/account fields" flows. Answer: Yes.
- Create/delete of ZZ-Explore fields and tags in this admin area is authorized (Q: authorise explorer). Answer: yes.
- Custom module: tests may create and delete a ZZ-Explore custom module (internal name cm_ prefix). Answer: Yes.
- Web Forms and LinkedIn Lead Gen forms: tests may build, save and delete them. Answer: Yes. (Web forms are public-facing; none exist today.)
- Limits are enforced on custom fields/modules/stages (Q: limits/reserved names). Answer: "Limits are enforced". The round-2 answer to the exact-limits question was "Explore and find out" (a non-answer, see Open questions 1); no limit values are confirmed.
- Contact mandatory identity: at least one of Email / Mobile / External ID is mandatory on a contact, even though Email's Required checkbox appears unchecked (Q: Email mandatory).
- Lifecycle stage disabled or deleted: existing contacts move to the first lifecycle stage (Q: stage disable/delete).
- Add field form requires Field label, Internal name (cf_ prefix), Field type; "Add selected" stays disabled until a field/type is chosen (explore-observed).
- Observed seeded state: no custom modules, no web forms, no LinkedIn forms, no scoring signals; scoring threshold 70; 13 record tags; auto-rules (deal added -> Sales Qualified Lead; deal won -> Customer) enabled.

### Live-execution rulings
- (a) Submissions that could succeed and mutate data: permitted live under full-run, only for run-created ZZ-Explore entities, with cleanup of each (delete) afterwards.
- (b) Negative/validation-only submissions expected to be blocked before any save (empty required fields on Add field, Add module, Add lifecycle stage, Add tag): permitted live in every mode (Q: negative submissions). Answer: Yes. They are non-mutating and run live regardless of mode.

## Edge cases
| Scenario | Expected behavior |
|---|---|
| Add field with empty Field label / Internal name / Field type | Blocked before save (required fields). Message text not observed. |
| Add field with duplicate label, duplicate or invalid-character internal name, or name clashing with a system field | Expected to be rejected; exact message text unknown (see Open questions). |
| Exceeding custom field / module / stage limits (trial plan) | Limit enforced; limit values and message unknown. Unconfirmed case: tests should observe the actual limit/message live, and must not create more than a few ZZ-Explore entities to probe it (any probe entities must be deleted). |
| Save contact with none of Email / Mobile / External ID | Expected to fail as mandatory identity is missing (per answer); message unobserved. |
| Disable or delete a lifecycle stage that has contacts | Contacts move to the first lifecycle stage. |
| Add module / lifecycle stage / tag with empty required fields | Blocked before save; non-mutating, runs live. |
| Add web form / LinkedIn Lead Gen form | LinkedIn form needs a LinkedIn connection; if unavailable, record as blocked precondition. |

## Non-functional constraints
- Auth: account owner/admin session (Rakesh M) via sessionStateFile; admin can open all pages.
- Tenant is a trial ending about 8 days after the crawl (trial plan limits apply); tests should clean up promptly and use the ZZ-Explore prefix for all created entities.
- Baseline console noise on every page: 3 errors / 9 warnings; do not treat as test failures.
- Contacts field list is virtualised; only the first group was captured, so automation must scroll before asserting on later groups.

## Confirmed test-case output format
CSV

## Open questions
1. Limits (round 1 answer was a research instruction; round 2 answer "Explore and find out" is also not a value): actual max custom fields, custom modules, lifecycle stages, web forms on this plan and the validation message text are not established. Flagged default assumption (flag-as-unconfirmed-case): generate limit test cases as "observe and record" cases with expected result "limit enforced, message text to be captured live", with no hard-coded numeric limit; the testcase/automation stage (or a human) should look up the Freshsales knowledge base or observe live. Downgraded from blocking.
2. Add field validation messages: the question asked what should happen on empty/duplicate/invalid/system-clash names and for message text; the answer was a bare "Yes" and is not usable as spec. Expected messages remain unknown; must be observed live. Default: assert that save is blocked/rejected, not exact text.
3. Custom module deletion: permission to create/delete was granted ("Yes"), but whether Freshsales actually permits deleting a custom module (vs permanent, leaving tenant clutter) was not answered. Default: attempt delete for cleanup; if not possible, record the leftover ZZ-Explore module in `created-entities.json` and flag it.
4. Lifecycle stages and auto-rules: the question was either/or (may tests toggle/reorder/add/delete seeded stages and the two auto-rules, or only run-created ZZ-Explore stages); the answer was a bare "Yes". Not treated as spec. Default until clarified: modify only run-created stages and leave seeded stages and the two auto-rules untouched (consistent with the run-created-only delete guardrail).
5. Contact Scoring: question was either/or (add signals and change threshold of 70, or view-only); answer was a bare "Yes". Default until clarified: view-only for the threshold; any signal created must be run-owned and removed afterwards.
6. Possible tension: the Email answer ("Either Email / mobile / External ID is mandatory") differs from the UI, where Email shows no Required flag; the rule is likely enforced at contact-save level, not field level. Confirm exact rule (any one of three, or per-setting).
7. Coverage gaps carried from crawl-log (not yet explored, so behavior is unknown): per-field Edit field panel, Add group, Rename module, Preview, Field dependencies, choices editor, further contact field groups, Web form builder, CRM code library Get started, LinkedIn Add form, other Tags tabs (Email Template, SMS Template, File) and row actions, Add signal drawer, lifecycle edit/toggle/rules dropdowns, per-page network/console capture.
8. Prior explorer attempt to save a ZZ-Explore field was denied by the auto-mode permission classifier; the human has now authorized it, but the automation run may still hit that classifier. Record any repeat denial rather than working around it.

## Follow-up Questions
None
