---
source_agent: playwright-automation-agent
date: 2026-09-21
target: rakesh-freshsales-ind-sep21
related_files:
  - claude-agents/playwright-automation-agent.md
  - copilot-agents/playwright-automation-agent.agent.md
  - playwright-tests/tests/setup/auth.freshsales.setup.ts
  - playwright-tests/pages/freshsales/LoginPage.ts
  - playwright-tests/README.md
severity: high
---

## Finding 1: This persona has no defined fallback when scripted login is blocked by reCAPTCHA

**Summary:** The playwright-automation-agent persona (both flavors) assumes it can always
authenticate a target via scripted UI login when `authorizations.credentials_file` is provided.
For `rakesh-freshsales-ind-sep21` (a real Freshworks/Freshsales tenant), every scripted login
attempt this run — headless bundled Chromium, headed bundled Chromium, a headed real Chrome
channel, and both instant and human-paced (typed character-by-character with mouse movement)
input — reliably triggered a Google reCAPTCHA image challenge instead of completing the login.
This is not a credentials problem or an app bug; it's Google's own automation-detection gate on
the login form, and this agent correctly does not attempt to solve or bypass it (out of scope,
and would defeat an anti-bot control rather than test the application). The practical effect: 14
of the 14 live-mutating/validation test cases in
`artifacts/rakesh-freshsales-ind-sep21/testcases/lead-to-deal-pipeline-testcases.csv` could not be
executed this run despite `authorizations.mode: full-run` explicitly authorizing them, because
none of them can be reached without an authenticated session.

**Evidence:**
- `playwright-tests/tests/setup/auth.freshsales.setup.ts` fails with `Test timeout of 30000ms
  exceeded` every run; a screenshot captured mid-run shows a Google reCAPTCHA "Select all images
  with a fire hydrant" / "bicycles" challenge overlaying the login form.
- Reproduced 3 times across different Chromium launch configurations before concluding this was
  not a transient/one-off flake (see the dev-session transcript for exact configs tried).
- explore-agent (a *different* agent, using an interactive Playwright MCP session in VS Code, per
  `AGENTS.md`'s note that "live browser crawling needs an interactive Playwright MCP session")
  apparently did not hit this same gate during its own crawl of this tenant — its
  `artifacts/rakesh-freshsales-ind-sep21/explore/created-entities.json` shows real Contact/Account/
  Deal/Task entities it created live. The likely reason: an interactive session (a human present,
  real display, possibly an already-warm browser profile/session) presents very different
  automation-detection signals than a fully scripted, non-interactive Node script launching a
  fresh browser context — which is the only mode available to playwright-automation-agent's own
  execution environment (no MCP browser tool, only a Bash tool).

**Suggested fix:** Give this persona an explicit, documented fallback path for CAPTCHA-gated
targets, e.g.:
1. Allow `authorizations` to optionally point at a **pre-authenticated storageState file** (analogous
   to `credentials_file`, but a session snapshot instead of a username/password) that a human or
   explore-agent's interactive session produced, so playwright-automation-agent can skip scripted
   login entirely for targets that gate it behind a CAPTCHA.
2. Document, in this persona's own instructions, that a reproducible CAPTCHA/bot-challenge on the
   login form is an in-scope "hard blocker to report, not to solve" — analogous to the existing
   "irreversible real-world side effect with no test/sandbox path" rule — so future runs recognize
   this pattern immediately instead of re-diagnosing it from scratch each time.
3. Consider having orchestrator-agent surface this as a distinct halt/report category (alongside
   `[Blocking]` clarification questions) when it occurs mid-pipeline, since it silently caps how
   much of a `full-run`-authorized target can actually be exercised regardless of test-case quality.

**Current state left in the repo:** the full suite (POM classes, fixtures, all 14 test cases as
real, executing specs, plus a passing visual-regression baseline for the login page, which is the
one page reachable without a session) is written and typechecks/lists correctly, and was run for
real this session — the setup step's failure is honestly reported as a failure, and the 14
dependent tests are reported as skipped-due-to-failed-dependency, not silently absent or faked as
passing. See `playwright-tests/README.md`'s "Known blocker" section for the full detail and
remediation options.

## Resolution (2026-09-21)

**Finding 1 — Fixed at the persona/framework level, coordinated with the matching finding in
`feedback/api-testing-agent/2026-09-21-freshsales-recaptcha-blocks-api-level-auth-too.md`** (same
root cause, two agents' perspectives; implemented as one shared convention rather than two
divergent partial fixes, per this run's invocation instructions).
- **Files changed:** `claude-agents/playwright-automation-agent.md`, `copilot-agents/playwright-automation-agent.agent.md`, `claude-agents/api-testing-agent.md`, `copilot-agents/api-testing-agent.agent.md`, `claude-agents/orchestrator-agent.md`, `copilot-agents/orchestrator-agent.agent.md`, `docs/conventions.md`, `config/run-config.example.yaml`, `config/run-config-freshsales.example.yaml`.
- **Change:** Introduced a new, documented `authorizations.session_state_file` run-config key (`docs/conventions.md`'s run-config contract table): an optional path to a pre-authenticated Playwright storageState JSON (or a plain session-cookie value file) that a human produces by completing a target's login -- and any CAPTCHA/MFA challenge -- once, interactively, out-of-band. Added a new "Auth fallback -- CAPTCHA/MFA-gated scripted login" section to this persona (both flavors) that: (1) formally classifies a reproducible CAPTCHA/MFA challenge on scripted login as a hard blocker to report, not solve, in the same category as this persona's existing "irreversible real-world side effect" rule; (2) instructs using `authorizations.session_state_file` directly as the project's `storageState` when set, skipping the blocked scripted-login step entirely; (3) instructs, when no hand-off is available, to leave the login/setup spec real-and-failing-for-a-documented-reason (matching exactly what this run already did) and still run live whatever is reachable without a session; (4) instructs filing feedback on first encounter so a recurrence is recognized immediately. Mirrored the same "hard blocker, not a puzzle" framing into `docs/conventions.md`'s "Standing safety guardrails" section, applying to both this persona and api-testing-agent. Plumbed `authorizations.session_state_file` through orchestrator-agent's step 4/5 invocation instructions (both flavors) and documented the new key in both example run-configs.
- **Not changed:** the already-generated `playwright-tests/tests/setup/auth.freshsales.setup.ts`, `playwright-tests/pages/freshsales/LoginPage.ts`, and `playwright-tests/README.md` for this specific run. They already correctly implement and document an ad hoc version of exactly this fallback pattern (per this finding's own "Current state left in the repo" note) and are honestly reported; retrofitting them to the newly-standardized `session_state_file` naming would be scope creep beyond this finding's ask (which was to adopt the convention "at the framework level" for *future* runs, not to rewrite this run's already-correct, already-verified artifacts). A future re-run of playwright-automation-agent against this same tenant with `authorizations.session_state_file` set will pick up the new fallback path automatically per the updated persona instructions.
- **Verification:** Re-read all edited persona/doc/config files. Confirmed both edited agent `.md` files' frontmatter is unmodified and still parses. Confirmed both example run-config YAML files still parse cleanly via `ruby -ryaml` after adding `session_state_file`, with the key appearing correctly nested under `authorizations`. Did not re-run the Freshsales Playwright suite itself (per this agent's own contract, verification is re-reading/typechecking/statically validating what was actually changed here -- the persona instructions and config schema -- not re-executing a live target's suite, which remains genuinely blocked pending a real human-provided `session_state_file` for this tenant).
