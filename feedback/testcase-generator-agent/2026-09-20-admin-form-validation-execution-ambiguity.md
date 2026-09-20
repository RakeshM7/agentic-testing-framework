---
source_agent: testcase-generator-agent
date: 2026-09-20
target: eventhub
related_files:
  - artifacts/eventhub/clarifications/app-wide-clarifications.md
  - artifacts/eventhub/testcases/app-wide-testcases.md
  - .claude/agents/requirements-clarification-agent.md
severity: low
---

## Finding 1: app-wide clarifications doc leaves admin "+ New Event" form validation execution status genuinely ambiguous, not just unconfirmed

**Summary:** The `app-wide-clarifications.md` doc's "Open questions" section states that admin
"+ New Event" field-level validation testing "does not require creating a 7th event or exceeding
the 6-event limit... but per this suite's non-mutation stance, no such live event creation is
authorized in this run either." This reads as internally in tension: it first argues the narrower
validation-only testing is *safe* (distinct from the 6-event/FIFO limit concern), then blocks it
anyway under a blanket non-mutation stance, without clearly stating whether *negative* validation
submissions (e.g. submitting Price = "-10", expected to be rejected client-side with no event ever
created) are also forbidden, or only *positive*/successful submissions that would actually create a
real event. This is a different situation from the registration form, where the doc is unambiguous
that negative/validation-only submissions (bad password, mismatched confirm-password, empty
required fields) are safe to execute live because validation is expected to block them before any
account is created — no such explicit "these negative sub-cases are safe" carve-out is stated for
the admin form.

**Evidence:** `artifacts/eventhub/clarifications/app-wide-clarifications.md`, "Open questions"
section, the "Admin '+ New Event' form field validation" bullet (lines ~234-241 at time of writing).
Contrast with the registration-form treatment in the same doc's edge-case table, where password-
policy and confirm-password-mismatch rows are flagged as assumptions needing live verification but
are never called out as non-mutation-forbidden the way the admin form and the 6-event/FIFO flow are.

**Suggested fix:** In a future clarification pass for this feature (or as a documented convention
for `requirements-clarification-agent` generally), explicitly separate "any form submission that
could succeed and mutate real data" from "form submissions expected to be blocked by validation
before mutation occurs" when deciding non-mutation scope, and state the ruling for each separately.
As a downstream mitigation, I resolved this conservatively in `app-wide-testcases.md`: I flagged
*all* Admin "+ New Event" form test cases (TC-app-wide-031 through 035), including the purely
negative/validation-only ones, as "DO NOT EXECUTE LIVE — documented-but-not-executed only," on the
grounds that the clarifications doc's own text ("no such live event creation is authorized in this
run either") reads as a blanket prohibition on submitting that specific form at all, not just on
successful submissions. A future run could reasonably make the opposite call (execute the negative
sub-cases, since they're not expected to mutate anything) — worth a human/product-owner decision to
avoid inconsistent automation behavior across runs.

## Resolution (2026-09-20)

**Finding 1: Fixed (process guidance), Deferred (the run's own artifact ruling).** Added an explicit rule to `.claude/agents/requirements-clarification-agent.md`'s Pass 2 write-up instructions: when a ruling touches whether a form/flow may run live under a non-mutation policy, it must state the ruling separately for (a) submissions that could succeed and mutate data and (b) submissions expected to be blocked by validation before any mutation occurs, so a blanket "no live execution" answer for case (a) can no longer silently swallow case (b) too. This directly targets the root cause the finding describes. The actual product-owner call on whether TC-app-wide-031–035's negative sub-cases *should* have been executed live in this specific run is out of scope for this agent (a human/product decision, as the finding itself says) and is left Deferred — `app-wide-testcases.md`'s conservative "DO NOT EXECUTE LIVE" flagging is left as-is rather than second-guessed.

Files changed: `.claude/agents/requirements-clarification-agent.md`.

Verification: re-read the file's frontmatter after edit (Node script confirming `name`/`description` still parse); the new rule is prose guidance for a future clarification pass, so there's no automated check to run against it -- verification is limited to confirming the instruction is unambiguous and placed where Pass 2 authors will see it (directly above/around the "Open questions" section it governs).
