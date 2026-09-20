---
source_agent: orchestrator-agent
date: 2026-09-20
target: eventhub
related_files:
  - config/eventhub-app-wide.yaml
  - docs/conventions.md
severity: medium
---

## Finding 1: Literal substring matching silently fails on punctuation-only variants, forcing avoidable halts on [Blocking] questions

**Summary:** `docs/conventions.md`'s "Orchestrator & run-config contract" defines config-answer resolution as a strict case-insensitive *substring* match between an `answers[].match` string and the Pass-1 question text, first match wins. During the `eventhub` app-wide run, `requirements-clarification-agent` Pass 1 returned questions whose wording differed from the config's `match` strings only by punctuation (hyphen vs. space), which is enough to make the literal substring check fail even though a human reading both texts would clearly consider them the same topic.

**Evidence:**
- Config `answers` entry `match: "duplicate email"` (space) did not match Pass-1 Question 3's phrase `"duplicate-email registration"` (hyphen) — no match found, question stayed unresolved.
- Config `answers` entry `match: "6-event"` (hyphen) did not match Pass-1 Question 10's phrase `"6 events max"` (space) — no match found, question stayed unresolved.
- Both questions were tagged `[Blocking]`, so per the halting rule (defaults only apply to `[Nice-to-have]`), these two plus a third unrelated unmatched blocking question (the Los Angeles / city-dropdown data anomaly, Question 8) forced a full run halt before `requirements-clarification-agent` Pass 2` could even be invoked — despite the config author clearly having anticipated and pre-answered both topics.
- Conversely, the same literal-substring design produced an unintended *false positive* elsewhere in the same run: config answer `match: "search"` matched Pass-1 Question 7 (Category/City filter AND vs. OR combination logic) purely because that question's text happened to contain the unrelated phrase "combined with **search** text" — an accidental match that would have silently applied the wrong canned answer had this question been Nice-to-have-only and reached Pass 2 unexamined.

**Suggested fix:** Either (a) update `docs/conventions.md` to explicitly recommend config authors use multiple short, punctuation-light `match` keywords per topic (e.g. both `"duplicate email"` and `"duplicate-email"`) to hedge against generation-time wording variance, or (b) relax the matching algorithm itself to normalize hyphens/underscores to spaces (and collapse whitespace) before the substring check, which would fix both the false-negative and reduce (though not eliminate) false-positive risk. If (b) is adopted, `orchestrator-agent`'s own instructions and `docs/conventions.md` §"Run-config file" / §"Halting and resuming" should be updated to state the normalization rule precisely, since the current wording ("case-insensitive substring match") is exact-character and was followed literally here, which is what surfaced this gap.

## Resolution (2026-09-20)

**Finding 1: Fixed.** Adopted both (a) and (b). `docs/conventions.md`'s "Run-config file" table (`answers` row) and "Halting and resuming" section now state the normalization rule precisely: both `match` and the question text are normalized (hyphens/underscores → space, whitespace collapsed) before the case-insensitive substring check, and config authors are advised to prefer specific multi-word `match` strings and to list both hyphen/space variants as separate entries where a topic could plausibly be phrased either way (guarding against the false-positive risk normalization doesn't eliminate). `.claude/agents/orchestrator-agent.md` step 2 was updated with the same normalization wording plus a note to treat a matched-but-topically-odd question as suspicious rather than blindly applying the canned answer. `config/eventhub-app-wide.yaml` already contained both hedged forms (`duplicate email`/`duplicate-email`, `6-event`/`6 events`) from the run itself, so no further change was needed there.

Files changed: `docs/conventions.md`, `.claude/agents/orchestrator-agent.md`.

Verification: re-read both files' frontmatter/structure after edit (orchestrator-agent.md frontmatter re-validated via a Node script confirming `name`/`description` still parse); no automated test exists for the orchestrator's config-matching logic (it's LLM-interpreted prose, not code), so verification is limited to confirming the wording is now precise and internally consistent across both files.
