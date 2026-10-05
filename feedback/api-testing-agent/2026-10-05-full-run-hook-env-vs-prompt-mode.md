# Feedback: bash hook blocks k6 commands in a full-run track even though the invocation prompt set mode: full-run

- Date: 2026-10-05
- Agent: api-testing-agent (track: dashboards, freshsales)
- Type: gap / ambiguity

## Observation
The invocation prompt set `mode: full-run`, but `.claude/hooks/guard-bash.mjs` keys off the process env `AUTHORIZATIONS_MODE`, which was not set in the subagent's shell. The hook blocked bash commands whose text mentioned k6 (including a heredoc that merely contained the string, and a command batch with `k6 inspect`), with "live k6 load tests require authorizations.mode: full-run". The agent did not work around it (no inline env override), so no live k6 run was executed.

## Suggestion
- Orchestrator should launch full-run tracks with AUTHORIZATIONS_MODE=full-run in the environment, or the persona should say what to do when prompt mode and hook env disagree.
- The hook should distinguish `k6 inspect` and file-content mentions of k6 from an actual `k6 run`.

## Also
- The dashboards module has no documented public API (developers.freshworks.com/crm/api lists no dashboard endpoints); only internal /crm/sales endpoints exist.
- Per-page network-requests.json captures are numbered text, not JSON.
- GET /crm/sales/analytics_dashboard returns a JWT inside iframe_url; captures should redact it.
