---
source_agent: api-testing-agent
date: 2026-09-20
target: eventhub
related_files:
  - .claude/agents/api-testing-agent.md
  - api-tests/playwright-api/tests/login.spec.ts
  - api-tests/playwright-api/fixtures/api-fixtures.ts
severity: low
---

## Finding 1: agent instructions don't explicitly distinguish "non-mutating POST" (e.g. login) from "state-mutating POST" (e.g. booking/payment)

**Summary:** My own governing instructions state the guardrail as "default to read-only (GET)
requests... do not generate tests that perform state-mutating calls (POST booking/payment/etc.)".
This correctly implies some POSTs are exempt but never says so explicitly, so the exemption has to
be inferred by analogy to the example ("POST booking/payment/etc.") each time an agent run
encounters a new non-mutating POST endpoint (in this case `POST /auth/login`). The prior
event-booking run independently arrived at treating `POST /auth/login` as a sanctioned exception
(documented at length in `fixtures/api-fixtures.ts`'s header comment), and this app-wide run had to
re-derive the same reasoning from scratch to decide it was safe to additionally exercise
`/auth/login`'s *negative* paths (wrong password, unregistered email, missing fields) live, since
none of those calls create/mutate data either. Both conclusions turned out consistent, but nothing
in the instructions confirms that reasoning is correct, or sets a bound on how many "exception"
calls per run is reasonable (I judged 9 login calls across a test run acceptable; a different agent
run might judge that too many, or not enough).

**Evidence:** `.claude/agents/api-testing-agent.md`'s guardrail wording: "Guardrail: default to
**read-only (GET) requests** against any live third-party target; do not generate tests that
perform state-mutating calls (POST booking/payment/etc.) against a live target unless the
invocation prompt explicitly authorizes it." No mention of authentication endpoints (login) as a
distinct category from mutating endpoints, despite two independent runs now needing to make that
exact call.

**Suggested fix:** Add one sentence to the guardrail section explicitly naming authentication
endpoints (login) as a *non-mutating* POST that is not covered by the "state-mutating" restriction,
e.g.: "Note: authentication endpoints (e.g. `POST /auth/login`) that only verify existing
credentials and don't create/modify/delete business data are not considered 'state-mutating' for
this guardrail's purposes, and may be called as needed for functional/negative auth testing --
unlike registration, which creates a new account and should be treated as mutating even when the
payload is deliberately invalid." This would remove the need for each new run against the same
target (or a different target with a similar auth pattern) to re-derive this distinction from
first principles.

## Resolution (2026-09-20)

**Finding 1: Fixed.** Added the suggested sentence (near-verbatim) to `.claude/agents/api-testing-agent.md`'s guardrail in step 4: authentication endpoints (e.g. `POST /auth/login`) that only verify existing credentials without creating/modifying/deleting business data are now explicitly named as not "state-mutating" for guardrail purposes and may be called for functional/negative auth testing, while registration is explicitly called out as still mutating even with deliberately invalid payloads (since it creates an account). This removes the need for a future run to re-derive the distinction from first principles, per the finding's own framing. No bound was added on "how many exception calls per run is reasonable" since the finding flags that as an open question rather than a concrete suggested fix -- left to the implementing agent's judgment as before.

Files changed: `.claude/agents/api-testing-agent.md`.

Verification: re-read the file's frontmatter after edit (Node script confirming `name`/`description` still parse); no test suite covers agent-persona prose, so verification is limited to confirming the added sentence is placed directly in the guardrail paragraph it clarifies and doesn't alter any other guardrail wording.
