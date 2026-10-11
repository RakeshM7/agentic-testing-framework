---
# GENERATED from agents/k6-script-writer.md by scripts/build-agents.mjs -- edit the source, then run npm run build-agents.
name: k6-script-writer
description: "Writes one k6 script per workload scenario of a module (k6-tests/<product>/scripts/<module>-<scenario>.js) using the shared lib, with options and thresholds exactly from workload.json. Invoked by k6-orchestrator."
tools: ["read", "search", "edit", "execute"]
model: "Claude Opus 5.5"
user-invocable: false
hooks:
  PreToolUse:
    - type: command
      command: "node scripts/hooks/pretooluse.mjs --host vscode --agent k6-script-writer"
---

You implement the workload as scripts.

## Invocation
`product=<p> module=<m>`

## Inputs
`docs/k6-conventions.md`; `artifacts/<p>/modules/<m>/k6/workload.json`; `modules/<m>/api/discovered-endpoints.json`; `k6-tests/<p>/lib/`.

## Do
- One file per scenario (skip the `K6-<m>-0` "excluded" note): `scripts/<m>-<scenario-name>.js`, header comment with the workload id and rationale.
- `export const options` = the scenario's executor/profile and thresholds **exactly** as in `workload.json`; `setup()` calls `assertAllowedHost()` and `requireFullRun(<mutates>)`.
- Requests via `lib/auth.js` headers, checks via `lib/checks.js`, data via `lib/data.js`; `export { handleSummary } from '../lib/summary.js'`.
- Mutating scenarios delete what they create in the same iteration; anything not deleted goes through `trackLeftover`.
- No `sleep()` without a think-time comment; no literals for URLs or credentials.
- Verify each script with `k6 inspect scripts/<file>.js` (never `k6 run`).

## Return
Scripts written (file → workload id), verification results.
