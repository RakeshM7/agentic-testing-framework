# Codex as a host: plan, contracts and work items

Branch `feat/codex-host`. This plan follows the Antigravity host (D-099 to D-101, commit 95c4a12): one platform block, one renderer, one thin hook adapter, the hook registrations, CLI wiring and a spike kit. Read D-099, D-035, D-036, D-101 and D-020 first: `node packages/core/scripts/decisions.mjs show D-099`.

## 1. What the user chose (2026-11-01)
| Question | Answer |
|---|---|
| Surfaces | The Codex CLI, the Codex app (desktop) and the Codex IDE extension. All three read the project's `.codex/`, and all are host `codex`. |
| Identity | Combined ceiling (D-035): host identity `none`. Codex's `PreToolUse` payload doesn't name the calling subagent; a live spike may upgrade this later. |
| Hosted web search | **Off** in the generated `.codex/config.toml`, because the guard can't see it. |
| Unknown tools | **Denied during a run**, readonly included, as on Antigravity (D-101): `unknownTools: "deny-in-run"`. |
| Main session | Codex has no `--agent` flag, so the session's first prompt tells Codex to **spawn `orchestrator-agent`** and hand it the run. Depth: main (0) → orchestrator (1) → domain orchestrators (2) → workers (3), so `agents.max_depth = 3`. |
| Verification | Build from the docs with `UNVERIFIED (Codex spike pending, docs/codex-spike/)` markers, plus a spike kit in `docs/codex-spike/`. |
| The current `.codex/` | Delete it; it's the Codex app's import from Claude, with stale paths and `--host claude-code`. `npm run build-agents` generates `.codex/` from now on. |

## 2. Facts from the Codex docs (learn.chatgpt.com/docs, read 2026-11-01)
The pages show no versions.
- **Project config:** `<repo>/.codex/config.toml`, loaded only for a **trusted** project. Precedence: CLI flags, then the project file, then the profile, then `~/.codex/config.toml`.
- **MCP:**
  ```toml
  [mcp_servers.<name>]
  command = "npx"
  args = [...]
  env = { ... }
  ```
  Tools appear to hooks as `mcp__<server>__<tool>`.
- **Agents:** `.codex/agents/*.toml`, one per agent.
  - Required: `name`, `description`, `developer_instructions`.
  - Optional: `model`, `model_reasoning_effort`, `[features] shell_tool = false`, and others.
  - **There is no per-agent `tools`, `sandbox_mode` or `mcp_servers`**: subagents inherit the parent's sandbox, approvals and MCP servers.
  - `config.toml [agents]` has `max_depth` (default 1, root = 0) and `max_concurrent_threads_per_session`.
  - The spawn tool is `spawn_agent`, which matchers also see as `Agent`.
- **Hooks:**
  - **Where they live:** `<repo>/.codex/hooks.json`, in the same JSON shape as Claude Code's `hooks` key: `{"hooks":{"PreToolUse":[{"matcher":"<regex>","hooks":[{"type":"command","command":"…","timeout":30}]}]}}`. They are trusted per project and reviewed with `/hooks`.
  - **When they run:** commands run in the **session cwd**. Events include `PreToolUse`, `PostToolUse`, `SubagentStart` and `SubagentStop`.
  - **Payload on stdin:** `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `model`, `turn_id`, `tool_name`, `tool_use_id`, `tool_input` and `permission_mode`. Bash and `apply_patch` both carry `tool_input.command`.
  - **How to deny:** exit 0 with `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"…"}}`, or exit 2 with the reason on stderr. **`ask` is not supported.**
- **Tool names hooks see:**
  - `Bash` (the shell and `exec_command`);
  - `apply_patch` (matchers also see it as `Edit` and `Write`);
  - `mcp__<server>__<tool>`;
  - `spawn_agent`;
  - `update_plan`.

  **Hosted `WebSearch` is not hookable.**
- **AGENTS.md** is read from the git root down to the cwd, up to 32 KiB.

## 3. Contracts

### K1. The platform block: `packages/core/config/platforms.yaml` `codex` (W1)
```yaml
codex:
  renderer: codex
  output: ".codex/agents/{name}.toml"
  # no mcp_config: the MCP servers go into .codex/config.toml's atf block (K3)
  tools:            # Codex has no per-agent tool list; these names exist for forbidden_in_body and docs
    read: []
    search: []
    write: [apply_patch]
    shell: [Bash]
    web_fetch: []
    web_search: []  # hosted web search is off (K3)
    spawn: "spawn_agent"
    browser: "mcp__{server}__browser_{tool}"
    ask: []         # the human answers in the main session's chat
  forbidden_in_body: [spawn_agent, apply_patch, update_plan, exec_command]
```
- In `config/models.yaml`, `codex: inherit`. The agent then runs the session's model and the renderer writes no `model` key, as on Antigravity (D-100).
- **The renderer** is `scripts/lib/agents/renderers/codex.mjs`, with `render({name, meta, body, eol, tools, caps, model, fw, installed, dev})`, and it returns TOML:
  ```toml
  # GENERATED from {fw}/agents/<name>.md by {fw}/scripts/build-agents.mjs -- edit the source, then run npm run build-agents.
  name = "<name>"
  description = "<description, TOML basic string escaped>"
  developer_instructions = '''
  <body>
  '''
  ```
  - The body goes in a TOML multi-line literal string, which needs no escaping. If the body contains `'''`, use a multi-line basic string `"""…"""` instead, with `\` and `"""` escaped.
  - Add `[features]` with `shell_tool = false` only when the agent's permissions give it no shell (`caps.shell === "none"`), as defence in depth.
  - No `model` while it's `inherit`. No `tools`, `sandbox_mode` or `mcp_servers`: Codex ignores them.
- `isGenerated` (`renderers/common.mjs`) also recognises a TOML file whose first line is `# GENERATED (from |by atf sync )`.

### K2. The hooks: `.codex/hooks.json` (W2)
- `scripts/lib/hook-registrations.mjs` gets `CODEX_HOOKS = ".codex/hooks.json"` and `mergeCodexHooks(currentText, mode, fw)`, rendered by `renderHookRegistrations(mode, claudeSettings, fw, { antigravityHooks, codexHooks })`.
- The file holds `{"hooks":{…}}`, in Claude's shape. The framework owns only its own entries: a hook whose command runs `scripts/hooks/pretooluse.mjs` or `posttooluse.mjs` with **`--host codex`**. The merge rule is the same as `mergeClaudeHooks`, generalised by host rather than copied.
- The entries:
  - `PreToolUse`: matcher `".*"`, command `node {fw}/scripts/hooks/pretooluse.mjs --host codex`, `timeout: 30`.
  - `PostToolUse`: the same matcher and `posttooluse.mjs --host codex`, unless the mode is `off`.
  - Codex has no async hooks, so the `async` mode renders as sync.
  - The commands are relative to the session cwd. UNVERIFIED: whether the hook breaks if a session is started from a subfolder.
- A guard missing from the merged result is an internal error, as for Claude. A malformed file is an error naming `.codex/hooks.json`, and nothing is written.

### K3. The project config: `.codex/config.toml`, the atf block (W2)
`scripts/lib/codex-config.mjs` is new and dependency-free. It exports:
- `CODEX_CONFIG = ".codex/config.toml"`.
- `renderCodexConfig(currentText | undefined, mcp, fw)` returns the whole file text, or throws `Error` with `.file = CODEX_CONFIG`.
- `atfBlock(mcp, fw)`, the block itself:
  ```toml
  # >>> atf: generated by build-agents (D-115) -- do not edit inside this block; run npm run build-agents >>>
  web_search = "disabled"          # UNVERIFIED key (Codex spike pending, docs/codex-spike/): hosted web search is off, the guard can't see it

  [agents]
  max_depth = 3                    # main session -> orchestrator-agent -> domain orchestrators -> workers

  [mcp_servers.playwright]         # one table per server of config/mcp.yaml, {fw} expanded
  command = "npx"
  args = ["-y", "@playwright/mcp@0.0.83", "--browser", "chromium", "--isolated", "--init-page", "scripts/browser/init-page.cjs"]
  # <<< atf <<<
  ```
- **The file layout:** the client's **prelude** (only blank lines, comments and top-level `key = value` lines, no table header), then **the atf block**, then the client's **tail** (from its first table header on).
  - TOML requires top-level keys before any table. The block's last table would swallow any top-level key that followed it.
  - On re-render, the old block is located by its markers and replaced, and the prelude and tail are kept byte for byte.
  - With no file, the output is just the block.
- **Errors** (nothing is written), each naming `.codex/config.toml` and saying where the content belongs:
  - a table header in the prelude;
  - a non-comment line before the first table header in the tail;
  - a prelude key `web_search`, or a dotted key starting `agents.`, `features.web_search` or `mcp_servers.`;
  - a tail table `[agents]` or `[agents.*]`, or `[mcp_servers.<a server atf renders>]`;
  - a block start marker without an end marker.
- **String output:** TOML basic strings, with `\`, `"` and control characters escaped. Arrays of strings stay on one line, and an `env` map renders as an inline table. Only the shapes `config/mcp.yaml` uses are supported (`command`, `args`, `env`); anything else throws.

### K4. The hook adapter: `scripts/hooks/hosts/codex.mjs` (W3)
It exports `normalize(payload, {env, host = "codex", agent})`, `rootOf(payload)` and `emit({decision, rule, reason})`, registered in `hooks/hosts/index.mjs` as `codex: "./codex.mjs"`.
- **Root:** `rootOf` is `payload.cwd`, else `process.cwd()`. The hook entry applies `hookWorkspaceRoot`.
- **Kinds by `tool_name`:**
  - `Bash` and `exec_command` are `shell`. `command` is `tool_input.command`.
    - A string is used as it is.
    - An array `[sh, "-lc"|"-c", script]`, where `sh` is `bash`, `sh` or `zsh` or a path ending in one, means `script`. Any other array is joined with spaces.
    - A shell call with no command is `unknown`.
    - `tool_input.workdir` or `cwd`, if present, goes into `cwds`, never the root.
  - `apply_patch` is `write`. `paths` are parsed from the patch text in `tool_input.command`, or `tool_input.patch`/`input` read tolerantly. Every `*** Add File: p`, `*** Update File: p`, `*** Delete File: p` and `*** Move to: p` line counts, trimmed. No path means a write with no target, which the guard refuses for a managed caller.
  - `mcp__<server>__browser_<tool>` with `playwright` in the server name is `browser` (reuse the `browserActionOf` logic, the `mcp__` form only). Any other MCP tool is `unknown`.
  - `spawn_agent` is `spawn`. `subagent` comes from `tool_input` keys `agent_type`, `agent`, `name`, `agent_name`, `subagent_type` and `role`. Two different values mean no subagent.
  - `update_plan` is `other`. `view_image` is `read` (UNVERIFIED). Everything else is `unknown`.
- `sessionId` is `payload.session_id`. `agent` is only ever the registration's `--agent`, never taken from the payload.
- **`emit`:**
  - allow: exit 0 and no output.
  - deny: stdout `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Blocked by the framework guard (<rule>): <reason>"}}`, the same text on stderr, exit 0.
  - ask: Codex doesn't support ask, so it's emitted as a **deny** whose reason starts with "Needs the user's confirmation, which Codex hooks can't ask for: " followed by the reason.
  - The PostToolUse hook ignores `emit` output, so check what `posttooluse.mjs` needs from the adapter and support it.
- **`scripts/lib/hosts.mjs`:** `codex: { identity: "none", label: "Codex", unknownTools: "deny-in-run" }`. `resolveHost("codex")` is accepted as asserted, because no environment variable is documented to check it against (UNVERIFIED).
- **Fixtures:** `scripts/fixtures/hooks/codex-documented-<tool>.json`, one per mapped tool plus an unknown one.

### K5. The CLI: `atf run --host codex` (W4)
- In `scripts/lib/cli.mjs`, `HOSTS.codex = ["codex"]`, with the help text updated.
- The prompt for `codex` is wrapped: `Spawn the orchestrator-agent subagent and give it this task word for word, then relay its questions to me and my answers to it: <the host-neutral prompt>`. The neutral prompt is what the other hosts get. The wrapper is a pure, exported, tested function.
- `atf sync`'s `.gitignore` block lists the generated `.codex/agents/*.toml` files, through the platform's `output` as for the other platforms. `.codex/config.toml` and `.codex/hooks.json` are shared with the client, so they aren't ignored, like `.claude/settings.json`. If `sync.mjs` derives this automatically, a test is enough.
- **The VS Code extension** (`packages/vscode`, W4b): `atf.host` gets `codex`, a terminal session like `claude` (`--host codex`). Cover it in `package.json` (enum and description), `src/activate.js` `HOSTS` and `hostCliArgs`, and the tests.

### K6. The spike kit: `docs/codex-spike/` (W5)
Model it on `docs/antigravity-spike/`, read it first. It contains:
- `README.md`: the checks to run and what each result decides.
- `audit-hook.mjs`: logs every payload to `audit.jsonl` and allows.
- `setup.mjs`: copies the workspace into a temp folder.
- `workspace/.codex/{config.toml,hooks.json,agents/spike-parent.toml,spike-child.toml,spike-grandchild.toml}`.
- `workspace/PROMPTS.md`.

The checks:
1. Does the hook run, and from which cwd?
2. Is a deny honoured, both the stdout JSON at exit 0 and exit 2?
3. What do `tool_name` and `tool_input` look like for Bash, `exec_command`, `apply_patch`, MCP, `spawn_agent` (which key names the agent) and `view_image`?
4. Do subagents' tool calls reach `PreToolUse`, and does any field name the calling subagent?
5. Is nesting to depth 3 allowed with `agents.max_depth = 3`?
6. Is the hosted web search off with `web_search = "disabled"`?
7. Does each surface behave the same: the CLI, the app and the IDE extension?

## 4. Work items
Everything is on branch `feat/codex-host`. Each item owns its files; the integration item owns `build-agents.mjs`.

| # | Item | Files | Model | Owner |
|---|---|---|---|---|
| W1 | Platform block, renderer, models entry, TOML `isGenerated`, renderer and lint tests | `config/platforms.yaml`, `config/models.yaml`, `scripts/lib/agents/renderers/codex.mjs`, `renderers/common.mjs`, a new `scripts/codex-renderer.test.mjs` | sonnet, medium | subagent |
| W2 | `.codex/hooks.json` merge, `.codex/config.toml` atf block | `scripts/lib/hook-registrations.mjs`, a new `scripts/lib/codex-config.mjs`, `scripts/hook-registrations.test.mjs`, a new `scripts/codex-config.test.mjs` | sonnet, medium | subagent |
| W3 | Hook adapter, host entry, fixtures, guard and hook tests | `scripts/hooks/hosts/codex.mjs`, `hooks/hosts/index.mjs`, `scripts/lib/hosts.mjs`, `scripts/fixtures/hooks/codex-*.json`, a new `scripts/codex-hooks.test.mjs` | sonnet, higher (safety) | subagent |
| W4 | CLI host and prompt wrapper, gitignore | `scripts/lib/cli.mjs`, `scripts/lib/sync.mjs` (only if needed), `scripts/cli.test.mjs`, `scripts/sync.test.mjs` | sonnet, medium | subagent |
| W4b | VS Code `atf.host: codex` | `packages/vscode/package.json`, `src/activate.js`, tests | sonnet, low | subagent |
| W5 | Spike kit | `docs/codex-spike/**` | sonnet, low | subagent or teammate |
| W6 | Integration: wire W1 and W2 into `build-agents.mjs` (renderer, Codex agent folder in the stray and client-file checks, `config.toml` and `hooks.json`), delete the old `.codex/`, `npm run build-agents`, `npm run check`, `package-files.txt` | `scripts/build-agents.mjs`, `scripts/build-agents.test.mjs`, the generated `.codex/` | main session | me |
| W7 | Docs and decisions: D-115 (Codex is a host, with the K1 to K6 rules) and D-116 (hosted web search off on Codex), `platforms.md`, `AGENTS.md` (root and template), `architecture.md`, `docs/agent-architecture.md`, `artifact-contract.md` | docs | main session or a teammate | me |

**Rules for every item:**
- Read the decisions that govern your files first: `node packages/core/scripts/decisions.mjs for <files> --full`.
- The decisions hook asks the user before each governed edit. That's expected; a denied edit is reported, never worked around.
- Never weaken the guard: the adapter only adds a host, and denials only grow.
- Every code change has tests. Run the item's own tests, plus `node --test packages/core/scripts/hooks.test.mjs packages/core/scripts/guard.test.mjs` for W3.
- Don't run `npm run build-agents`; W6 does.
- Mark every value taken from the docs `UNVERIFIED (Codex spike pending, docs/codex-spike/)`, as the Antigravity code does.
- Any Bash command containing the word "sweep" is blocked by the guard. Use Write and Edit for such files.
- Don't commit.
