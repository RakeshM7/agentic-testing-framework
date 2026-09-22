---
source_agent: orchestrator-agent
date: 2026-09-21
target: rakesh-freshsales-ind-sep21
related_files:
  - claude-agents/orchestrator-agent.md
  - docs/conventions.md
severity: medium
---

## Finding 1: Orchestrator's own halt-report paraphrasing of non-blocking Pass-1 questions produces `answers[].match` strings that fail the literal substring check

**Summary:** When halting on unresolved `[Blocking]` questions, this agent's halt report also summarized the *other* (non-blocking) Pass-1 questions for the human's awareness, using short paraphrased labels (e.g. "Q5 (activity type coverage: Task/Call/Note)", "Q7 (Account-creation path coverage)") instead of quoting the questions verbatim. The human/coordinator reasonably used those paraphrased labels as `answers[].match` strings when adding pre-answers to the run-config. Per `docs/conventions.md`'s literal (hyphen/underscore-normalized) substring-match rule, neither string was actually a substring of the real Pass-1 question text, so the algorithmic match failed for both.

**Evidence:**
- Actual Pass-1 Question 5 text: "Activity logging against the deal: ... Should test cases cover all three activity types (Task, Call log, Note) as separate cases, or is one representative type (Task) sufficient for this feature's scope?" — contains "activity types" (plural, no "coverage"), not the config's `match: "activity type coverage"`.
- Actual Pass-1 Question 7 text: "Account creation path: ... Should test cases cover both paths (inline auto-create from Contact form, AND standalone Account creation ...)" — contains "Account creation path" followed by a colon, and never the word "coverage" at all; the config's `match: "Account-creation path coverage"` never appears as a substring.
- Both mismatches trace directly back to this orchestrator's own prior halt-report phrasing, not to any generation-time wording variance from `requirements-clarification-agent` (unlike the 2026-09-20 finding in this same feedback directory, which was about hyphen/space punctuation variance in the agent's own question wording).
- Because neither question was `[Blocking]`, this didn't force a halt, but it did mean the human's clearly-intended answers would have been silently discarded by the literal-match algorithm had the orchestrator not recognized the correspondence manually and applied the answers anyway (documented as a manual correspondence, not a literal match, in the run's clarification hand-off).

**Suggested fix:** When an orchestrator halt report lists non-blocking Pass-1 questions for context (not just the blocking ones that force the halt), it should quote them verbatim (or verbatim-truncated with the exact matchable phrase highlighted) rather than paraphrasing/labeling them — the same way it's already required to quote `[Blocking]` questions verbatim. This removes the main source of human-authored `match` strings that can never algorithmically match. Consider adding this as an explicit instruction in `claude-agents/orchestrator-agent.md`'s halt-reporting step: "any Pass-1 question text quoted or referenced in a halt report to a human, blocking or not, must be quoted verbatim so a human's resulting `answers` entry can actually match it."

## Resolution (2026-09-21)

**Finding 1 — Fixed.**
- **Files changed:** `claude-agents/orchestrator-agent.md`, `copilot-agents/orchestrator-agent.agent.md` (both flavors kept in sync, per this repo's parallel-rendering convention, even though only the Claude file was listed in `related_files`), `docs/conventions.md`.
- **Change:** Added an explicit instruction to the "Halting on an unanswered blocking question" step in both orchestrator personas: *"Any Pass-1 question you quote or reference in this halt report, blocking or not (including any non-blocking questions you list for the human's awareness), must be quoted verbatim -- never paraphrased into a short label."* Mirrored the same rule into `docs/conventions.md`'s "Halting and resuming" section (the shared contract both flavors point to), directly next to the existing verbatim-quoting requirement for the blocking question(s) themselves, with the "activity type coverage" paraphrase example carried over as the illustrative case.
- **Verification:** Re-read all three edited files after the change. Confirmed each agent `.md` file's YAML frontmatter is unmodified (only body text was touched) and still parses -- `orchestrator-agent.md`/`orchestrator-agent.agent.md`'s frontmatter loads cleanly via `ruby -ryaml`; the two changed sections read coherently in context with the surrounding step-2 and run-config-contract text. No automated test exists for prose instructions, so verification is limited to re-reading for correctness and consistency, as anticipated by this agent's own contract.
