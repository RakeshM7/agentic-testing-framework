# Verifying the cloud agent opt-in on a real repository

**Status:** to run before any client uses `"cloud_agent": true` (phase 3c, D-093). The opt-in is built from GitHub's documentation as of 2026-10-26. The questions below are the ones the docs don't settle, and only a live run of the Copilot cloud coding agent can answer them. Record each result here, with the date and the evidence (a session log, a screenshot or a PR link). Then mark the opt-in as verified in `packages/core/docs/platforms.md`, or change the design.

## Test repository
1. **Create the repository.** Make a private repo on an account or organization with the Copilot cloud coding agent enabled.
2. **Create the workspace.** Run `npx @testagentic/atf init .` with a packed or published build of the package. Set `"cloud_agent": true` in `atf/atf.json`, then run `npx atf sync`.
3. **Add the token.** Add `ATF_NPM_TOKEN` as an **Agents** secret: Settings → Secrets and variables → Agents.
4. **Merge to the default branch.** Commit and merge `.github/agents/`, `.github/hooks/framework-guard.json` and `.github/workflows/copilot-setup-steps.yml` there.
5. **Add a probe module.** Add a run-config for a harmless target. A static page you own is enough: the cloud agent does no live browser work (D-030).

## Checks

| # | Question | How to check | Expected | Result |
|---|---|---|---|---|
| 1 | Which branch the agent profile comes from | Add a throwaway agent on a feature branch only, then start a task with that branch as the base | Only default-branch agents are listed (docs: "merge it into the default branch") | |
| 2 | Whether a hook file on a non-default base branch runs | Change `framework-guard.json` on a feature branch only (e.g. point it at a script that logs and exits 2), then start a task from that branch | The default branch's hook runs (docs: "must be present on your repository's default branch") | |
| 3 | Whether a hook file written by setup steps runs | Remove `framework-guard.json` from the default branch in a scratch copy, and let setup steps write it | Not loaded; tool calls run unguarded. **This must never be the setup in a client repo.** | |
| 4 | Whether setup-step output is visible to the hook | With the normal setup, ask the agent to run `ls node_modules/@testagentic/atf/scripts/hooks` | The file exists; the guard's own denials appear (try a write the guard refuses, e.g. under `atf/`) | |
| 5 | Whether a failed install fails closed | Revoke or misspell `ATF_NPM_TOKEN`, then start a task | `npm ci` fails, the agent starts anyway, and every tool call is denied ("hook errored") | |
| 6 | Whether a hook timeout fails open | Point the hook at a script that sleeps past `timeoutSec` in a scratch copy | The call goes through (documented); keep the real guard well under the limit | |
| 7 | Whether the setup leaves a clean tree | After setup, ask the agent to run `git status --porcelain` | Clean: the restore step put the committed `.github/agents` and `.github/hooks` back after `npm ci`'s postinstall re-rendered them | |
| 8 | Whether the setup log shows stale files | Commit a stale `.github/agents/*.agent.md`, then start a task | The `git diff --stat` step lists it (the job continues), the restore step puts the committed file back, and the agent's PR doesn't touch it | |
| 9 | How the guard treats the built-in MCP tools | Ask the agent to use the default GitHub MCP and Playwright tools | Classified by the Copilot adapter (`scripts/hooks/hosts/copilot.mjs`); an unmapped tool is denied during a run (D-036). Note the tool names seen | |
| 10 | Whether our agent files are accepted | Select each framework agent in the dropdown | All load; check the `agents`/subagent fields, the tool aliases, and the 30,000-character prompt limit | |
| 11 | Whether ask counts as deny | Edit a file under a client decision's **Affects** | Refused (docs: ask counts as deny on the cloud agent); the agent reports it in its PR (D-091) | |

## After the run
- **Fix any mismatch.** If a result differs from the expected one, record it here and change the design (a new decision entry), or the docs.
- **Record the tool names.** Add the MCP tool names from check 9 to the Copilot adapter's tests.
