# The atf VS Code extension: shared spec (phase 7, P-12)

The extension is a UI over the `atf` CLI and the artifact contract. It is **not** part of safety (P-12, D-020): it never registers, replaces or bypasses the hooks. It writes artifacts only through the framework's scripts, or as a human edit to a file a human may edit. It is published publicly to the VS Code Marketplace and Open VSX (user, 2026-10-27). It holds no IP: without the licensed `@testagentic/atf` package installed in the workspace, it does nothing.

**Everything happens inside VS Code** (user, 2026-10-29): no plain terminal hand-offs. Commands that ask nothing run in the background, human-only commands are confirmed in the extension's own dialog, and the only terminal is an agent session's, shown as a tab in the editor area.

## Layout (`packages/vscode/`)

| Path | Owner | What |
|---|---|---|
| `package.json` | Basil | the extension manifest (all contributions below), scripts, devDependencies |
| `src/extension.js` | Basil | `activate`/`deactivate`; wires the modules below |
| `src/workspace.js` | Basil | finds the atf workspace (`atf/atf.json`) and the installed framework (`node_modules/@testagentic/atf`); the artifact paths, the confirmation files' paths among them |
| `src/cli.js` | Basil | runs atf: `runJson(args)` (child process, parsed JSON or a clear error); `runStreaming(args, { onLine, token, script })` (child process, its lines streamed to the `atf` channel, cancellable, the exit code the answer); `confirmedRun(action, target, { typed })` (a human-only command through its one-time confirmation file, below); `cliPlan(argv)` (what the installed CLI would run, run nothing); `runInTerminal(args, { name, location })` (agent sessions only) |
| `src/runs.js` | Basil | the run tree's view model and TreeDataProvider |
| `src/sheets/*.js` | Poppy | the clarifications and approval sheet editors, and the approve action; exports `registerSheets(context, deps)` |
| `src/report.js` | Ivy | the report webview; exports `registerReport(context, deps)` |
| `test/*.test.mjs` | each owner | node:test over the pure modules; no `vscode` import (inject it) |
| `test/smoke/` | Ivy | an optional `@vscode/test-electron` smoke test, skipped without VS Code |
| `scripts/` | Ivy | the build (esbuild → `dist/extension.js`, CommonJS, `vscode` external) and the packaging (vsce) |

`deps` passed to `registerSheets` and `registerReport`: `{ vscode, workspace, cli, output }`. Here `workspace` is the object from `src/workspace.js`, `cli` the object from `src/cli.js`, and `output` a VS Code OutputChannel named `atf`.

## Contributions (in `package.json`, written by Basil)
- **Activation:** `workspaceContains:atf/atf.json`.
- **View container `atf`** (activity bar, title "atf"), with these views:
  - `atf.runs`: "Runs" (Basil);
  - `atf.clarifications`: "Clarifications" (Poppy; a tree of products, modules and open rows);
  - `atf.approvals`: "Test case approval" (Poppy; a tree of products, modules and pending cases).
- **Setting `atf.host`:** `claude` (the default), `copilot-chat` or `copilot-cli`: where an agent session opens (below). The earlier value `copilot` is read as `copilot-cli`, and rewritten to it where it is set.
- **Setting `atf.nodePath`:** the Node.js the scripts run with (empty: `node` on the PATH).

**Commands** (category "atf"):

| Id | Title | Owner | Runs |
|---|---|---|---|
| `atf.refresh` | Refresh | Basil | refreshes every view |
| `atf.init` | Create workspace (init) | Basil | `atf init` in the background, in the folder, on the framework installed there |
| `atf.sync` | Sync host files | Basil | `atf sync` in the background |
| `atf.check` | Check host files | Basil | `atf check` in the background; a failure offers **Sync now** |
| `atf.doctor` | Doctor | Basil | the CLI's doctor step for `atf doctor <product>` (from its plan) with `--json`, in the background; the checks are listed one per line with their status and fix |
| `atf.validate` | Validate config | Basil | `atf validate <product>` in the background |
| `atf.sweep` | Sweep leftovers… | Basil | the sweep's dry run, then, when something would be deleted, the typed-slug dialog and `ledger.mjs sweep --confirm-file` (below) |
| `atf.run` | Start or continue a run | Basil | an agent session for `atf run <product>` (below) |
| `atf.resume` | Resume a stage | Basil | an agent session for `atf resume <product> --stage <s> [--module <m>]` |
| `atf.newProduct` | New product… | Basil | asks how: **Set it up myself** runs `atf config <product> --url <url> [--no-login]` in the background, behind a cancellable progress notification; **Let the orchestrator interview me** opens an agent session for `atf interview` |
| `atf.openConfig` | Open config | Basil | opens a product's (or environment's) `config/<file>.yaml`, asked among them when there are several |
| `atf.openClarifications` | Open clarifications | Poppy | opens the clarifications editor for a product or module |
| `atf.openApproval` | Open approval sheet | Poppy | opens the approval editor for a module |
| `atf.approveModule` | Approve module… | Poppy | the typed-slug dialog, then `testcases.mjs approve <product> <module> --confirm-file` (below) |
| `atf.openReport` | Open report | Ivy | the report webview for a run; a run collected but never rendered is rendered in the background (`report.mjs render`) on request |

**Menus.** The Runs view's title has **New product…** (`$(add)`, first) and **Start or continue a run**. Those two, **Open config**, **Validate config** and **Sweep leftovers…** are in the Command Palette only when `atf.active`. A product or environment item (`atf.product`, `atf.environment`) has, on right-click, **Start or continue a run**, **Doctor**, **Resume a stage**, **Validate config**, **Open config** and **Sweep leftovers…**, plus the inline ▷ (run). Every command a menu runs takes the tree node as its argument (its `product`, `environment`, `stage`, `module`) and asks only for what the node lacks. The Runs view's welcome content for a workspace with no product (`atf.workspaceState == ok`, empty tree) has a **New product…** button and a **Let the orchestrator interview me** link (`command:atf.newProduct?["interview"]`).

## Rules
- **No new runtime behaviour in the framework.** The extension only calls `atf` commands and the framework's scripts, and reads artifacts. A script that lacks what the extension needs, for example a `--json` output, is reported, not added by the extension agents.
- **Background commands.** init, sync, check, doctor, validate, `atf config` and the report's render ask nothing, so they run inside the extension (`runStreaming`): a child process with an argument array and no shell, `ATF_ENV` set by the command itself (never inherited), its output in the `atf` channel, under a cancellable notification showing its latest line. A cancel kills the process tree. Then a result message: what it did, or why it failed (the script's own errors) with **Show output**. None of them prompts: the doctor's `--fix` installs (npm, Playwright's browser, k6 through winget or Homebrew) and init's `npm install` run with no input. A k6 the doctor just installed may need VS Code restarted before its PATH sees it.
- **Human-only commands** (approve, sweep, `import --approved`, eject, migrate, issues) never run silently. `runJson` and `runStreaming` refuse them before spawning anything, unless the command carries `--confirm-file` naming a file `confirmedRun` itself just wrote for exactly that command, and the file still exists. The extension offers two of them:
  - **Approve module…** (`src/sheets/commands.js`):
    1. A modal summary of the module's saved `approval.csv`: its yes, no and changes decisions, and its blank rows. Unsaved edits in the approval editor must be saved first, or approve records the saved sheet without them.
    2. An input box: "Type the module slug `<m>` to record these decisions". It is validated as typed, and only an exact match enables OK.
    3. `confirmedRun("approve", …)` writes `testcases/approval-confirm.json` and runs `testcases.mjs approve <p> <m> --confirm-file <it>` with the `ATF_ENV` of the environment whose last run lists the module.
    4. The result (recorded, cleared, the new counts, or the script's refusal), then the approval view and the Runs tree are refreshed.
  - **Sweep leftovers…** (`src/activate.js`):
    1. The dry run (`ledger.mjs sweep <p> --dry-run`, a read) in the background. Its refusals (an active run, a readonly config, no run state) are shown as they are.
    2. A list of what would be deleted, and what must be cleaned up by hand. With nothing to delete, nothing more is asked.
    3. A choice: every ended run's leftovers, or one run's (`--run`).
    4. A modal warning: "this deletes live data in <hosts>".
    5. The product slug typed, exact.
    6. `confirmedRun("sweep", …)` writes `sweep-confirm.json` in the environment's state folder and runs `ledger.mjs sweep <p> [--run R] --confirm-file <it>` with that environment's `ATF_ENV`.
    7. The result: how many were deleted, failed, or are left by hand.

  The confirmation file is the framework's (`scripts/lib/confirm.mjs`): `{action, product, module (approve only), environment, typed, nonce, createdAt, expiresAt}`, at most 120 seconds valid, created exclusively (`wx`, owner-only), at the one path the framework reads for that action. The script deletes it before acting; the extension removes it afterwards in every case, a cancel or a script that stopped early included. A wrong or missing slug writes nothing and runs nothing. The guard still refuses these commands to every agent tool call, and refuses any tool call that writes a confirmation file or names one. The extension's processes are the human's, not tool calls. This weakens the TTY-only safety layer of approve and sweep, which the user accepted (2026-10-29).
- **Agent sessions** (run, resume, the interview) follow `atf.host`:
  - `claude` and `copilot-cli`: `npx --no atf <command> … [--host copilot]` in a VS Code terminal created with `location: TerminalLocation.Editor`, so it is a tab in the editor area, named for the session ("atf run acme", "atf run acme (uat)", "atf resume acme · explore"). The CLI keeps its own doctor pre-check and its own first prompt, and `ATF_AGENT` still overrides the agent command. Claude Code's panel can't pick the agent, so its CLI is the way to start the orchestrator-agent. The agent CLI is an interactive program the human types into: this is the only terminal the extension opens (`runInTerminal` refuses anything else).
  - `copilot-chat`:
    1. If VS Code Chat is missing (no `workbench.action.chat.open`), the extension says so and offers **Use Claude Code** or **Use Copilot CLI**, which also sets `atf.host`.
    2. Another environment than `default` is offered Copilot CLI instead: a chat session can't be given `ATF_ENV`.
    3. The extension asks the installed CLI for its plan (`cliPlan`: a child node imports `scripts/lib/cli.mjs` and prints `plan()`'s steps). It runs the plan's pre-steps, the doctor, in the background, and stops where the CLI would stop. Problems that block a stage are repeated in a warning.
    4. It opens VS Code Chat with the plan's own first prompt: `{ query, mode: "orchestrator-agent", isPartialQuery: true }`. The undocumented `mode` field is dropped if the command refuses it.
    5. An info message: "Choose orchestrator-agent in the chat's Agent dropdown, then press Enter."

    The prompt is never sent for the human, and never restated by the extension.
- **New product…** (user, 2026-10-29). Each step can be cancelled, and a cancel runs nothing:
  1. a pick: **Set it up myself** or **Let the orchestrator interview me** (the command's optional argument, `"config"` or `"interview"`, skips it);
  2. the product's name, checked as it is typed against what `atf config` refuses: a lowercase kebab-case slug with no `config/<product>.yaml` yet;
  3. the target URL, checked the same way (http or https, the CLI's own test);
  4. a pick: **Log in now** (the default; Microsoft Edge opens) or **No login needed** (`--no-login`).

  `atf config` runs in the background ("Creating config/<product>.yaml…", then "Waiting for you to sign in in Microsoft Edge…" while the login runs). Success shows **Open config** and **Start run**; a failure shows why, with **Show output**. The interview is an agent session, opened as `atf.run` opens one. The CLI checks every argument again; the extension's checks only say it sooner.
- **Text only:** the extension never shows or sends secret values (the credentials files, `.auth/`).
- **Platforms:** Windows, macOS and Linux. Use `path` and `vscode.Uri`, with no shell-string concatenation; arguments go to `cli.js` as arrays.
