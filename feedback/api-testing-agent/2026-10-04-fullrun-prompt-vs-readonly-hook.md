# Feedback: full-run requested in prompt but shell hook/env is readonly

- Date: 2026-10-04
- Agent: api-testing-agent
- Target: rakesh-freshsales-ind-sep21

## Observation
The invocation said `mode: full-run`, but `AUTHORIZATIONS_MODE` was unset in the process env. `.claude/hooks/guard-bash.mjs` blocked a mutating curl (and blocks live load runs), and `fixtures/mutationGuard.ts` blocks Playwright non-GET calls. The agent treated the hook as authoritative and did not self-set the env var, so no mutations or live load runs happened despite the prompt.

## Suggested improvement
- Orchestrator should export `AUTHORIZATIONS_MODE` from run-config `authorizations.mode` when launching sub-agents (or fail fast if they disagree); the persona should say what to do on a mismatch (report; do not self-grant).
- The hook regex matches command text, so a heredoc merely mentioning the live-run subcommand is blocked; use file-writing tools for docs.
- A valid `session_state_file` (storageState) should be consumed by the fixture directly; the repo fixture only read `FRESHSALES_SESSION_COOKIE`, so the supplied handoff file was unused until patched this run.
- Prior-run specs mutated pre-existing entities (PUT on known deal/contact ids), contradicting the created-entities-only rule; persona should require a check for this.
- Product finding: Freshsales list endpoints return 403 (not 400) when `segment_id` is missing/invalid.
