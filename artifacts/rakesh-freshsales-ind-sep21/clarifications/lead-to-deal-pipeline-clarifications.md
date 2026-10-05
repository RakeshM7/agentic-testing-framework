# Clarifications: lead-to-deal-pipeline (target: rakesh-freshsales-ind-sep21)

## Feature summary
Create a prospect, qualify it, link it to a Contact and Account, create a Deal from it, move the deal across the default sales pipeline Kanban stages, and log activities (Task, Call, Note) against the deal. Because the Leads module returns 403 for the test role, the flow uses the Contact-status substitution (human/config-confirmed, Q1).

## In scope / Out of scope
In scope:
- Create Contact (default Status=New / Lifecycle=Lead).
- Advance Contact Status to "Qualified" (auto-promotes Lifecycle stage to "Sales Qualified Lead").
- Contact linked to a new Account (or an existing one if the UI offers it).
- Create Deal via Deals "+ New Deal" form with contact and account linked.
- Move one deal through all stages of the default pipeline, first to last, forward one stage at a time, via Kanban drag-and-drop.
- Log Task, Call and Note via the deal detail/summary panel; verify in deal timeline.
- Validation-only negative cases (see Edge cases).

Out of scope:
- Leads module coverage, including a dedicated 403 negative test.
- Stage skipping, backward moves, closing as Won or Lost.
- Non-default pipelines.
- Other test-case formats (only CSV).
- Q12 (not answered by config): treated as out of scope by default, flagged (see Open questions).

## Confirmed behaviors
- Q1: Contact-status substitution is the approved approach; Leads module is skipped.
- Q2: Qualification = set Contact Status to "Qualified"; expected Lifecycle stage auto-promotes to "Sales Qualified Lead". Use these exact values.
- Q3: Contact linked to a new (or offered existing) Account. Record observed links/ownership/stage values; anything unconfirmed is flagged.
- Q4: Deal created through "+ New Deal" with contact and account linked; required deal fields derived from live form validation.
- Q5: Default pipeline; one deal moves through all stages in order, one at a time; assert card appears in target column and persists after reload.
- Q6: Task, Call, Note with standard coverage; required fields derived from live UI; verified in the deal timeline.
- Q7: Authorization mode is `full-run`, confirmed for this trial tenant only. (a) Positive/mutating submissions execute live, scoped to run-created entities tracked in created-entities.json; deletes/cancels only on those. (b) Validation-blocked negative submissions also run live.
- Q8: Validation-only negatives are included; record observed error messages.
- Q10 [default]: only run-created entities with unique prefixed names are touched; pre-existing data is never modified or deleted.
- Q11 [conservative default, not user-confirmed]: no cleanup beyond run-created entities; leave created entities in place unless cleanup is trivially scoped to created-entities.json.
- Q13: Output format is CSV.

## Edge cases
| Scenario | Expected behavior |
|---|---|
| Create Contact with missing required field | Blocked by validation; record observed message (live, non-mutating) |
| Contact with invalid email | Blocked by validation; record observed message |
| Contact with invalid phone | Blocked by validation; record observed message |
| Deal with empty name | Blocked; record observed message |
| Deal with non-numeric amount | Blocked or rejected; record observed message |
| Task with no title | Blocked; record observed message |
| Skip a stage / move backward / Won / Lost | Not covered; flag as unconfirmed case (Q9 default) |
| Other unlisted edge cases (duplicates, permissions, concurrent edits) | Unconfirmed; flagged, not asserted |

## Non-functional constraints
None raised. Tests must use unique prefixed names for created entities (Q10).

## Confirmed test-case output format
CSV

## Open questions
- Q9: Behavior for stage skipping/backward moves/Won/Lost is unconfirmed and not covered.
- Q11: Cleanup/teardown policy not confirmed by a human; conservative default applied.
- Q12: Treated as out of scope by default; not confirmed by a human (Pass 1 topic unanswered).
- Whether the UI offers selecting an existing Account vs only creating a new one: unconfirmed; determine from live UI.
- Exact required fields, error message text, deal stage names/count of the default pipeline: to be taken from live UI observation.
- Q10 is a config default, not a human answer.
- Explore-agent's Contact-for-Lead substitution was confirmed via Q1 (config); no further caveat outstanding.
