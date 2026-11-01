# Platforms and hosts

The pipeline, contracts, scripts and guard are platform-neutral. This doc is the only place for what differs per host. The reasons behind each choice are in [`decisions.md`](../../../docs/decisions.md) (D-018 – D-040; Antigravity: D-099 – D-101; Codex: D-115, D-116).

## How one agent becomes every platform's file

```
agents/<name>.md            identity + neutral prompt body    (the ONLY hand-written copy)
config/permissions.yaml     capabilities -> tools, subagents  (per agent)
config/models.yaml          model per platform
config/platforms.yaml       each platform's tool names, output path, MCP file, limits, identity hook
config/mcp.yaml             MCP servers
      │  npm run build-agents          (npm run check / CI: fail on drift, stray or hand-edited files)
      ▼
.claude/agents/<name>.md           Claude Code
.github/agents/<name>.agent.md     VS Code Copilot Chat, Copilot CLI, cloud coding agent
.agents/agents/<name>.md           Antigravity: the App, the agy CLI, the IDE
.codex/agents/<name>.toml          Codex: the CLI, the app, the IDE extension
.mcp.json, .vscode/mcp.json        MCP servers for Claude Code / VS Code
.agents/mcp_config.json            MCP servers for Antigravity
.codex/config.toml                 MCP servers + agent depth for Codex (the atf block)
      + hook registrations from config/hooks.yaml: .claude/settings.json, .github/hooks/, .vscode/hooks/,
        the `atf-guard` set of .agents/hooks.json, and the framework's entries in .codex/hooks.json
```

A body can share a fragment: a line `<!-- include: _shared/<file>.md -->` is replaced at build time by `agents/_shared/<file>.md` (the three fixers share `_shared/fixer.md`, D-059), so the generated files hold the expanded text. To change an agent, edit `agents/<name>.md` (body, `description`, `color`, `user_invocable`) and rebuild. To change what it may do, edit `config/permissions.yaml`, a human decision (D-013). Start a new session afterwards, since every host loads agents at session start.

## Starting a session

Start the **orchestrator-agent** session with a run-config path, or with none: it then interviews you (a few questions in one message, including which steps to run) and drafts `config/<product>.yaml` as `readonly` (D-063). With a path, it shows the step menu pre-selected from the config's `steps` and, before the first stage, asks you once per missing prerequisite (explore, clarify, generate test cases, describe scenarios, use your own test case file, or skip the step), D-066. `npx atf interview` and `npx atf run <product>` open that session on Claude Code (`--host copilot`: Copilot CLI; `--host antigravity`: the `agy` CLI; `--host codex`: the Codex CLI; `ATF_AGENT="<command>"`: any other CLI that takes the first prompt as its last argument). On other hosts, start it yourself and say you have no run-config yet. The interview needs a host where the agent can ask you questions. On one that can't, write the file by hand.

## Host matrix

VS Code Copilot Chat can run a chat on two engines. They behave differently for the guard, so they have separate columns (D-035, D-039). Antigravity's App and `agy` CLI share one column; its IDE has its own. Antigravity support is built from its documentation and is not yet verified live: "unverified" there means "see [`docs/antigravity-spike/`](../../../docs/antigravity-spike/README.md)" (D-099). The same holds for Codex, whose CLI, app and IDE extension share one column: "unverified" there means "see [`docs/codex-spike/`](../../../docs/codex-spike/README.md)" (D-115).

| | Claude Code | VS Code: local agent | VS Code: Copilot CLI engine | Copilot CLI | Copilot cloud coding agent | Antigravity App / CLI | Antigravity IDE | Codex CLI / app / IDE extension |
|---|---|---|---|---|---|---|---|---|
| Agent files | `.claude/agents/` | `.github/agents/` (`.claude/agents` turned off) | `.github/agents/` | `.github/agents/` | `.github/agents/` | `.agents/agents/` | `.agents/agents/` (whether the IDE lists them: unverified) | `.codex/agents/<name>.toml`, no per-agent tools (the guard alone enforces permissions) |
| Start a run | `claude --agent orchestrator-agent` | a local agent chat, then pick **orchestrator-agent** | a chat on the Copilot CLI engine (VS Code log: session type `agent-host-copilotcli`) | `copilot --agent orchestrator-agent` | assign an issue (maintenance only) | App: pick **orchestrator-agent**; CLI: `agy --agent orchestrator-agent` (flag unverified) | pick **orchestrator-agent** (unverified) | CLI: `codex "<prompt>"`, which tells Codex to spawn **orchestrator-agent** (`npx atf run <product> --host codex`); app / IDE: open the project and paste the same prompt (see below) |
| Nested subagents (3 layers) | yes | yes, with `chat.subagents.allowInvocationsFromSubagents` | not verified | not verified | n/a | unverified | unverified | `agents.max_depth = 3` in `.codex/config.toml`; whether it is honoured: unverified |
| Hook registration | `.claude/settings.json` | `.vscode/hooks/` + each agent's own hook | `.github/hooks/` (seen live) | `.github/hooks/` | `.github/hooks/` | the `atf-guard` set of `.agents/hooks.json` | the `atf-guard` set of `.agents/hooks.json` | `.codex/hooks.json` (`--host codex`), shared with your own hooks; the project must be trusted and its hooks reviewed with `/hooks` |
| Guard knows the calling agent | yes (`agent_type`) | yes (build-baked `--agent`) | **no** | **no** | **no** | **no** (until the spike verifies agents' own hooks) | **no** | **no** (identity `none`) |
| `full-run` | yes, per agent | yes, per agent | yes, **combined ceiling** | yes, **combined ceiling** | yes, **combined ceiling** | yes, **combined ceiling**; whether a deny is honoured: unverified | as App / CLI | yes, **combined ceiling**; whether a deny is honoured: unverified |
| Unmapped tools in a readonly run | denied for agents | denied for agents | mode rules only | mode rules only | mode rules only | **denied for every call** (D-101) | **denied for every call** (D-101) | **denied for every call** (D-101, D-115) |
| Ask the human | `AskUserQuestion` | `vscode/askQuestions` | not verified | `ask_user` | none: stops and reports | `ask_question` | `ask_question` | none: the human answers in the main session's chat |
| Live browser (Playwright MCP) | `.mcp.json` | `.vscode/mcp.json` | starts the Playwright server (seen live) | register the server from `config/mcp.yaml` in the CLI's MCP config | none | `.agents/mcp_config.json`; never the built-in browser | `.agents/mcp_config.json`; never the built-in browser | the Playwright MCP server in `.codex/config.toml`'s atf block; no web search (D-116) |
| Model | Claude Opus (D-017) | `config/models.yaml` | `auto` (seen live) | `config/models.yaml` | `config/models.yaml` | the session's: pick Claude Opus 5.5 (D-100) | the session's: pick Claude Opus 5.5 (D-100) | the session's (agents inherit it) |
| Design-decision confirmation | permission prompt | permission prompt | permission prompt | permission prompt | refused, reported in the PR | `ask` decision (unverified) | `ask` decision (unverified) | `ask` becomes a **deny** (Codex hooks can't ask); a human makes the edit |

**Combined ceiling** (D-035): where the guard can't tell which agent is calling, a full-run call may do what at least one of the run's agents may do. The run's agents are the layer-0 agents and everything they can spawn, so not `feedback-implementor-agent`.
- **Still blocked:** writes outside the pipeline's paths, starting agents outside the run, deletes of entities the run didn't create, and unmapped tools.
- **Lost:** one agent can do another agent's job. For example, a reviewer could edit tests, or a test writer could change data over HTTP.
- **Readonly runs:** unchanged on these hosts, except on Antigravity and Codex, where an unmapped tool is denied for every call during any run (D-101, D-115). On Antigravity: its built-in browser drives your own Chrome, outside the Playwright init page's readonly guard. On Codex, hosted web search, computer use and every non-Playwright MCP tool are such tools.

## Setup

### A client workspace (D-089)
1. Create it: `npx @testagentic/atf init <dir>`, with `ATF_NPM_TOKEN` and the `@testagentic` registry set up as in the access instructions (`docs/trusted-developer-access.md` in the framework's repository). In VS Code, the atf extension's **Create new project…** does the same with no `~/.npmrc` or shell variable: it asks once for the token, keeps it in VS Code's secret storage, and runs the `@testagentic/atf` of its own version (D-107).
   - **What it writes:** `package.json` with the package pinned and `"allowScripts": {"@testagentic/atf": true}` (npm 12 runs a dependency's install scripts only when allowed; a client's own entries are kept, and their `false` is respected and reported), a commented `.npmrc` registry template, an `.nvmrc` with the Node.js version CI tests on (the framework needs 20 or later, D-109), the `.gitignore` entries for run output and secrets, `atf/` with an empty decision log, `AGENTS.md`, `config/` and `.vscode/settings.json`. It never overwrites a file.
   - **Then it installs:** it runs `npm install`, then `atf sync` itself on the framework just installed (the host files), then the base doctor checks. Every npm it starts runs without an `allow-scripts` setting npx exported, which npm 12 refuses in a project install; npm still reads yours from `.npmrc` (D-108).
2. **Automatic sync:** every later `npm install` renders the host files (agents, MCP configs, hook registrations) through the package's postinstall `atf sync`. Those files are git-ignored. If install scripts are disabled, or npm 12 doesn't allow the package's (a workspace made before `allowScripts` was added, or your `allowScripts` denies it), run `npx atf sync` yourself after installing or upgrading; `npx atf doctor <product>` reports stale files and `npx atf check` fails on them. Once `package.json` has `allowScripts`, npm 12 ignores the `.npmrc` `allow-scripts` list for that project, with a warning.
3. **Customize only in `atf/`:**
   - config overlays `atf/<file>.yaml`, or ejected copies (`npx atf eject config <file>`);
   - agent additions `atf/agents/<name>.extra.md`;
   - your own MCP servers under `servers:` in `atf/mcp.yaml`.

   Your own Claude Code hooks in `.claude/settings.json` and your own agent files are kept by sync. Agents never write `atf/`.

### Claude Code
1. `npm install` (the hooks themselves need only Node.js 20 or later: on an older one the guard refuses every tool call of the session, D-109).
2. Start the session with `claude --agent orchestrator-agent` and give it `config/<product>.yaml`.
3. `.claude/settings.json` registers `scripts/hooks/pretooluse.mjs` and `posttooluse.mjs` with `--host claude-code`.

**Hook registrations on every host are generated** from `config/hooks.yaml` by `npm run build-agents`, or `npx atf sync` in a client workspace (D-092); never hand-edit the framework's entries. In `.claude/settings.json` the build owns only the framework's own hook entries, so a workspace's own Claude Code hooks there are kept. The PreToolUse guard is always registered and blocking. The PostToolUse hook, which only remembers confirmed design decisions, is set for all hosts with:

```
npm run build-agents -- --post-hook async   # default: Claude Code runs it in the background; Copilot, VS Code and Antigravity wait for it
npm run build-agents -- --post-hook sync    # every host waits for it
npm run build-agents -- --post-hook off     # not registered: faster, but every governed edit asks again
```

### VS Code Copilot Chat
1. Open the repo and **trust the workspace**. VS Code loads hooks and MCP servers only in a trusted workspace. Without hooks, the guard check (step 4) stops every run.
2. The committed `.vscode/settings.json` does five things:
   - turns `.claude/agents` off, so every agent is listed once;
   - enables nested subagents;
   - loads hooks from `.vscode/hooks/` but not `.github/hooks/` or `.claude/settings.json`;
   - uses `AGENTS.md`;
   - auto-approves only repo-local, non-mutating commands.
3. Start a **local agent** chat and pick **orchestrator-agent** in the agent picker. Workers are hidden (`user-invocable: false`); the orchestrators start them.
   - VS Code 1.141 can also run a chat on its **Copilot CLI engine**: the Copilot CLI runtime that VS Code bundles. That engine doesn't follow `.vscode/settings.json`. It uses `.github/agents/` and `.github/hooks/` like Copilot CLI and runs no custom-agent hooks, so the guard can't tell which agent is calling. A full-run there gives every call the run's combined ceiling (D-035).
4. The orchestrator runs `node {fw}/scripts/run.mjs guard-check <product>` first, and the guard must block it.
   - In VS Code's local agent, each custom agent's own hook names the agent to the guard. That is the Preview "custom agent hooks" feature.
   - If those hooks don't run, full-run is refused, and readonly still works.

### Copilot CLI
1. Run `copilot` from the repo root. It loads `.github/agents/` and `.github/hooks/`.
2. For live browser work, register the Playwright server from `config/mcp.yaml` in the CLI's MCP config, keeping the name `playwright`.
3. `copilot --agent orchestrator-agent`. The CLI's hooks can't tell the guard which agent is calling, so a full-run gives every call the run's combined ceiling (D-035).

### Copilot cloud coding agent
1. Assign an issue and pick an agent; `AGENTS.md` is its brief. `.github/workflows/copilot-setup-steps.yml` installs the scripts, the generated projects' dependencies and k6.
2. It is for framework maintenance and offline work only (D-030). It has no live browser. A full-run there gets the run's combined ceiling, as on the CLI (D-038). It can't answer a confirmation, so edits to decision-governed files are refused and it reports them in the PR.
3. **In a client workspace (opt-in, experimental, D-093).** The cloud agent reads custom agents and hooks only from files committed to the default branch, so the git-ignored host files never reach it.
   - **The opt-in:** set `"cloud_agent": true` in `atf/atf.json` and run `npx atf sync`. Sync stops ignoring `.github/agents/` and `.github/hooks/framework-guard.json`, and writes `.github/workflows/copilot-setup-steps.yml` once. That file is yours afterwards. It runs `npm ci` with the Agents secret `ATF_NPM_TOKEN`, reports committed Copilot files that are stale, then restores them, so an agent's PR never changes them.
   - **Commit and merge:** commit those files and merge them to the default branch. After a package upgrade, sync and commit them again.
   - **If `npm ci` fails** in setup, the guard's script is missing and every tool call is denied.
   - **The MCP files stay ignored:** the cloud agent takes MCP servers from repository settings.
   - **Before clients rely on it,** run the checklist in the framework repository's `docs/cloud-agent-verification.md` on a real repository.

### Antigravity: App, `agy` CLI and IDE (D-099)
Built from Antigravity's documentation; not yet verified live. Until the spike ([Verifying Antigravity](#verifying-antigravity)) has run on your surface, treat that surface as not supported for runs.
1. **Render the files.** In a client workspace, `npx @testagentic/atf init` and then `npx atf sync` (or just `npm install`). In this repository, `npm run build-agents`. That writes:
   - `.agents/agents/<name>.md`, one per agent. Only the entry agents are main agents; the rest are subagents;
   - `.agents/mcp_config.json`, the MCP servers from `config/mcp.yaml`. In a client workspace it is git-ignored with the agents;
   - the `atf-guard` set of `.agents/hooks.json`. The file is shared: the build owns only that set, renders it first and keeps your own sets. It is not git-ignored, so you decide whether to commit it. A malformed file is an error, and sync writes nothing.
2. **Trust the workspace** when Antigravity asks, so it loads the hooks and the MCP servers. Without the hooks, the guard check stops every run.
3. **Choose Claude Opus 5.5 in the model picker** before you start. The generated agents have `model: inherit` and run the session's model (D-100).
4. **Permission preset.** Keep a preset that still runs the hooks and shows you an `ask`; the spike records which presets do. Don't run with `agy --dangerously-skip-permissions` until the spike shows the guard still blocks under it.
5. **Start the run.** `npx atf run <product> --host antigravity` opens `agy --agent orchestrator-agent` (flag unverified). In the App or the IDE, pick **orchestrator-agent** and give it `config/<product>.yaml`.
6. **The live browser is the Playwright MCP server** from `.agents/mcp_config.json`, Playwright's own Chromium (D-070). Never use Antigravity's built-in browser: it drives your own Chrome, outside the init page's readonly guard (D-076). The guard denies its tools, and every other unmapped tool, during any run (D-101).
7. **The guard can't tell which agent is calling** yet, so a full-run gets the run's combined ceiling (D-035). Agents' commands run in Antigravity's sandbox (`commandExecutionPolicy: sandbox`) unless their permissions reach the live target (browser, HTTP or load) or their shell allow-list runs a command that needs the network (`npm`, `npx`, `playwright`, `k6`, `foundation.mjs install`). pw-repo-owner, for example, is `auto` for its installs.

### Codex: CLI, app and IDE extension (D-115, D-116)
Built from Codex's documentation; not yet verified live. Until the spike ([Verifying Codex](#verifying-codex)) has run on your surface, treat that surface as not supported for runs.
1. **Render the files.** In a client workspace, `npx @testagentic/atf init` and then `npx atf sync` (or just `npm install`). In this repository, `npm run build-agents`. That writes:
   - `.codex/agents/<name>.toml`, one per agent, with the session's model (no `model` key) and no per-agent tools, sandbox or MCP servers: Codex has none, so the guard alone enforces each agent's permissions. An agent whose permissions give it no shell also gets `[features] shell_tool = false`. In a client workspace these files are git-ignored;
   - `.codex/config.toml`: the atf block (between `# >>> atf` and `# <<< atf <<<` markers) holds the Playwright MCP server from `config/mcp.yaml`, `agents.max_depth = 3` (main session, orchestrator-agent, domain orchestrators, workers) and `web_search = "disabled"` (key unverified). Your own settings before and after the block are kept byte for byte; one the block would clash with (a `web_search` key, an `[agents]` table, an `[mcp_servers.<one atf renders>]`) is an error naming the file, and nothing is written. The file is shared and not git-ignored, so you decide whether to commit it;
   - the framework's entries in `.codex/hooks.json`: the guard (`--host codex`) on every tool call. The file is shared: the build owns only its own entries and keeps yours. It is not git-ignored. A malformed file is an error, and sync writes nothing.
2. **Trust the project** in Codex and **review its hooks with `/hooks`**, so Codex loads `.codex/config.toml` and runs the guard. Without that, the guard check stops every run before its first stage (D-037).
3. **Start the run.** `npx atf run <product> --host codex` opens `codex "<prompt>"`. Codex has no `--agent` flag, so the prompt tells it to spawn **orchestrator-agent** and hand it the run:
   ```
   Spawn the orchestrator-agent subagent and give it this task word for word, then relay its questions to me and my answers to it: <the run's usual prompt>
   ```
   In the Codex app or the IDE extension, open the project and paste the same prompt, with the run-config path (`config/<product>.yaml`) as its task. The VS Code extension's `atf.host` setting also offers `codex`.
4. **The live browser is the Playwright MCP server** from `.codex/config.toml`, Playwright's own Chromium (D-070). Hosted web search is off because the guard can't see it (D-116), so on Codex agents have no web search. Computer use and every other unmapped tool are denied during any run, readonly included (D-101).
5. **The guard can't tell which agent is calling** (the payload doesn't name it), so a full-run gets the run's combined ceiling (D-035).
6. **Confirmations become denials.** Codex hooks can't ask, so an `ask` decision (an edit to a decision-governed file, for example) is a deny whose reason says a human must make the edit.
7. **The session's directory counts for relative names.** The guard judges the call in the workspace that holds the hook payload's `cwd` (the folder with `atf/atf.json` at or above it), and judges a write's or a shell command's relative names both from the workspace root and from that `cwd` (and a shell's `workdir`), since Codex resolves them there: a session started in `atf/` that patches `atf.json` is judged as writing `atf/atf.json`. Start Codex from the workspace root anyway: whether the hook's relative command still runs from a subfolder is unverified.

## When the guard check fails

The guard check is a command the guard always blocks (D-037). The block is the test: it proves the host runs the guard and obeys its denies. Its message reads "Guard check passed: this block is the test …". Claude Code still labels it "hook error", which is Claude Code's own label. The orchestrator then says "Guard active on <host> ✓" (D-120).

No tool call may write, move or delete the check's records in `artifacts/<product>/state/guard-check/`, or run a hook script under `scripts/hooks/` by hand. The guard refuses both for every caller (D-120).

`run.mjs stage … start` refuses until the session's guard is verified (D-024).
- **"the guard did not intercept guard-check"**: hooks are not running in this session.
  - VS Code: trust the workspace, keep `chat.useHooks` on, keep `.vscode/settings.json` as committed.
  - Claude Code: check `.claude/settings.json`.
  - Antigravity: trust the workspace, check that `.agents/hooks.json` has the `atf-guard` set enabled (`npx atf sync` restores it), and record what you saw for the spike (D-099).
  - Codex: trust the project and review its hooks with `/hooks`; check that `.codex/hooks.json` has the guard entry (`npx atf sync` restores it), and record what you saw for the spike (D-115).
  - If the hook ran but didn't block (VS Code's Hooks log shows the guard's deny as `NonBlockingError`), the host didn't receive a block it honours. On VS Code, `scripts/hooks/hosts/index.mjs` must map `vscode` to `vscode.mjs` (D-040). If VS Code also ignores a deny decision on exit 0, its hooks don't enforce in that build: update VS Code, or run the pipeline on Claude Code.
  - Then run `run.mjs guard-check <product>` again.
- **"full-run on VS Code's local agent needs the custom agents' own hooks"**: the guard check was blocked, but not by an agent's own hook. There, an unidentified call counts as your own session and gets no per-agent limits (D-037).
  - Start the run from **orchestrator-agent** in the agent picker, keep `chat.useHooks` on, then run the guard check again. Or switch the run-config to `readonly`.
  - The host that blocked the check is in `artifacts/<product>/state/guard-check/`. In VS Code, a `vscode-agent-host--…` or `copilot-cli--…` record means the chat ran on the Copilot CLI engine, where the combined ceiling applies.
- **"unmapped tool …"** (during a run): the host has a tool the adapter doesn't know. Add it to `scripts/hooks/hosts/<adapter>.mjs` with a test, then retry.

## When the dependency check fails

`run.mjs stage … start` refuses a stage whose needs are missing on this machine (D-064), with each failing check and its fix. `npx atf run <product>` checks this before the session opens, applies the safe installs one progress line at a time, and offers the login (D-121; `--no-preflight` skips it). Inside a session, run `npx atf doctor <product>` in your terminal: it applies the safe installs (`npm install`, the Playwright browser builds) and lists the rest. Then the orchestrator runs `run.mjs doctor <product>` again. `node scripts/doctor.mjs --machine` (no product) checks what this machine needs for any product: Node.js, the framework's dependencies, the login browser, the browser server's browser and k6; a missing k6 only warns, and `--fix` does not install it (D-110). `--json` marks each check `fixable` when `--fix` could install it.
- **The browser server's init page** (`--init-page scripts/browser/init-page.cjs` in `config/mcp.yaml`, D-076) must be there, with no `--storage-state`: it loads the active run's `session_state_file` into every new browser and aborts every write to the product in a readonly run. After a change to `config/mcp.yaml`, run `npm run build-agents` and start a new session: the MCP server reads its arguments at start-up.
- **A Playwright browser build is not downloaded**: a Playwright update without its browser. `atf doctor` installs it.
- **The saved session is missing, empty or expired**: `npx atf login <product>`, or let the orchestrator open the login window (it asks first). Your default browser opens on the target with its own profile, when it is Chromium-based (Chrome, Edge, Brave, Arc, Vivaldi); otherwise Microsoft Edge, then Google Chrome. Sign in yourself; the window closes by itself once you are signed in, within 5 minutes (D-069, D-118).
- **The target does not answer**: the check names the cause (D-117).
  - **Claude Code's sandbox refused the host:** allow it with `/sandbox`, or turn the sandbox off for a live run. Installs can't run inside the sandbox either; the doctor warns about it (`sandbox`).
  - **A network proxy (HTTPS_PROXY) refused it:** ask your network team, or add the host to NO_PROXY.
  - **A proxy is set that this Node.js can't use:** use Node.js 24.
  - **Otherwise the host itself:** check the URL, your network or VPN. A session with no cookie on the target's host (usual after a single sign-on login) is only a warning.
- **A stage meets a sign-in page right after a successful login**: the browser server still has a browser open with the old session. Start a new agent session and resume the run.
- **k6 is not installed**: `atf doctor` installs it with winget (Windows) or Homebrew (macOS); on Linux, follow the link it prints. Then open a new terminal, since an install updates PATH for new terminals only. `doctor.mjs --machine` only warns about it.

## Verified facts (2026-10-11)

From GitHub's and VS Code's documentation:
- **VS Code agent files.** VS Code reads both `.github/agents/*.agent.md` and `.claude/agents/*.md`. Custom agents support `agents` (subagent allow-list, needs the `agent` tool), `user-invocable`, `disable-model-invocation`, `model` and `hooks` (Preview, Local harness, only while that agent is active).
- **VS Code nesting.** Nested subagents need `chat.subagents.allowInvocationsFromSubagents` (max depth 5). Local subagents have no ask-question tool.
- **Copilot tool aliases.** GitHub custom agents accept the aliases `read`, `edit`, `search`, `execute`, `web`, `agent` and `server/tool` MCP names, and ignore unknown tools. The prompt limit is 30,000 characters.
- **Copilot hook files.** Copilot CLI reads `.github/hooks/*.json` and also `.claude/settings.json`; the cloud agent reads only `.github/hooks/*.json`.
  - VS Code's Copilot CLI engine does the same: it labels `.claude/settings.json` "repo settings" and ignores `chat.useClaudeHooks`. On Windows it runs those commands through PowerShell. The generated Claude command therefore avoids bash-only syntax: `${CLAUDE_PROJECT_DIR:-.}` crashed there, and every matched call was "Denied by preToolUse hook from "repo settings" (hook errored)".
  - Windows PowerShell 5.1 prefixes a BOM when it relays a hook's stdin; the hook entries strip it.
- **Copilot hook payloads.** PascalCase `PreToolUse` sends snake_case fields with Claude tool names. There is no calling-agent field.
- **Copilot CLI and cloud agent hook outcomes.** Exit 2, or any non-zero exit from a pre-tool hook, denies the call. A timeout fails open. On the cloud agent, `ask` counts as deny.
- **VS Code hook outcomes.** These differ from the CLI's:
  - exit 0: VS Code parses stdout, and a `hookSpecificOutput.permissionDecision` of `deny` blocks the call;
  - exit 2: blocks, with stderr as the reason;
  - any other exit: a non-blocking warning (`NonBlockingError` in VS Code's Hooks log), and the call runs.

  So the VS Code adapter always denies with a decision on stdout and exit 0 (D-040).

Seen live in VS Code 1.141 (2026-10-11), on a chat that ran on the Copilot CLI engine:
- **The engine.** VS Code's `agenthost.log` showed session type `agent-host-copilotcli`, the bundled `copilot-sdk` runtime, and `GITHUB_COPILOT_INTEGRATION_ID=vscode-chat` set for it. The agent's terminal does not have that variable.
- **Its files.** It used the generated `.github/agents/` file (its tool aliases) and `.github/hooks/framework-guard.json`. Neither `.vscode/hooks/` nor the agent's own hook ran.
- **Its tools.** The CLI's tool names appeared: `bash`, `view`, `rg`, `read_bash`, `ask_user`, and `task` with the subagent name in `agent_type`. These come from the session records in `~/.copilot/session-state/`.
- **Its model.** The model was `auto`, which resolved to `gpt-6-luna`, the only model offered. The agent's `model:` line was not applied.

Seen live in VS Code (2026-10-12), on the local agent on Windows:
- **Both registrations ran.** `.vscode/hooks/` (record `vscode--unidentified`) and orchestrator-agent's own hook (record `vscode--orchestrator-agent`) both judged `run_in_terminal` calls.
- **Exit 2 did not block.** VS Code's Hooks log showed every guard deny as `NonBlockingError`, and the tool ran anyway.
  - VS Code's hook executor runs a hook through `powershell.exe -Command` when `ComSpec` is `cmd.exe`. PowerShell turns a native exit 2 into 1.
  - The guard check caught it: `run.mjs` recorded `absent`, and no stage started.
  - Since D-040, the VS Code adapter denies with exit 0 and a decision on stdout.

Not yet verified on a live session. Each has a fail-safe default, and a mismatch shows up as a denied call or a refused full-run, never as a silent bypass:
- Whether the hook process receives `GITHUB_COPILOT_INTEGRATION_ID` on the Copilot CLI engine. If it doesn't, that engine is labelled "Copilot CLI", which has the same limits. The next guard check there shows which: the record is named `vscode-agent-host--…` or `copilot-cli--…`.
- VS Code's exact tool names and argument fields (`scripts/hooks/hosts/copilot.mjs`), and whether `chat.hookFilesLocations` and `chat.agentFilesLocations` behave as configured.
- Whether a custom agent's own hook runs, with its `--agent`, when that agent runs **as a subagent**. If it doesn't, VS Code full-run is refused by the guard check.
- Whether Copilot CLI supports three levels of custom-agent subagents. If it doesn't, start the domain orchestrators one by one.
- Whether Copilot accepts `gpt-6-luna` as the agents' `model:` name (`config/models.yaml`, D-034). An unknown name falls back to the surface's default model.

To verify, register a temporary audit hook that appends each payload to a git-ignored file, run one agent per host, and turn the captured payloads into fixtures for `scripts/hooks.test.mjs`.

## Verifying Antigravity

Nothing about Antigravity has been seen live yet: every value the code marks `UNVERIFIED (Antigravity spike pending, docs/antigravity-spike/)` comes from antigravity.google/docs (read 2026-10-27). The spike kit in the framework repository's [`docs/antigravity-spike/README.md`](../../../docs/antigravity-spike/README.md) settles them, on the App, the CLI and the IDE:
- the tool names and argument keys, including how a Playwright MCP tool is named;
- whether workspace hooks fire inside subagents at every level, and whether an agent's own frontmatter hook runs only for that agent. If it does, the guard can name the caller and the combined ceiling is no longer needed;
- which deny form Antigravity honours, and under which permission presets;
- the hook's environment, working directory and shell, the agent-file keys, the body limit, whether the sandbox blocks network, and the `agy` flags;
- how two hook sets in `.agents/hooks.json` combine (their order, and whether a client set's allow can override the guard's deny), where `run_command` runs relative to its `Cwd`, and how `workspacePaths` lists a multi-root window.

Its findings table names the repo value each finding updates. A surface where a deny isn't honoured, or where subagent calls skip the hooks, is listed here as not supported for runs. Until then, the fail-safe defaults hold for what the kit checks: a hook that doesn't run, or a deny that isn't honoured, shows up as a refused guard check (D-037). Argument keys the adapter doesn't know fail closed during a run: a write with no target it can read, or a `run_command` with no command line it can read, is refused. One gap stays open until the spike: a payload the hook can't parse loses its `workspacePaths`, so the hook judges its own working directory, and fails open if that is not the workspace (the registration's command is relative to the workspace, so a hook started elsewhere doesn't run at all, and the guard check then stops the run).

## Verifying Codex

Nothing about Codex has been seen live yet: every value the code marks `UNVERIFIED (Codex spike pending, docs/codex-spike/)` comes from Codex's documentation (read 2026-11-01). The spike kit in the framework repository's [`docs/codex-spike/README.md`](../../../docs/codex-spike/README.md) settles them, on the CLI, the app and the IDE extension:
- whether the hook runs, and from which directory;
- whether a deny is honoured, as stdout JSON at exit 0 and as exit 2;
- the tool names and argument keys for the shell, `apply_patch`, MCP tools, `spawn_agent` (which key names the agent) and `view_image`;
- whether subagents' tool calls reach the hook, and whether any field names the calling subagent. If one does, the guard can name the caller and the combined ceiling is no longer needed;
- whether nesting to depth 3 works with `agents.max_depth = 3`;
- whether `web_search = "disabled"` turns hosted web search off;
- whether the three surfaces behave the same.

Until then, the fail-safe defaults hold: a hook that doesn't run, or a deny that isn't honoured, shows up as a refused guard check (D-037), and an unmapped tool is denied. A surface where a deny isn't honoured, or where subagent calls skip the hooks, is listed here as not supported for runs.
