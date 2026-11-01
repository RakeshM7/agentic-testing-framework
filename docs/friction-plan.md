# Friction removal plan (0.1.7)

Goal: a first run, the kind a client's CTO would watch, goes from `npx atf run <product>` to its first stage with no
stalls. The sources are an audit of 7 real sessions in test-run-1, 2 and 3 (2026-11-01). None of them got past setup.

The user's choices (2026-11-01):
- **Old Node:** auto-pin a Node ≥ 20.
- **Preflight:** `atf run` runs it automatically.
- **Guard check:** a silent liveness check.
- **Login:** use the default browser, and close when signed in.

Branch `fix/doctor-sandbox`. Commit only when the user asks.

## Done

All the work items are built: W1 → D-123 (its pin record went to `atf/machine.json`, not `atf/atf.json` as K2 says below), W2 → D-121, W3 → D-120 (revised), W4 → D-118, W5 → D-122, W6 → D-119.

- **D-117:** `lib/net.mjs` `netFetch`. The framework's own requests go through HTTPS_PROXY (the sandbox and corporate proxies). The doctor names a sandbox or proxy refusal, and adds a `sandbox` warning.

## Rules for every work item

- Before you change a file: `node packages/core/scripts/decisions.mjs for <files> --full`. If a change would weaken or contradict a recorded decision, stop and report it. Never loosen the guard (AGENTS.md).
- Use the **Edit and Write tools only** on repo files. Never python, sed or shell redirection: the decisions hook must see every edit.
- Never edit generated files (`.claude/`, `.github/agents`, `.agents/`, `.codex/`). Change `packages/core/agents/*.md`, then run `npm run build-agents`.
- Every code change gets a test. Before you report: `npm run check` (from the repo root) must pass. Other work items run at the same time in the same tree. If a failure is in a file you didn't touch, re-run once and report it rather than fix it.
- A new script file also needs its entry in `atf/permissions.yaml` (framework-implementor-agent's writable list; guard.test enforces it).
- Don't write `docs/decisions.md`. Report the decision text you propose (Decision / Why / Known limits / Affects) and the main session records it.
- Don't commit.
- Report: the files changed, the tests added, the `npm run check` result, the proposed decision text, and anything left open.

## Contracts (shared between work items)

**K1 `findNode` (W1 owns it, W2 uses it).** `scripts/lib/node-version.mjs` exports:
- `findNode({ min = MIN_NODE, env, platform, home, exists, probe }) -> { path, version, source } | null`
- It returns the newest Node ≥ min. Candidates come in order:
  - the current process (`process.execPath`), if it is new enough;
  - PATH;
  - nvm (`$NVM_DIR` or `~/.nvm/versions/node/*/bin/node`);
  - fnm;
  - volta;
  - asdf;
  - Homebrew (`/opt/homebrew/opt/node@*/bin/node`, `/opt/homebrew/bin/node`, `/usr/local/opt/node@*/bin/node`);
  - `/usr/local/bin/node`;
  - on Windows, `%ProgramFiles%\nodejs\node.exe` and nvm-windows.
- `probe(path) -> version | null` runs `<path> --version`.
- It is pure apart from the injected calls.

**K2 the pin (W1).** For an installed framework, `atf sync` writes the Node it found as an absolute path into the git-ignored host files it renders (D-089):
- the hook commands;
- the MCP server commands (`npx …` becomes that Node's sibling `npx`, with that Node's bin directory first in the server's PATH env).

Rules:
- Only when the PATH's `node` is older than `MIN_NODE`. Otherwise nothing changes (the command stays plain `node`).
- Never in this source repo's committed generated files.
- It is recorded in `atf/atf.json` as `"node": {"path", "version", "pinnedAt"}`, a machine-local value, and sync re-checks it every time.
- The doctor's `node` check reports the pinned Node.

## Work items

### W1 Auto-pin a Node ≥ 20 (higher effort)

Five of seven sessions died because Homebrew's node@18 came first in PATH. The guard refused every call (D-109) and the Playwright MCP server crashed.

To build:
- **K1 and K2.**
- **`bin/atf.mjs`:** started on a Node older than 20 (`npx atf …`), it re-runs itself under `findNode()`. It prints one line: "Using Node.js 24.x (nvm); your default node is 18.x". Only when nothing is found, one error line with the exact install command (`nvm install 24` or `brew install node@24`).
- **The VS Code `atf.nodePath`** (packages/vscode/src/node-env.js) stays as it is. The extension's pin takes precedence when set.

Files: `scripts/lib/node-version.mjs`, `bin/atf.mjs`, `scripts/lib/sync.mjs`, `scripts/lib/hook-registrations.mjs`, `scripts/lib/mcp.mjs` (the MCP renderers), `scripts/lib/doctor.mjs` (the `node` check in `deps()` only). Tests sit beside them.

### W2 Automatic preflight in `atf run` (after W1)

`atf run <product>` (and `resume` and `automate`, wherever `scripts/lib/cli.mjs` plans an agent session) runs these steps in the human's terminal, before the session starts:
1. Node (W1's re-exec).
2. `doctor` for the run-config's chosen steps (`scripts/doctor.mjs scope`).
3. Each `autofix` as one progress line: "Installing the Playwright repo for eventhub… done". This covers npm install in the Playwright project, the browsers, k6 through the OS package manager, and the **MCP browser server's Chromium build** (give the `mcp-browser` check an autofix if it has none).
4. A summary of what is left. For a `session` failure, it offers the login right there (`atf login <p>`, Y/n).
5. Then it opens the session.

Rules:
- A check that still fails is shown once, as one line with its fix. The session opens anyway when only some stages are blocked, and the orchestrator then skips them.
- Never inside a sandbox (`SANDBOX_RUNTIME=1`): just report.
- `--no-preflight` skips all of it.

Files: `scripts/lib/cli.mjs`, `scripts/doctor.mjs`, `scripts/lib/doctor.mjs` (autofix entries only), and the tests.

### W3 Guard check: kept as a deny, made calm (revised 2026-11-01)

> **Revised.** A silent canary would no longer prove that the host obeys a deny (D-037, and the D-040 incident). It is also the only fail-safe on Antigravity and Codex. The user chose to:
> - **Keep the deny.** On Claude Code, send it as a structured JSON deny, and only if every deny on that host can move to the same path.
> - **Show one line** to the human: "Guard active on <host> ✓".
> - **Tighten the guard:** no tool call may write `state/guard-check/` or run `scripts/hooks/*.mjs` directly, for any caller or mode.
>
> The text below is the original design, which is not built.

#### Original design (superseded)

Today the canary is a blocked Bash call. It shows up as a red "PreToolUse:Bash hook error … Blocked by the framework guard (canary)", twice per session.

The new design:
- The hook **allows** the canary command and, in the same call, writes a one-time proof that the agent can't forge:
  - the nonce the command carries;
  - the host and the caller;
  - written to the place `guard-check.mjs` reads today.
- `run.mjs guard-check` then verifies the proof and prints "guard active on <host>".
- A canary that executes **without** a hook proof means the hook is not running. That is still the failure it is today.

What stays exactly the same:
- **The proof's tamper resistance.** Find how today's design prevents an agent from writing the record itself, and keep it at least as strong.
- **What the guard allows for every other call.**
- **The fail-closed behaviour on every host:** Claude Code, Copilot, VS Code, Antigravity and Codex adapters. Check each adapter's output for an allow.

Update `packages/core/agents/orchestrator-agent.md` where it describes the guard check (that section only), then run build-agents.

Files: `scripts/lib/guard.mjs` (the canary rule), `scripts/lib/guard-check.mjs`, `scripts/run.mjs` (the guard-check command), `scripts/hooks/pretooluse.mjs` and `hosts/*.mjs` if the allow path needs them, the tests, and the orchestrator-agent guard-check paragraph.

### W4 Login: the default browser, closing when signed in

Today: Edge only, then Chrome, on a 60 s or 120 s timer, and the orchestrator asks which timer.

The new behaviour:
- **Browser:** the OS default browser when it is Chromium-based (Chrome, Edge, Brave, Arc, Vivaldi, Chromium). Otherwise Edge, then Chrome, then Playwright's Chromium.
  - macOS: read the LaunchServices https handler (`defaults read com.apple.LaunchServices/com.apple.launchservices.secure LSHandlers`).
  - Windows: `HKCU\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice` ProgId.
  - Linux: `xdg-settings get default-web-browser`.
  - The detection is injectable and tested.
- **Closing:** the window closes by itself once the target's session is saved. That means a new or changed cookie for the target's host (or the run-config's login host), stable for about 3 s and after at least one navigation away from the login page. The ceiling is 5 minutes, which replaces the 60 s or 120 s choice. The human can also close the window themselves, and what was captured so far is saved.
- **The prompts:** update the orchestrator agent's Login section and the doctor's `login` check wording. The orchestrator no longer asks about a timer, only "Open the login window? (Y)".

Files: `scripts/lib/login.mjs`, `scripts/lib/doctor.mjs` (the `login()` check and `loginChannel` only), the orchestrator-agent Login section, and the tests.

### W5 The orchestrator conversation (after W3 and W4; sonnet, medium)

Changes, in `packages/core/agents/orchestrator-agent.md` and the run-config draft script (`scripts/lib/run-config-draft.mjs`, `scripts/run-config.mjs`):
- **The interview:**
  - one question at a time, each with a proposed default the human accepts with Enter;
  - the product name is derived from the URL host, and whether the site is public is inferred;
  - never a seven-point wall of questions.
- **Modules:** a comma-separated or "and"-joined module answer is split into modules. `run-config validate` warns about a slug longer than 40 characters, and about a nav_path entry that holds a comma.
- **Steps:** never ask for the run's steps when the run-config already sets them. Show them in the summary instead. One summary confirmation per session.
- **One shell command per tool call**, never `;` or `| head` chains. Restricted shells refuse those, and the scripts' JSON is already short.
- **Short messages to the human:** at most about 5 lines, with the exact command to run, and no histories of failed attempts.
- **The sandbox:** when the doctor reports the `sandbox` warning, say it once, up front: "This session is sandboxed: turn it off with /sandbox for a live run."
- **The doctor's `session` warning when there is no target cookie** (normal after single sign-on): reword it so it doesn't read as a failure (`scripts/lib/doctor.mjs` `session()` wording only).

### W6 Framework issues before a run exists (haiku, medium)

`scripts/framework-issues.mjs add` fails with "no active run for product 'eventhub'" when no run exists yet. Make it store the issue under the workspace (`artifacts/<product>/framework-issues/` or wherever export reads, so that `atf issues export` still finds it), with a test.

## Order

- **First, in parallel:** W1, W3, W4, W6.
- **Then:** W2 (needs K1) and W5 (touches the orchestrator agent after W3 and W4).
- **Last, the main session:**
  - the decisions D-118 onward;
  - the docs (platforms.md, conventions, README and the extension CHANGELOG);
  - `npm run check`;
  - release 0.1.7.

## Not in scope (noted)

- The product's Playwright tests and k6 behind a corporate proxy (they have their own proxy settings).
- Allowing `;` and pipe chains in restricted shells: that is a guard change, so W5 makes agents not need them instead.
