# Antigravity spike kit (Phase 0)

**Dev-only.** This folder is not shipped (it is not in `packages/core/package-files.txt`) and is not a workspace: its `workspace/` holds templates, which `setup.mjs` copies into a scratch folder outside the repo. Everything the Antigravity host support marks `UNVERIFIED (Antigravity spike pending, docs/antigravity-spike/)` is settled here.

It follows the method in `packages/core/docs/platforms.md` ("Verified facts"): register an audit hook that appends each payload to a file, run one agent per surface, then turn the captured payloads into fixtures.

## What's here

| File | Purpose |
|---|---|
| `audit-hook.mjs` | The audit hook. It appends `{ts, argv, cwd, env, payload, emitted}` to a JSONL file, prints nothing and exits 0. With `--deny-canary`, a pre-tool call containing `atf-spike-canary` is refused: by default with stdout `{"decision":"deny",...}` and exit 0; with `--exit2`, through stderr and exit 2; with `--ask`, as an `ask`. |
| `setup.mjs` | Writes the scratch workspace and fills in its absolute paths. |
| `workspace/.agents/hooks.json` | The named hook set `atf-spike`: PreToolUse and PostToolUse, matcher `.*`, `--source workspace`. A second set, `client-set` (PreToolUse only, `--source client-set --allow-canary`), stands in for a client's own hooks; `setup.mjs` keeps it only with `--second-set` (check 8). |
| `workspace/.agents/mcp_config.json` | The Playwright MCP server, mirroring `packages/core/config/mcp.yaml`. |
| `workspace/.agents/agents/spike-*.md` | The chain spike-parent → spike-child → spike-grandchild. Each has a frontmatter hook, `--source agent --agent <name>`. **That frontmatter hook is the thing being tested.** |
| `workspace/PROMPTS.md` | The exact prompts to type, P1 to P16. |

## Setup

1. Install Antigravity (the App, which includes the IDE) and the `agy` CLI. Note their versions, your OS, and the model you picked.
2. From this repo, run `node docs/antigravity-spike/setup.mjs C:\atf-spike`. On macOS/Linux, use `~/atf-spike`. Pick a path without spaces. The script refuses a folder inside the repo.
3. Open `C:\atf-spike` as the workspace:
   - **App:** open the folder.
   - **CLI:** `cd C:\atf-spike` then `agy`. With an agent: `agy --agent spike-parent` (UNVERIFIED flag; record the real one from `agy --help`).
   - **IDE:** open the folder.
4. Confirm the hook fires: type P1 and check that `C:\atf-spike\antigravity-audit.jsonl` grows. If it doesn't, record what the UI shows (hooks panel, errors), then try `timeout` in milliseconds, or no `timeout` at all.
5. Switch the deny form by running `setup.mjs` again, e.g. `node docs/antigravity-spike/setup.mjs C:\atf-spike --deny-canary --exit2`. The audit file is kept, and each line's `argv` shows which form was active. Reload the workspace or start a new conversation after each switch, since hooks may be read at start-up.

**Read the audit file:** `node -e "for (const l of require('fs').readFileSync('antigravity-audit.jsonl','utf8').trim().split('\n')) { const r = JSON.parse(l); console.log(r.ts, r.argv.join(' '), r.payload?.toolCall?.name ?? '', JSON.stringify(r.payload?.toolCall?.args ?? '').slice(0, 160)) }"`

## Checks (run each on App, CLI and IDE; Windows first, then macOS/Linux if available)

| # | Check | How | Record |
|---|---|---|---|
| 1 | Built-in tool names and argument shapes | P1 to P9 | For each call: `toolCall.name` and the exact keys of `toolCall.args`. Cover `run_command` (`CommandLine`? `Cwd`?), `write_to_file`, `replace_file_content`, `multi_replace_file_content` (path key), `invoke_subagent` (which key names the agent), `ask_question`, `read_url_content`, `search_web`, `manage_task`, `define_subagent`, `send_message`, `manage_subagents`, the built-in browser tools and `evaluate_script`. Most important: **the exact name of a Playwright MCP tool** (P6), e.g. `mcp_playwright_browser_navigate` or something else, and whether its server part is exactly the `mcp_config.json` key (`playwright`). The adapter now takes any server key that contains `playwright` (S8-09); if the name carries the exact key, it can require `playwright` exactly, so a user-level server such as `playwright-ext` (which can drive your own Chrome) stays unknown. Also record the full top-level payload keys (`stepIdx`, `conversationId`, `workspacePaths`, `transcriptPath`, `artifactDirectoryPath`, `modelName`, a hook event name?). |
| 2 | Do workspace hooks fire inside subagents, at every level? | P9 | `--source workspace` lines for the calls of spike-child and spike-grandchild (their `echo child-level` and `echo grandchild-level` commands). Does anything in the payload tell the levels apart (`conversationId`, `stepIdx`, a subagent field)? |
| 3 | Do agent-frontmatter hooks run, and only while that agent is active? | P9, P12 | For every call, which `--agent <name>` lines appear next to the workspace line. Expected if it works: exactly one agent line per call, naming the agent that made it. Bad outcomes: no agent lines; the parent's hook also firing for the child's calls; nothing at level 3. If no shape fires, try those in "Frontmatter hook shapes" below. Record the shape that works. |
| 4 | Is a `deny` honoured, and in which form? | P11 in each form (`--deny-canary`, `--deny-canary --exit2`, `--deny-canary --ask`), then P10 under every permission preset: Request Review, Default, Auto, Turbo, the IDE's Always Proceed, and `agy --dangerously-skip-permissions` | Per form and preset: did the command run? (Look for `echo` output in the agent's answer, and whether a PostToolUse line exists for the call.) What did the agent see as the reason? Did `ask` prompt you? Was a deny in a grandchild honoured? |
| 5 | Hook env and cwd | any line | The `env` names present (a variable that proves the hook runs under Antigravity, and one per surface if any), `cwd` compared with `payload.workspacePaths`, and `argv` (does the quoting survive?). The cwd matters for safety: a payload the guard can't parse loses its `workspacePaths`, so the guard judges the hook's own cwd, and fails open during a run if that is not the workspace (S8-04). On Windows: which shell ran the command (PowerShell, cmd)? Did a BOM appear in stdin (`payload.unparsed`)? |
| 6 | Agent-file acceptance | P12, P13, plus edits | (a) Add a bogus `tools` entry (`view_fiel`) to spike-grandchild: is it rejected, ignored, or does the agent hang? (b) Add `mcpServers: { playwright: {} }` to spike-grandchild's frontmatter: is it accepted, and what shape is required? (c) `mainAgent`/`subagent`: is spike-grandchild hidden from the picker? (d) Body size: paste a body of about 40,000 characters, and record any limit or truncation. (e) P13: does `commandExecutionPolicy: sandbox` block network? |
| 7 | IDE agents | IDE only | Does the IDE list `.agents/agents/` agents, and does P9 reach the grandchild (`invoke_subagent`)? If not, record what the IDE offers instead. |
| 8 | Two hook sets | P14, after `setup.mjs <dir> --deny-canary --second-set` | Do both sets run for each call, and in which order (compare the `ts` of the `workspace` and `client-set` lines)? Is it the key order of `.agents/hooks.json`? Swap the two sets by hand and repeat. Most important: when `atf-spike` denies and `client-set` answers `allow`, **did the command run?** If another set's allow can override the guard's deny, Antigravity is not supported for runs in a workspace with its own hooks. |
| 9 | `run_command`'s working directory | P15 | The args key that names it (`Cwd`?), and where `p15.txt` landed: in `spike-out/` (the command runs in `Cwd`, which the guard now reads as a base for relative write targets, S8-01) or in the workspace root. |
| 10 | Multi-root windows | P16 (App and IDE) | `workspacePaths` with two folders open: their order, whether it follows the folder the agent works in, and whether it is the same in subagents. The guard judges every listed folder with an active run (S8-02). |

**Gate (from the plan).** A surface where a `deny` isn't honoured, or where subagent calls skip the hooks, is documented as **not supported for runs**.

### Frontmatter hook shapes (check 3)

The templates use the Claude-style nested shape: `hooks: { PreToolUse: [ { matcher, hooks: [ { type, command, timeout } ] } ] }`. If no `--source agent` line ever appears, try these one at a time on spike-parent (start a new conversation each time):
- the flat shape: `hooks: { PreToolUse: [ { matcher: ".*", command: "...", timeout: 30 } ] }`
- `hooks:` as a reference to a named set: `hooks: [atf-spike]`
- `timeout` in milliseconds (`30000`)

Record the shape that works, quoting the changelog v2.17 text if you can.

## Results

Copy this table into your notes, one per OS:

| Check | App | CLI | IDE |
|---|---|---|---|
| 1 tool names / arg keys | | | |
| 2 workspace hook in subagents (L2, L3) | | | |
| 3 frontmatter hook shape, per-agent only? | | | |
| 4 deny form honoured; presets that ignore it; ask prompts? | | | |
| 5 env vars, cwd vs workspacePaths, shell | | | |
| 6 tools / mcpServers / flags / body limit / sandbox network | | | |
| 7 IDE agents + subagents | n/a | n/a | |
| 8 two hook sets: order; does an allow override a deny? | | | |
| 9 `run_command` Cwd key; where the file lands | | | |
| 10 multi-root `workspacePaths` | | n/a | |

## Turning payloads into fixtures

For each distinct tool (and each surface where the payload differs):
1. Take the `payload` object of one PreToolUse audit line, verbatim. Don't use the whole line.
2. Redact anything personal: user names in paths (`C:/Users/<you>` → `C:/Users/dev`), conversation and transcript ids if you prefer (keep their shape), and any secret. The hook already blanks env values whose names look secret, but the payload is not scrubbed.
3. Save it as `packages/core/scripts/fixtures/hooks/antigravity-captured-<surface>-<tool>.json`, e.g. `antigravity-captured-cli-run_command.json` or `antigravity-captured-app-invoke_subagent-level3.json`. Delete the `antigravity-documented-*` fixture it replaces.
4. Point the tests in `packages/core/scripts/hooks.test.mjs` at the captured fixture, and remove the matching `UNVERIFIED` comment.

## What each finding updates in the repo

| Finding | Repo value |
|---|---|
| 1: Playwright MCP tool name | `packages/core/config/platforms.yaml` antigravity `tools.browser` template (now `mcp_{server}_browser_{tool}`), and the BROWSER regex in `packages/core/scripts/hooks/hosts/antigravity.mjs` |
| 1: other tool names | `platforms.yaml` antigravity `tools`, and the adapter's tool map (mapped, "other", or deliberately unmapped) |
| 1: arg keys | the adapter's tolerant key lists (command, cwd, paths, url, subagent): shrink them to the captured keys |
| 2 + 3: per-agent hooks run at every level, only for their agent | `platforms.yaml` antigravity `identity_hook` (the frontmatter shape), the renderer `packages/core/scripts/lib/agents/renderers/antigravity.mjs`, and `packages/core/scripts/lib/hosts.mjs` `HOSTS.antigravity.identity` from `"none"` to `"agent-hook"`. Otherwise it stays `"none"`: the D-035 combined ceiling. |
| 2: workspace hooks skip subagents | That surface is not supported for runs (`platforms.md`). |
| 4: deny form | the adapter's emit: stdout JSON with exit 0 (now), or exit 2. Also the deny/ask handling, the presets listed as not supported for runs in `platforms.md`, and the hook entry's fallback when no adapter loads (`packages/core/scripts/hooks/pretooluse.mjs`: now exit 2 and the stdout deny, S8-03): keep only the form Antigravity honours |
| 5: env vars | `lib/hosts.mjs` `resolveHost("antigravity")` (now accepted as asserted): check the variable you found. Also the adapter's `rootsOf` (every `workspacePaths` folder with an active run, else the first marked one, else the payload's cwd). |
| 5: shell / BOM on Windows | the registration command in `packages/core/scripts/lib/hook-registrations.mjs`, and the BOM strip in the hook entry |
| 6: agent-file acceptance | the renderer: `tools`, per-agent `mcpServers` (now omitted), `mainAgent`/`subagent`, `commandExecutionPolicy` (runners need network). Also the body limit in `platforms.yaml`. |
| 7: IDE | `platforms.md`: the IDE gets the brief only, if it has no custom agents |
| 8: a second set's allow overrides a deny, or sets run in another order | `packages/core/scripts/lib/hook-registrations.mjs` (the `atf-guard` set is rendered first; its header marks the order UNVERIFIED), and `platforms.md`: not supported for runs next to client hook sets, if an allow wins |
| 9: `Cwd` key | the adapter's `cwd` key list (now `Cwd`, `cwd`) |
| 10: `workspacePaths` order | the adapter's `rootsOf` |
| CLI flags (`agy --help`) | `packages/core/scripts/lib/cli.mjs`: `atf run --host antigravity` (now `agy --agent orchestrator-agent`) |
| everything | a findings section in `packages/core/docs/platforms.md`, and the D-099 entry in `docs/decisions.md` |

## Cleanup

Delete the scratch folder when you're done. Nothing in this repo changes when you run the spike, except the fixtures you add.
