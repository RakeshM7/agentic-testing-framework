# Clarifications: Conversations module (conversations)

Target: rakesh-freshsales-ind-sep21 (Freshsales trial tenant). Sources: answers-block.md, answers-block-round2.md, explore/flows/index.json, explore/crawl-log.md.

## Feature summary
Verify and navigate the Freshsales Conversations module: email folders (Inbox, Sent, Scheduled, Drafts, Trash, Awaiting Response), email tracking (Opens, Clicks, Bounces), Bulk Email, Phone/Voicemail, SMS and SMS templates, Team Inbox setup page (open-only), and Conversation Groups. Create/edit/delete is limited to email templates. Covers all 14 flows in explore/flows/index.json.

## Active authorization mode
`authorizations.mode = full-run` (set explicitly by the user for their own trial tenant). Deletes/cancels only for entities this run created.
- (a) Submissions that could succeed and mutate data (create/edit/delete email template): allowed live, only on run-created, ZZ-prefixed templates.
- (b) Validation-blocked submissions (e.g. empty-name Save): non-mutating, run live.

## In scope / Out of scope
In scope:
- Navigation of the Conversations module and all sub-areas listed above (flows: open-conversations-module, browse-email-folders, open-email-thread, view-email-tracking, view-bulk-email, view-phone-and-sms, view-team-inbox-setup).
- browse-email-folders and open-email-thread: confirmed to be generated (round 2), with non-count assertions only (see Confirmed behaviors).
- Open-only composer/reply (reply-to-email-draft-only, compose-new-email-draft-only): open and close, never send.
- Email template create, filter, open edit drawer, delete single and bulk (create-email-template, search-filter-email-templates, edit-email-template-view, delete-email-template).
- Email template Clone, Edit-save, list search box, Use template, Insert fields, Attach (as expected-behavior cases; see Open questions for expected results).
- Conversation Groups (answered: part of this module).
- SMS template creation flow (create-sms-template) is documented but skipped (see Open questions).

Out of scope for live execution and test generation (confirmed "Yes"):
- Sending/replying/forwarding emails, template Share, Connect Gmail/Outlook (and provider tiles), Add Team Inbox, Set up SMS, Power Dialer, Chat Inbox.
- Also skipped by explore: Request demo, Explore plans (billing).

## Confirmed behaviors
- Output format is CSV (run-config and answers).
- Mode is full-run; deletes limited to run-created entities. (run-config)
- Edit-save and delete tests may touch only run-created ZZ-prefixed email templates, never the 9 system-seeded Public templates. (Q: seeded templates)
- A duplicate email-template name is auto-suffixed with a timestamp, and the template list refreshes without reload after create. (Q: duplicate name)
- Inbox/Sent sample emails are NOT stable test data; do not assert counts (e.g. "3 inbox / 3+ sent"). (Q: seeded emails, answer "no")
- Generate browse-email-folders and open-email-thread cases despite unstable seeded data. (Round 2 Q: generate these cases at all; answer "Yes".) Assertions are limited to: folder list/view renders, and a thread opens if at least one email is present. No count, sender, or subject assertions.
- Conversation Groups belong to the Conversations module. (Q: Conversation Groups)
- SMS template creation currently fails ("Template creation failed") likely because no SMS provider is set up; the case is skipped. (Q: SMS template)
- Observed (explore): first Save of a new email template with typed name showed no toast but persisted; assert on list row, not toast, until the toast question is resolved.

## Edge cases
| Scenario | Expected behavior |
|---|---|
| Create email template with a name already in use | Name auto-suffixed with a timestamp; list refreshes without reload (confirmed) |
| Save email template with empty name/body | Validation message shown, nothing persisted (message text per explore flow create-email-template; non-mutating, runs live) |
| Create SMS template with valid name/body | Observed failure "Template creation failed"; case skipped, flagged for later |
| Edit/delete a seeded Public template | Must not be done by tests (confirmed) |
| Bulk delete of templates | Only on run-created ZZ templates (confirmed) |
| Empty folders (Scheduled, Drafts, Trash, Bulk, Bounces) | Observed empty at explore time; treat as observation, not a guaranteed contract |
| Inbox/Sent/Opens/Clicks lists | Assert list renders only; no count assertions |
| Open email thread when the folder has no emails | Case should skip/pass-conditionally (assumption: thread-open is asserted only when a row exists) |

## Non-functional constraints
- Baseline console noise on every page (3 errors, ~9 warnings: resource 4xx, expired Appcues); tests should not fail on these.
- Role used: Organization Admin (Rakesh M), authenticated via session state.
- No performance/accessibility requirements raised.

## Confirmed test-case output format
CSV

## Open questions
Default policy for items below: assume-standard-and-flag / flag-as-unconfirmed-case. Cases drawn from these must be marked as assumptions in the CSV.
1. (Resolved in round 2) Seeded emails: browse-email-folders and open-email-thread are generated with non-count assertions. Residual assumption (flagged): "a thread opens" is asserted only if an email row exists; this conditional behavior was not explicitly stated by the human.
2. Success toast on email template save: the earlier answer "Yes" does not choose between "toast expected" and "silent save acceptable". Default assumption (flagged): assert on the list row; toast not asserted.
3. Email template Name/Body validation rules (max length, special characters/HTML, required Subject, trimming): answer was a bare "Yes", giving no rules. Only the empty-save message is known. Default assumption (flagged): only the empty-save case is tested as a spec; other validation cases are unconfirmed.
4. Clone, Edit-save, search box, Use template, Insert fields, Attach: answer "Yes" does not state expected behavior (e.g. Clone name suffix). Default assumption (flagged): draft cases from standard behavior (clone creates a copy; edit-save persists changes; search filters the list), marked unconfirmed; assert only on observable results.
5. SMS template creation: skipped by the human; flagged for later pending an SMS provider being set up.
6. Coverage gaps from explore: network-requests.json and console-log.txt are placeholders; Awaiting Response contents, mail-list row checkboxes and bulk actions, Inbox row kebab menus, "Email linked to contacts, deals" menu were not exercised; Sales Sequences tab belongs to another module.
7. Conversation Groups: confirmed in scope, but no explore flow exists for it in flows/index.json, so no observed behavior. Default assumption (flagged): generate only navigation/open-and-render cases, marked unconfirmed.
8. Discovery contradiction (no mailbox connected vs. seeded emails present) is recorded; seeded data is treated as unstable.

## Follow-up Questions
- [Edge Case] [Nice-to-have] What are the rules for email template Name and Body (max name length, special characters/HTML, required Subject, trimming)? Navigate: Conversations > Email Templates > Create EMAIL template (flow create-email-template).
- [Behavior] [Nice-to-have] What is the expected result of template Clone (copy name/suffix) and Edit-save? Navigate: Conversations > Email Templates > row menu > Clone / Edit (flow edit-email-template-view).
- [Behavior] [Nice-to-have] Which Conversation Groups behaviors should be tested (no explore flow exists)? Navigate: Conversations left nav, Groups section (no flow captured).
