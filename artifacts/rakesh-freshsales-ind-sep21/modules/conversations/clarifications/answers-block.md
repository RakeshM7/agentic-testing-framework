# Answers block for module conversations (human answers, verbatim)

## From run-config
- Test-case output format: CSV (config testcases.output_format and answers entry "output format").
- authorizations.mode: full-run (set explicitly by the user for their own trial tenant); deletes only for entities the run created.

## Answers from open-questions.csv (explorer questions, answered by the human)
- Q: [Scope] [Blocking] Explore-agent found Inbox, Sent, Opens and Clicks hold Freshsales-seeded sample emails (Scheduled, Drafts, Trash, Bulk, Bounces empty), contradicting discovery's 'no mailbox connected, lists empty' - should test cases target these seeded emails as read-only navigation data, with assertions limited to 'list renders and a thread opens' rather than exact counts?
  A: no (Inbox/Sent sample emails are not stable test data; do not assert counts of 3 inbox / 3+ sent)
- Q: [Behavior] [Nice-to-have] Why does SMS template creation fail with 'Template creation failed' for a valid name and body - is SMS setup required first?
  A: SMS template creation might fail because of no SMS provider being setup. We can skip this case, but flag it for later
- Q: [Behavior] [Nice-to-have] Is a duplicate email-template name meant to be auto-suffixed with a timestamp, and should the template list refresh without reload after create?
  A: yes
- Q: [Scope] [Nice-to-have] Is Conversation Groups part of this module or the Conversations module?
  A: Part of conversations module

## Answers from the clarification answer sheets (Pass 1 questions)
- Q: [Scope] [Blocking] The Email Templates list contains 9 system-seeded Public templates; under full-run may edit-save and delete tests touch only templates the run itself created (ZZ-prefixed), never the seeded ones?
  A: Yes
- Q: [Behavior] [Nice-to-have] Saving a new email template with a typed name showed no success toast yet the template persisted - is a success toast expected, or is the silent save acceptable for assertions (assert on list row instead)?
  A: Yes
- Q: [Edge Case] [Nice-to-have] What are the validation rules for email template Name and Body beyond the empty-save message (max name length, special characters/HTML, required Subject, leading/trailing spaces)?
  A: Yes
- Q: [Scope] [Nice-to-have] Confirm out of scope for live execution and test generation: sending/replying/forwarding emails, template Share, Connect Gmail/Outlook, Add Team Inbox, Set up SMS, Power Dialer and Chat Inbox (composer and reply are open-only, never sent).
  A: Yes
- Q: [Behavior] [Nice-to-have] Not exercised by explore: template Clone, Edit-save, list search box, Use template, Insert fields and Attach in the editor - should test cases cover them as expected-behavior cases (and what is expected, e.g. Clone creates a copy with a name suffix), or leave them out?
  A: Yes
