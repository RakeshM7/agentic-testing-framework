---
source_agent: explore-agent
date: 2026-09-21
target: rakesh-freshsales-ind-sep21
related_files:
  - claude-agents/explore-agent.md
  - docs/conventions.md
severity: blocking
---

## Finding 1: "Authenticated crawl mode" is unreachable under the operator's own hard safety rules

**Summary:** The explore-agent persona (`claude-agents/explore-agent.md`, "Authenticated crawl
mode (opt-in only)") instructs the agent to "log in once using those credentials" whenever an
`authCredentialsFile` is supplied and the run-config authorizes it. However, every invocation of
this agent operates under a senior, non-overridable operator safety policy that categorically
prohibits "Entering financial credentials, ... passwords, API keys, or tokens into any field"
and "Creating accounts, or entering passwords to authenticate", explicitly stating these stay
prohibited even when "the user explicitly asks for them, supplies all the details, or says they
authorize it." Many real login forms (including the Freshsales one hit this run) also render a
live reCAPTCHA, which falls under the same policy's "Bypassing or completing CAPTCHAs" prohibition.

The practical effect: as currently written, "Authenticated crawl mode" can never actually be
exercised by this agent for any target that gates content behind a standard password (or
CAPTCHA-protected) login form — which is presumably the common case, not the exception. The
persona instructions promise a capability the agent is not permitted to perform, and a run-config
author could reasonably believe (incorrectly) that setting `authenticated_crawl: true` plus
providing a credentials file is sufficient authorization, when it categorically is not.

**Evidence:** This run (`rakesh-freshsales-ind-sep21`, mode `full-run`,
`authenticated_crawl: true`, `authCredentialsFile: playwright-tests/.env.freshsales`) reached
`https://rakesh-freshsales-ind-sep21.myfreshworks.com/login`, a standard Email/Password form with
a live Google reCAPTCHA widget, and had to stop there — see
`artifacts/rakesh-freshsales-ind-sep21/explore/crawl-log.md` for the full reasoning. The crawl
could not proceed into the target's Leads/Contacts/Accounts/Deals/Pipeline/Tasks modules at all,
even though credentials were legitimately available.

**Suggested fix:** Either (a) explicitly document in `claude-agents/explore-agent.md` (and the
`docs/conventions.md` shared contract) that "authenticated crawl mode" requires a pre-authenticated
browser session/storage-state to be handed to the agent by a human or an out-of-band step — the
agent itself must never type a password or solve a CAPTCHA, regardless of run-config settings —
or (b) if the framework intends for this agent to actually perform interactive login, that
requires a deliberate, documented carve-out at the operator-policy level (e.g. a distinct
credential-injection tool that never surfaces the raw password to the model, similar to the
"password manager" carve-out pattern), not just a per-repo run-config flag. As written, the two
layers of instructions directly contradict each other and every future authenticated-crawl
request will hit this same wall.

## Resolution (2026-09-21)

**Finding 1 — Fixed, via option (a).**
- **Files changed:** `claude-agents/explore-agent.md`, `copilot-agents/explore-agent.agent.md`, `docs/conventions.md`.
- **Change:** Removed the old `authCredentialsFile` "log in once using those credentials" instruction entirely and replaced it with a `sessionStateFile` input: a pre-authenticated Playwright storageState JSON that a human produces by completing the target's login -- and any CAPTCHA/MFA challenge -- once, interactively, out-of-band. Added an explicit, non-mode-gated hard rule directly in "Authenticated crawl mode": *"you must never type a password into a login form or attempt to solve/bypass a CAPTCHA yourself, under any run-config setting... it is not something `mode` or `authenticated_crawl` can override."* If `sessionStateFile` isn't provided (or the installed Playwright MCP server has no supported way to load it), the agent now explicitly falls back to the existing login-wall behavior (stop and log) rather than attempting to authenticate itself. Documented the new `authorizations.session_state_file` config key and the corresponding change to `credentials_file`'s scope (now explicitly *not* read by explore-agent, only by playwright-automation-agent/api-testing-agent's own scripted-login execution mode, which is a different, non-interactive code-execution path this finding doesn't concern) in `docs/conventions.md`'s run-config contract table and a new "Standing safety guardrails" bullet. Updated `orchestrator-agent.md`/`.agent.md` (step 1) to stop passing `credentials_file` to explore-agent and pass `sessionStateFile` instead, and updated both example run-configs (`config/run-config.example.yaml`, `config/run-config-freshsales.example.yaml`) with the new field.
- **Not implemented:** option (b) (an operator-policy-level credential-injection carve-out) -- that would require a change outside this repo's control (Anthropic's own tool/policy surface), not something a feedback-implementor-agent operating inside this codebase can build. Option (a) fully resolves the contradiction without needing it.
- **Verification:** Re-read all edited files. Confirmed the `claude-agents/explore-agent.md` and `copilot-agents/explore-agent.agent.md` frontmatter blocks are unmodified and still parse (pre-existing Ruby-YAML strictness issue on the `description:` field's inline colons is unrelated to this change -- verified identical parse behavior on the pre-edit `git show HEAD` version of the same file, confirming it predates this fix). Confirmed both example run-config YAML files still parse cleanly via `ruby -ryaml` after adding the new `session_state_file` key, with the expected `nil`/path value round-tripping correctly.
