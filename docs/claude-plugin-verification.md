# Verifying the Claude Code plugin in a real session

**Status:** to run before any client uses `"claude_plugin": true` (phase 6, D-098). The plugin follows Claude Code's documentation as of 2026-10-27. The questions below are the ones the docs leave open, and only a live session can settle them. Record each result here with the date, the Claude Code version (`claude --version`; at least 2.1.310, where PreToolUse hooks stopped failing open when a shell is missing) and the evidence: hook-error logs, `claude --debug` output, or a screenshot. Then mark the plugin verified in `packages/core/docs/platforms.md`, or change the design.

## Test workspace
1. **Create the workspace.** Run `npx @testagentic/atf init` with a packed or published build. In `atf/atf.json`, set `"claude_plugin": true` and `"plugin_marketplace": "<the marketplace repo>"`, then run `npx atf sync`.
2. **Build the marketplace.** Run `node packages/core/scripts/build-plugin.mjs --marketplace <dir>` in the framework repository, and push `<dir>` to the private marketplace repo. Or add `<dir>` as a local marketplace: `/plugin marketplace add <dir>`.
3. **Install and check.**
   - Open Claude Code in the workspace, trust it, and confirm `/plugin` lists `atf@testagentic` as enabled.
   - Confirm that `artifacts/.atf-plugin.json` names the package's version.
   - Confirm that `npx atf doctor <product>` passes its plugin checks.
4. **Add a probe module.** A readonly run-config for a harmless target you own.

## Checks

| # | Question | How to check | Expected | Result |
|---|---|---|---|---|
| 1 | The exact `agent_type` of a plugin worker in the PreToolUse payload | Start `claude --agent atf:orchestrator-agent` and let it reach a worker; read `artifacts/hook-errors.jsonl`, or temporarily log the payload | `atf:<name>` (one segment), mapped by the Claude adapter to `<name>` | |
| 2 | How a plugin agent names its subagents | Check the spawns: the `subagent_type` in the payload, and whether the `atf:`-prefixed allow-list in the plugin's agent files works | The `atf:` names resolve. If only bare names work, flip the switch in `build-plugin.mjs` and record it | |
| 2b | Bare spawn names from the scripts | `run.mjs next` and `orchestration.mjs next` name the agent to spawn bare (`module-explorer`). In plugin mode, without project agents, check that the orchestrator's spawn of that bare name reaches `atf:module-explorer` | It resolves. If it doesn't, the scripts must print `atf:<name>` in plugin mode: a design change with a decision entry | |
| 3 | Three layers of nesting | orchestrator, then domain orchestrator, then worker, then try a fourth spawn | Three layers work; the Agent tool is withheld at the limit | |
| 4 | Plugin agents and project agents together | With a fragment in `atf/agents/` (customized mode), list `/agents` and run | Bare-named project agents run; `atf:` agents are present but unused | |
| 5 | The guard stays in the project | `/hooks` and `claude --debug`: PreToolUse comes from `.claude/settings.json`, not the plugin | One guard registration, from project settings | |
| 6 | The guard denies a plugin agent | Have a plugin worker attempt a write its row refuses (e.g. under `atf/`) | Denied with the agent's own rule | |
| 7 | Another plugin's agent | Install a second test plugin with an agent; make it write a file during a full-run | Treated as unattributed: the run's combined ceiling, refused under `atf/` | |
| 8 | The plugin's MCP tool names | Use a browser tool through `atf:module-explorer` | `mcp__plugin_atf_playwright__…`, classified like `mcp__playwright__…`; the hook matcher fires for it | |
| 9 | `disableAllHooks` and `allowManagedHooksOnly` | Set each in user or project settings | The project guard is unaffected by the plugin's state. Note what each setting does to all hooks: `disableAllHooks` turns the guard off, which the doctor should report | |
| 10 | `${CLAUDE_PROJECT_DIR}` in the plugin's SessionStart hook and MCP args | Start a session; check `artifacts/.atf-plugin.json` and the MCP server's command line | Both resolve to the workspace | |
| 11 | The version lock | Update the plugin without updating npm (or the reverse), then start a session and `run.mjs init` | The doctor fails and init refuses, naming both versions | |
| 12 | Private marketplace access | A client machine with read access only to the marketplace repo (SSH or `gh auth setup-git`): add, install, update | Works without the framework monorepo; a background update keeps the old checkout on failure | |

## After the run
- **Fix any mismatch.** Record each result that differs from the expected one, then change the design (a new decision entry) or the docs.
- **Record the strings you saw.** Note the exact `agent_type` and MCP tool names in the adapter tests (`scripts/hooks.test.mjs`).
