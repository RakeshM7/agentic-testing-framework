# Clarifications: settings-teams-territories

Source: answers-block.md (human answers), explore/flows/index.json (10 flows), pass1-questions.json.

## Feature summary
Verify and navigate Freshsales Admin Settings > Teams & Territories: Users, Roles (and permission matrices), Territories (incl. Advanced settings), Auto-assignment Rules, and Sales Teams. Coverage targets every flow in explore/flows/index.json: view-users-list, open-add-user-form, view-roles-list, open-create-role-dialog, view-role-permissions, view-territories, open-create-territory-dialog, view-auto-assignment-rules, open-create-rule-form, view-sales-teams.

## In scope / Out of scope
In scope:
- The 10 flows above (read/navigation and create-dialog/form flows).
- Create then delete of run-created ZZ-Explore-prefixed roles, territories, teams and auto-assignment rules.
- Add user form: open, validation-blocked submits, cancel.
- Toggling the tenant-wide territory settings (hierarchy, auto-assign territory) with restore.

Out of scope:
- Inviting/saving a real user, billing, import (per feature goal).
- Conversation Groups (answer: belongs to the Conversations module).
- Pre-existing or other users' entities (never modified or deleted).

## Active authorization basis
authorizations.mode = full-run (set explicitly by the user for their own trial tenant). Deletes/cancels are limited to entities this run created (track in created-entities.json).
- (a) Submissions that could succeed and mutate data: permitted live for roles, territories, teams, rules (ZZ-Explore- prefix, then clean up). EXCEPTION: Add user, where a valid user must never be saved.
- (b) Submissions expected to be blocked by validation before mutation (empty/invalid email, missing name, etc.): permitted live in any mode, including for Add user.

## Confirmed behaviors
- Output format: CSV (run-config testcases.output_format) [output format].
- Tests may create and delete run-created ZZ-Explore- roles, territories, teams and auto-assignment rules; deletes only for run-created entities [Q: create/delete under full-run].
- Add user: tests only open the form, verify validation-blocked submits (empty or invalid email), then cancel; never save a valid user [Q: Add user].
- Create role: tests verify the cloned permission matrix matches the source role [Q: Create role; "Yes"].
- Team creation: adding the admin (Rakesh M, the only active user) as sole member is the expected test path [Q: team].
- Territory hierarchy and Auto-assign territory to records toggles may be changed by tests, and the original state must be restored afterwards [Q: Advanced settings].
- Conversation Groups is not part of this module [Q: Conversation Groups].

## Edge cases
| Scenario | Expected behavior |
|---|---|
| Add user, empty email submit | Blocked by validation, nothing saved; message text not yet captured (see Open questions) |
| Add user, invalid email submit | Blocked by validation, nothing saved; message text not yet captured |
| Create team with no members | Not allowed (team needs at least one member, per explore); message text unknown |
| Create team with admin as sole member | Expected happy path |
| Create role without name or without role to clone | Blocked (explore observed both are required); message text unknown |
| Toggle territory hierarchy / auto-assign, then restore | Allowed; final state must equal original |

## Non-functional constraints
- Safety: full-run gates; deletes only for run-created entities; ZZ-Explore- prefix on every created entity.
- Auth: single tenant, admin user Rakesh M; credentials via .env path only.

## Confirmed test-case output format
CSV

## Open questions
1. Validation messages for Add user (invalid/duplicate email), Create role, Create territory, Create team: answer was "Do a manual exploration through explicit approval and find out". This is a non-answer; expected message text is NOT specified. Needs a human-approved manual exploration before assertions on exact text.
2. Enabling an auto-assignment rule: question was "May a rule be set to Enable, or only Save as draft?" and the answer was a bare "Yes". Ambiguous. Enabling would route live new contacts. Treat as unresolved: default to Save as draft only until a human confirms Enable is allowed (and whether it must be disabled/deleted right after).
3. Duplicate role name: answer "Yes" to a compound question; unclear whether a duplicate is rejected. Expected behavior unconfirmed.
4. Duplicate team or territory names: "Yes" to a compound question; unclear whether rejected. Expected behavior unconfirmed.
5. Whether parent/child territory creation depends on the hierarchy setting being on: "Yes" was given to a compound question; dependency not clearly stated.
6. Scope breadth: question asked "Deactivated/All users tabs, org chart, filters and unexplored Sales Manager/Administrator/Restricted User matrices, OR only the 10 flows"; the answer was a bare "Yes" to an either/or question. Unresolved. Contradiction to record: the feature goal says "every flow in flows/index.json" (10 flows), while "Yes" may imply the extra, unexplored coverage. Baseline = the 10 flows; extras are unexplored (no flow files) and treated as optional pending confirmation.
7. Coverage of Conversation Groups: deferred to the Conversations module; confirm that module's track covers it.

## Follow-up Questions
- [Behavior][Blocking] Is Enable (not just Save as draft) allowed for a run-created auto-assignment rule, given it would route live new contacts, and should it be disabled and deleted immediately after? Navigate: Teams & Territories > Auto-assignment Rules > Create rule > Save as draft / Enable (flow open-create-rule-form).
- [Scope][Nice-to-have] Choose one: (A) only the 10 flows in flows/index.json, or (B) also Deactivated/All users tabs, org chart, filters and the other role permission matrices? Navigate: Users > All / Active / Deactivated tabs (flow view-users-list); Roles > any role (flow view-role-permissions).
- [Edge Case][Nice-to-have] Is a duplicate role, team or territory name rejected (yes/no for each)? Navigate: Roles > Create role (flow open-create-role-dialog); Territories > Create territory (flow open-create-territory-dialog); Sales Teams > Create team (flow view-sales-teams).
- [Behavior][Nice-to-have] Does creating a child territory require Territory hierarchy to be turned on (yes/no)? Navigate: Teams & Territories > Territories > Advanced settings (flow view-territories).
- [Behavior][Nice-to-have] Please approve the manual exploration of validation messages (Add user, Create role, Create territory, Create team), limited to validation-blocked submits. Navigate: Users > Add user (flow open-add-user-form); Roles > Create role (flow open-create-role-dialog).
