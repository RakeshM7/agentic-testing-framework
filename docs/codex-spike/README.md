# Codex spike kit

**Dev-only.** Not shipped (not in `packages/core/package-files.txt`) and not a workspace: `workspace/` holds templates that `setup.mjs` copies to a temp folder outside the repo. Everything the Codex host support marks `UNVERIFIED (Codex spike pending, docs/codex-spike/)` is settled here. Method: an audit hook appends every payload to `audit.jsonl`; run a few prompts on each surface; compare the payloads with the framework's assumptions (`docs/codex-plan.md` section 2 and K1 to K6).

## What's here

| File | Purpose |
|---|---|
| `audit-hook.mjs` | Appends `{ts, cwd, argv, payload, emitted}` to `audit.jsonl` next to itself, then allows. A tool call containing `SPIKE-DENY-JSON` gets the documented stdout deny JSON at exit 0; one containing `SPIKE-DENY-EXIT2` gets stderr plus exit 2. |
| `setup.mjs` | Copies `workspace/` and the hook to a fresh temp dir (or the path you pass) and writes the hook's absolute path into `.codex/hooks.json`. |
| `workspace/.codex/config.toml` | `agents.max_depth = 3`, `web_search = "disabled"` (the value under test) and a playwright MCP server. |
| `workspace/.codex/hooks.json` | PreToolUse, PostToolUse, SubagentStart and SubagentStop, matcher `.*`, all running the audit hook. |
| `workspace/.codex/agents/spike-*.toml` | The chain spike-parent, spike-child, spike-grandchild. Each runs `echo <name>`, makes one `apply_patch` edit, and (parent, child) spawns the next level. |
| `workspace/PROMPTS.md` | The prompts P1 to P10. |

## How to run

1. Install the Codex CLI, the Codex app and the IDE extension. Note their versions, your OS and the model.
2. `node docs/codex-spike/setup.mjs` (prints the temp folder; or pass a path outside the repo).
3. Open that folder in each surface: CLI (`cd <dir> && codex`), app, IDE extension.
4. **Trust the project** when asked, then run `/hooks` and review the four hooks (check 9 tests whether either step is really required).
5. Paste the prompts from `workspace/PROMPTS.md`, one new session each.
6. Read the audit file: `node -e "for (const l of require('fs').readFileSync('audit.jsonl','utf8').trim().split('\n')) { const r = JSON.parse(l); const p = r.payload ?? {}; console.log(r.ts, p.hook_event_name, p.tool_name, JSON.stringify(p.tool_input ?? '').slice(0, 140), 'cwd=' + r.cwd) }"` (run it in the spike folder). Re-run it between prompts to tell their lines apart.

## Checks (each on the CLI, the app and the IDE extension)

| # | Check | Prompts | Record |
|---|---|---|---|
| 1 | Does the hook run, and from which cwd? Is project trust and `/hooks` review needed first? Does it still run when the session starts in a subfolder? | P1, P9, P10 | Lines present or not per step; `cwd` (process) vs `payload.cwd`; any UI message about untrusted hooks. |
| 2 | Is a deny honoured: stdout JSON at exit 0, and exit 2? | P2, P3, P4 | Did the command or patch run? What reason text did the model see? |
| 3 | Exact payload field names and tool names: top-level keys (`session_id`, `transcript_path`, `cwd`, `hook_event_name`, `model`, `turn_id`, `tool_name`, `tool_use_id`, `tool_input`, `permission_mode`?). `tool_name` and `tool_input` keys for Bash, `exec_command`, `apply_patch` (is `tool_input.command` the patch text?), the MCP form (`mcp__playwright__browser_*`?), `spawn_agent` (which key names the agent) and `view_image`. | P1, P4, P5, P7, P8 | Verbatim `tool_name` and key list per tool. |
| 4 | Do subagents' tool calls reach PreToolUse, and does any field name the calling subagent? Do SubagentStart/Stop fire and what do they carry? | P1 | Lines for the `echo spike-child` and `echo spike-grandchild` calls; any agent-identifying field. |
| 5 | Is nesting to depth 3 allowed with `agents.max_depth = 3`? | P1 | Do `spike-grandchild.txt` and its audit lines exist? Any depth error text. |
| 6 | Is hosted web search off with `web_search = "disabled"`? | P6 | Did the model search? Any audit line for it? If it searched, try other keys and record which works. |
| 7 | Does every surface behave the same? | all | Differences in payload, cwd, trust prompts or deny handling per surface. |

## Results (fill in, one table per OS)

| Check | CLI | App | IDE |
|---|---|---|---|
| 1 hook runs / cwd / trust + `/hooks` needed / subfolder | | | |
| 2 stdout JSON deny at exit 0 blocks? exit 2 blocks? | | | |
| 3 payload keys and tool names | | | |
| 4 subagent calls reach hooks; identifying field | | | |
| 5 depth 3 allowed | | | |
| 6 web search off | | | |

## What each finding updates in the repo

| Finding | Repo value |
|---|---|
| 3: `tool_name` of shell, `exec_command`, `apply_patch`, `spawn_agent`, `view_image`, `update_plan` | `packages/core/scripts/hooks/hosts/codex.mjs` `KINDS` (and `platforms.yaml` codex `tools`) |
| 3: `tool_input` keys (command as string or array, `workdir`/`cwd`, patch text in `command`, the `spawn_agent` agent key) | the argument-key lists in `hosts/codex.mjs`; shrink them to the captured keys |
| 3: MCP name form | `hosts/codex.mjs` browser regex and `platforms.yaml` codex `tools.browser` |
| 3: payload field names (`session_id`, `cwd`) | `hosts/codex.mjs` `normalize` and `rootOf` |
| 2: deny form honoured | `hosts/codex.mjs` `emit` (stdout JSON plus exit 0, or exit 2); the ask-as-deny text |
| 4: a field names the calling subagent | `packages/core/scripts/lib/hosts.mjs` `HOSTS.codex.identity` from `"none"` (combined ceiling, D-035) to an identity mode, and the adapter's `agent` handling |
| 4: subagent calls skip hooks | Codex is not supported for runs: `platforms.md` |
| 1: the host can be detected | `hosts.mjs` `resolveHost("codex")` (accepted as asserted today) |
| 1: hook breaks from a subfolder | the command in `packages/core/scripts/lib/hook-registrations.mjs` (`CODEX_HOOKS`: the codex commands are cwd-relative today) |
| 1: trust or `/hooks` review needed | `platforms.md` setup steps; `atf` next-steps text |
| 5: depth 3 refused or needs another value | `packages/core/scripts/lib/codex-config.mjs` `max_depth` (3) and the prompt wrapper depth |
| 6: web search still on, or another key works | `codex-config.mjs` `web_search` key and value; if it can't be disabled, D-116 |
| 7: surfaces differ | `platforms.md`: mark the surface not supported for runs |
| everything | a findings section in `packages/core/docs/platforms.md`, then fixtures `scripts/fixtures/hooks/codex-captured-<surface>-<tool>.json` (the `payload` object of a PreToolUse line, personal paths redacted) replacing the `codex-documented-*` ones |

## Cleanup

Delete the temp folder when done. Nothing in the repo changes except the fixtures you add.
