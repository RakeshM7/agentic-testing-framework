# Contacts module clarifications (Freshsales, trial tenant rakesh-freshsales-ind-sep21)

Sources: answers-block.md (human answers), pass1-questions.json, explore/crawl-log.md, explore/flows/index.json. No requirement docs.

## Feature summary
Verify create / edit / clone / delete, search / filter / sort / navigate, and related actions for Contacts in Freshsales CRM. A "Lead" is not a separate module: it is a Contact whose Lifecycle stage = Lead (new contacts default to Lifecycle stage Lead, Status New). Test cases cover every flow in explore/flows/index.json (16 flows: open-contacts-list, switch-contact-view, filter-contacts, sort-contacts-column, customize-contacts-table, contact-bulk-actions, contact-row-actions, import-contacts-entry, create-contact, view-contact-detail, update-contact, clone-contact, change-lifecycle-stage, contact-activity-actions, add-contact-note, delete-contact).

## In scope / Out of scope
In scope:
- Contacts list: default view, saved views incl. Recycle Bin, search box, Filter by, column sort, Customize table, row actions, bulk actions on run-created contacts.
- Add / Edit / Clone / Delete contact (and Recycle Bin restore of run-created contacts), duplicate-email blocking, mandatory-identifier rules.
- Contact detail page and tabs, Lifecycle stage change, note / task / meeting / call log / email forms on run-created contacts.
- Import contacts modal (file types and field mapping behaviour).
- Validation-only negative cases, run live.

Out of scope / not authorized:
- Touching the 2 pre-existing AgentTest contacts (never edit/delete/bulk-select them).
- Deleting or changing any entity the run did not create.
- Lead as a separate module (does not exist in this tenant).
- Other modules (Accounts, Deals) except as reached from a contact tab.

## Authorization basis
`authorizations.mode` = full-run (set explicitly by the user for their own trial tenant; answers-block "From run-config" and the scope answer). Deletes only on entities this run created (tracked in created-entities.json).
- (a) Submissions that could succeed and mutate data (create, edit, clone-save, lifecycle save, bulk actions, note/task/meeting/call log/email submit, delete, restore): permitted live, on run-created contacts only.
- (b) Submissions expected to be blocked by validation before mutation (empty identifiers, invalid email, duplicate email, Lost without Lost reason, call log without Outcome): permitted live (explicitly confirmed "Yes"), and would run live in any mode.

## Confirmed behaviors
- Output format is CSV (run-config testcases.output_format).
- B1. Lifecycle stage = Lost makes Lost reason mandatory; any other stage change has no restrictions (Q: lifecycle transition rules).
- B2. Bulk actions visible to the user are permitted; actions not authorised are hidden by RBAC (Q: bulk actions). Tests assert visible CTAs work; absence of a CTA is not a failure.
- B3. Contacts with a duplicate email are blocked on Save (Q: duplicate rules).
- B4. Import contacts modal accepts CSV or xlsx; auto-maps CSV headers that exactly match Contact fields; the user can map the rest manually and may change auto-mapped fields (Q: import).
- B5. At least one of Email / Mobile / External ID is mandatory (Q: Email mandatory). A contact with only Mobile (no Email) must save successfully (Q: mobile-only, answer "Yes").
- B6. Duplicate-email block also applies to Clone and Edit (changing email to an existing one) (answer "Yes" to that question; see Open questions for the unanswered message wording).
- B7. Lead = Contact with Lifecycle stage Lead; verify via the Lifecycle stage field, not the list column Status (Qualified etc.) (Q: Lead scope, "Yes").
- B8. Live create/edit/delete, bulk actions, clone-save, lifecycle-stage save are allowed on run-created contacts only (Q: full-run scope, "Yes").
- B9. Validation-only negatives (empty identifiers, "not-an-email", over-length, invalid mobile) are run live as non-mutating checks (Q: negative cases, "Yes").
- B10. Deleted contacts should appear in Recycle Bin (retained 90 days per UI text) and be restorable; tests verify this for run-created contacts (Q: Recycle Bin, "Yes").
- B11. Search, Filter by and column sort are to be exercised and their application verified (Q: search/filter/sort, "Yes").
- B12. Note, task, meeting, call log and email forms may be submitted live on run-created contacts; call log Outcome is mandatory; meeting save sends no invitations (from earlier answers cited in the question; Q: activity forms, "Yes"). Email submit: use only run-created contacts with a non-deliverable/test address.
- B13. Clone pre-fills the form and requires a unique email/identifier before Save; clearing optional fields such as Job title in Edit/Clone is allowed (Q: edit/clone, "Yes", interpreted as confirming both parts; see Open questions).

## Edge cases
| Scenario | Expected behavior |
|---|---|
| Save with Email, Mobile and External ID all empty | Blocked by validation (observed: "You need to fill this field" on Email); exact all-empty message wording not confirmed |
| Save with only Mobile filled | Saves successfully (B5) |
| Save with "not-an-email" in Email | Blocked by validation (observed in explore: contacts-add-form-invalid-email) |
| Create with email already used by another contact | Blocked (B3) |
| Clone and save without changing email | Blocked as duplicate (B6) |
| Edit existing run-created contact to an email used by another contact | Blocked (B6) |
| Lifecycle stage set to Lost without Lost reason | Blocked; Lost reason mandatory (B1) |
| Lifecycle stage set to any non-Lost stage | Saves, no restrictions (B1) |
| Call log submit without Outcome | Blocked; Outcome mandatory (B12) |
| Delete run-created contact | Confirm dialog, then contact appears in Recycle Bin (90 days); restorable (B10) |
| Import with CSV/xlsx whose headers exactly match fields | Auto-mapped; user may remap (B4) |
| User lacks permission for a bulk action | CTA hidden, not an error (B2) |
| Over-length field / invalid mobile format | Expected to be rejected, but limits/format rules not provided (Open questions) |

## Non-functional constraints
- Authenticated as owner/admin "Rakesh M" via storage state; RBAC hides unauthorised CTAs.
- Test data must be uniquely named per run and tracked in created-entities.json; cleanup deletes only those entities.
- No secrets inline; credentials by path only.

## Confirmed test-case output format
CSV

## Open questions
Non-answers and gaps (do not treat as spec):
1. Duplicate block message/UI: asked "what exact message and UI behaviour (inline, banner, duplicates panel)"; the answer "Yes" does not answer it. Only the block itself and its application to Clone/Edit are confirmed. Explore saw a "Check for duplicates" panel in the Add form (flow create-contact). Expected message wording is unknown.
2. Exact error message when Email, Mobile and External ID are all empty is unconfirmed; the answer "Yes" only confirms mobile-only saves.
3. Internal tension: explore observed Add form flagging only Email with "You need to fill this field" while Mobile was empty, versus the answer that any of Email/Mobile/External ID suffices. Likely the inline error appears only when all three are empty, but this was not verified; testcase generator should assert behavior (save succeeds with Mobile only) rather than the Email-field-required indicator.
4. Field length limits and mobile format rules: not provided (answer "Yes" to a two-part question granted permission only). Over-length and invalid-mobile cases need concrete expected values; until provided, generate them as "rejected with validation error, value TBD".
5. Search / Filter / sort: answer "Yes" gives no spec. Search fields matched, filter operators and sort persistence are unspecified; assume standard behavior (matching rows only; asc/desc ordering) and flag as assumption.
6. Activity forms: answer "Yes" gives permission only; the post-save behavior (what appears in the timeline/Activities tab) is unspecified.
7. Clone/edit question had two parts (clearing optional fields; Clone pre-fill and unique email); single "Yes" is ambiguous per part. Treated as confirming both (B13).
8. Whether Recycle Bin restore is available to this role for run-created contacts is assumed from "Yes"; unverified.
9. Coverage gaps from crawl-log still unverified live: other saved views' content (My contacts etc.), Add new view, Customize table Apply, view toggle options (Table/Status/Group by), Export, Unsubscribe, Forget, Add to sequence, tags, Manage fields, View field edit history, row inline edit ("+ Click to add"). Import wizard beyond B4 (e.g. error handling, duplicate rows) not specified.
10. Feature-mapping caveat (Lead substitution) is resolved by B7; Status vs Lifecycle stage relationship (Status Qualified vs Lifecycle Lead) is not documented beyond the field distinction.

## Follow-up Questions
- [Behavior][Nice-to-have] What exact message and UI (inline on Email, banner, or Duplicates panel) appears when saving a contact with a duplicate email, on Create, Clone and Edit? Navigate: Contacts > Add contact > enter an existing contact's email > Save (flow create-contact; also flows clone-contact, update-contact).
- [Behavior][Nice-to-have] What exact error shows when Email, Mobile and External ID are all empty on Save? Navigate: Contacts > Add contact > leave Email/Mobile empty > Save (flow create-contact).
- [Edge Case][Nice-to-have] What are the maximum lengths for First name, Last name, Job title and Email, and what mobile format is accepted or rejected? Navigate: Contacts > Add contact > enter long or malformed values > Save (flow create-contact).
- [Behavior][Nice-to-have] Which fields does the Contacts search box match (name, email, mobile), and which operators does Filter by offer for text and Lifecycle stage fields? Navigate: Contacts > search box / Filter by (flows filter-contacts, open-contacts-list).
