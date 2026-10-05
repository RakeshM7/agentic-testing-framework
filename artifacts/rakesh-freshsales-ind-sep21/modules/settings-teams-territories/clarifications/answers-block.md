# Answers block for module settings-teams-territories (human answers, verbatim)

## From run-config
- Test-case output format: CSV (config testcases.output_format and answers entry "output format").
- authorizations.mode: full-run (set explicitly by the user for their own trial tenant); deletes only for entities the run created.

## Answers from open-questions.csv (explorer questions, answered by the human)
- Q: [Behavior][Nice-to-have] What validation messages appear for Add user (invalid/duplicate email), Create role, Create territory, Create team?
  A: Do a manual exploration through explicit approval and find out;
- Q: [Scope][Nice-to-have] Is Conversation Groups part of this module or the Conversations module (explore found Sales Teams under Teams & Territories instead)?
  A: Part of conversations module

## Answers from the clarification answer sheets (Pass 1 questions)
- Q: [Scope][Blocking] Under full-run, may tests create and then delete run-created ZZ-Explore-prefixed roles, territories, teams and auto-assignment rules in this tenant (deletes limited to entities the run created)?
  A: Yes
- Q: [Behavior][Blocking] For Add user (invites are out of scope), should tests only open the form and verify validation-blocked submits (empty or invalid email) and then cancel, never saving a valid user?
  A: Yes
- Q: [Behavior][Blocking] May a created auto-assignment rule be set to Enable (which would route live new contacts), or must tests only use Save as draft?
  A: Yes
- Q: [Behavior][Nice-to-have] Create role requires a name and a role to clone: should tests verify the cloned permission matrix matches the source, and is a duplicate role name rejected?
  A: Yes
- Q: [Edge Case][Nice-to-have] A team needs at least one member and the tenant has only one active user (Rakesh M): is adding the admin as sole member the expected test path, and are duplicate team or territory names rejected?
  A: Yes
- Q: [Behavior][Nice-to-have] Territory hierarchy and Auto-assign territory to records in Advanced settings are tenant-wide toggles: may tests toggle them (and restore the original state), and does parent/child territory creation depend on the hierarchy setting being on?
  A: Yes
- Q: [Scope][Nice-to-have] Should tests cover the Deactivated/All users tabs, org chart, filters and the Sales Manager/Administrator/Restricted User permission matrices (not explored), or only the 10 flows in flows/index.json?
  A: Yes
