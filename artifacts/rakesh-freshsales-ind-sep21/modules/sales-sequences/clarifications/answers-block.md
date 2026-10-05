# Answers block for module sales-sequences (human answers, verbatim)

## From run-config
- Test-case output format: CSV (config testcases.output_format and answers entry "output format").
- authorizations.mode: full-run (set explicitly by the user for their own trial tenant); deletes only for entities the run created.

## Answers from open-questions.csv (explorer questions, answered by the human)
- Q: [Behavior][Blocking] Which of the exit and entry rules (e.g. enrollment limit, duplicate exclusion, Classic vs Smart schedule semantics) must tests verify, and can enrollment be tested without real contacts?
  A: Enrolment cannot be tested without real contacts, Entry and exit rules are defined by the filter option that are present in the page
- Q: [Behavior][Nice-to-have] Can the leftover sequence 'Explore Test Sequence' (id 402000016478) be deleted manually or via an approved delete?
  A: Delete via an approved delete

## Answers from the clarification answer sheets (Pass 1 questions)
- Q: [Scope][Blocking] Explore-agent reached Sales Sequences via the Conversations tab > Sales Sequences (/crm/sales/sales-sequences/filters) rather than the Quick-create (+) path listed in discovery; should test cases use the Conversations > Sales Sequences path as the canonical entry point?
  A: Yes
- Q: [Edge Case][Nice-to-have] What validation applies to the sequence name (empty, duplicate name, maximum length) on Save: is a duplicate name blocked, auto-suffixed, or allowed?
  A: Yes
- Q: [Behavior][Nice-to-have] Under full-run, may tests use 'Save and start' or the status toggle to activate a task-only sequence that has no enrolled contacts, or must every created sequence remain Inactive?
  A: Yes
- Q: [Behavior][Nice-to-have] When a cloned sequence is saved, is the expected result an Inactive sequence named '<original> - Copy' with the same steps, and may clone-save be executed live on a sequence the run created itself (with the copy deleted afterwards)?
  A: Yes
- Q: [Behavior][Nice-to-have] Should Share be tested by saving each option (Just me, Everyone, Selected users/teams/territories) on a run-created sequence, and what is the expected visibility result for another user; is a second user available?
  A: Yes
- Q: [Behavior][Nice-to-have] Is Edit (rename, change steps, change exit rules) and Delete in scope for run-created sequences, and what confirmation and post-delete behavior (removed from list, Trash/recoverable or permanent) is expected?
  A: Yes
- Q: [Scope][Nice-to-have] Are the other step types (email, email reminder, LinkedIn task, call reminder, SMS), Accounts-type sequences, and Classic/Smart configuration in scope for test cases, given SMS/email may depend on unconfigured providers or mailboxes?
  A: Yes
