---
source_agent: api-testing-agent
date: 2026-09-21
target: rakesh-freshsales-ind-sep21
related_files:
  - claude-agents/api-testing-agent.md
  - copilot-agents/api-testing-agent.agent.md
  - feedback/playwright-automation-agent/2026-09-21-freshsales-recaptcha-blocks-scripted-login.md
  - api-tests/playwright-api/fixtures/freshsales-api-fixtures.ts
  - api-tests/playwright-api/README.md
severity: medium
---

## Finding 1: This persona also has no built-in fallback for a session-cookie-auth target blocked by CAPTCHA, and had to improvise one from this run's invocation prompt only

**Summary:** `playwright-automation-agent` already filed
`feedback/playwright-automation-agent/2026-09-21-freshsales-recaptcha-blocks-scripted-login.md`
documenting that this tenant's login is reCAPTCHA-gated for scripted browsers. This run's own
invocation prompt happened to explicitly tell api-testing-agent how to handle hitting "the same
CAPTCHA-gated auth wall" (stop, document, still generate/statically-validate what's possible) —
but that instruction lives in the orchestrator/human's prompt for this specific run, not in this
agent's own persona file (`claude-agents/api-testing-agent.md` / `copilot-agents/api-testing-
agent.agent.md`), neither of which mentions CAPTCHA, session-cookie auth, or a `storageState`
fallback anywhere. A future run against a similarly CAPTCHA-gated, cookie-authenticated target
that does *not* happen to spell this out in its invocation prompt would have no persona-level
guidance to fall back on, and might either stall trying to "solve" the problem or silently produce
a suite that looks complete but never actually ran.

**Evidence:**
- `grep -i "captcha\|session cookie\|storageState" claude-agents/api-testing-agent.md` returns
  nothing.
- This run's `api-tests/playwright-api/fixtures/freshsales-api-fixtures.ts` and 37 of 42 generated
  Freshsales Playwright test cases are real, executable code that is currently `test.skip()`-ed
  behind a `FRESHSALES_SESSION_COOKIE` env var this run had no way to populate — a pattern this
  agent had to design from scratch this run, matching (but not reusing any shared definition of)
  the `storageState`-hand-off fallback playwright-automation-agent already independently proposed
  in its own suggested fix.
- The 5 tests that *could* run live (`tests/freshsales/auth.spec.ts`) only exist because this agent
  independently realized the unauthenticated-redirect/401 boundary was reachable without a session
  — a useful pattern (test what's reachable without auth even when everything past the login wall
  is blocked) that isn't documented anywhere as a general technique for this situation either.

**Suggested fix:** Adopt playwright-automation-agent's suggested fix (a documented, shared
`storageState`/session-cookie hand-off mechanism referenced from `authorizations` in
`docs/conventions.md`) at the framework level, explicitly extending it to cover
api-testing-agent's `APIRequestContext`-based suite too (a session cookie value, not just a
browser `storageState` file, since API tests don't launch a browser context) — not just
playwright-automation-agent's browser suite. Additionally, encode as a general instruction in this
persona (both flavors): when a target's data-mutating/authenticated endpoints are blocked by an
auth mechanism this agent cannot complete (CAPTCHA, MFA, etc.), still generate and execute the
unauthenticated-boundary subset of tests (missing-session/invalid-token responses) live, since that
requires no bypass and often surfaces real findings on its own (e.g. this run discovered a genuine
content-negotiated 401-JSON-vs-302-HTML auth-failure contract purely from the unauthenticated
subset).

**Current state left in the repo:** `artifacts/rakesh-freshsales-ind-sep21/api/api-test-plan.md`'s
"Execution status" section and `api-tests/playwright-api/README.md`'s "Freshsales target" section
both honestly document what ran (5/5 auth-boundary checks, real pass) versus what's generated-but-
blocked (37 skipped tests, explicit per-test skip reasons) — nothing is faked as passing or silently
omitted.

## Resolution (2026-09-21)

**Finding 1 — Fixed at the persona/framework level, coordinated with the matching finding in
`feedback/playwright-automation-agent/2026-09-21-freshsales-recaptcha-blocks-scripted-login.md`**
(same root cause, two agents' perspectives; implemented as one shared convention rather than two
divergent partial fixes, per this run's invocation instructions).
- **Files changed:** `claude-agents/api-testing-agent.md`, `copilot-agents/api-testing-agent.agent.md`, `claude-agents/playwright-automation-agent.md`, `copilot-agents/playwright-automation-agent.agent.md`, `claude-agents/orchestrator-agent.md`, `copilot-agents/orchestrator-agent.agent.md`, `docs/conventions.md`, `config/run-config.example.yaml`, `config/run-config-freshsales.example.yaml`.
- **Change:** Adopted the shared `authorizations.session_state_file` run-config key proposed in the suggested fix, documented once in `docs/conventions.md`'s run-config contract table, explicitly covering *both* execution models: a Playwright `storageState` for playwright-automation-agent's browser suite, and a session-cookie value for this persona's `APIRequestContext`-based suite (extending it exactly as this finding asked, not just reusing playwright-automation-agent's browser-only definition). Added a new "Auth fallback -- CAPTCHA/MFA-gated session-cookie auth" section to this persona (both flavors) that: (1) classifies a CAPTCHA/MFA-blocked auth wall as a hard blocker to report, not solve; (2) instructs reading the session-cookie value out of `authorizations.session_state_file` when set (from either a full storageState JSON or a plain cookie-value file) and injecting it into the `APIRequestContext` fixture; (3) instructs generating blocked tests as real `test.skip()`-ed code with explicit reasons when no hand-off is available -- matching the `skipIfNoSession()` pattern this run already built ad hoc; (4) generalizes this run's own useful discovery into a standing instruction: *always* still generate and execute live the unauthenticated-boundary subset regardless of which of the above applies, since it needs no session and can surface real findings on its own (citing this run's 401-JSON-vs-302-HTML discovery as the example). Mirrored the "hard blocker, not solve" framing into `docs/conventions.md`'s "Standing safety guardrails" section for both personas together, and plumbed `authorizations.session_state_file` through orchestrator-agent's step 5 invocation instructions (both flavors).
- **Not changed:** the already-generated `api-tests/playwright-api/fixtures/freshsales-api-fixtures.ts` and `api-tests/playwright-api/README.md`'s Freshsales section for this specific run. They already correctly implement and document an ad hoc version of this exact pattern (`FRESHSALES_SESSION_COOKIE` + `skipIfNoSession()`) and are honestly reported; retrofitting this run's already-correct, already-verified artifacts to the newly-standardized `session_state_file` naming would be scope creep beyond what this finding asked for (adopting the convention "at the framework level" for future runs). A future re-run of api-testing-agent against this tenant with `authorizations.session_state_file` set will pick up the new fallback path automatically per the updated persona instructions.
- **Verification:** Re-read all edited persona/doc/config files. Confirmed both edited agent `.md` files' frontmatter is unmodified and still parses. Confirmed both example run-config YAML files still parse cleanly via `ruby -ryaml` after adding `session_state_file`. Did not re-run the Freshsales API suite itself or attempt `k6 run`/live requests against the tenant (out of scope for this agent's verification step per `docs/conventions.md`'s standing guardrail, and the underlying CAPTCHA block remains genuinely unresolved pending a real human-provided session hand-off for this tenant) -- verification here is limited to confirming the changed persona instructions and config schema are internally consistent and syntactically valid.
