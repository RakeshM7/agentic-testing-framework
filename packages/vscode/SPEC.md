# The atf VS Code extension: shared spec (phase 7, P-12)

The extension is a UI over the `atf` CLI and the artifact contract. It is **not** part of safety (P-12, D-020): it never registers, replaces or bypasses the hooks. It writes artifacts only through the framework's scripts, or as a human edit to a file a human may edit. It is published publicly to the VS Code Marketplace and Open VSX (user, 2026-10-27). It holds no IP: without the licensed `@testagentic/atf` package installed in the workspace, it does nothing but help create or open one (D-107).

**Everything happens inside VS Code** (user, 2026-10-29): no plain terminal hand-offs. Commands that ask nothing run in the background, human-only commands are confirmed in the extension's own dialog, and the only terminal is an agent session's, shown as a tab in the editor area.

**A Cockpit** (user, 2026-10-31, D-110, D-111): the sidebar's first view is one page, the pipeline cockpit: this machine's environment checks with their fixes, the products with Run, Doctor and Config, a New product form that drafts the run-config with no agent, and the pipeline (Needs you, the rail, the intents), with an editor tab for the run's timeline, traceability, failures and safety. No chat: it shows the pipeline and opens the same `atf` sessions a human would type. A run, resume or intent session starts only after its check.

**A project from inside VS Code** (user, 2026-10-31, D-107): a *project* is the workspace, the folder holding `atf/atf.json`. **Create new project…** sets one up and goes on to its first product, with no `npx … init`, no `~/.npmrc` and no shell variable: the extension asks once for the registry token and keeps it in VS Code's secret storage.

## Layout (`packages/vscode/`)

| Path | Owner | What |
|---|---|---|
| `package.json` | Basil | the extension manifest (all contributions below), scripts, devDependencies |
| `src/extension.js` | Basil | `activate`/`deactivate`; wires the modules below |
| `src/workspace.js` | Basil | finds the atf workspace (`atf/atf.json`) and the installed framework (`node_modules/@testagentic/atf`); the artifact paths, the confirmation files' paths among them |
| `src/cli.js` | Basil | runs atf: `runJson(args)` (child process, parsed JSON or a clear error); `runStreaming(args, { onLine, token, script })` (child process, its lines streamed to the `atf` channel, cancellable, the exit code the answer); `confirmedRun(action, target, { typed })` (a human-only command through its one-time confirmation file, below); `cliPlan(argv)` (what the installed CLI would run, run nothing); `runNpm(tool, args, { cwd, env })` (npm or npx itself: only the two commands below); `runInTerminal(args, { name, location })` (agent sessions only) |
| `src/project.js` | Basil | the project and the registry token (D-107): `createRegistry` (the token in secret storage), `createProjectFlows` (create, open, install, the pending New product…), `registryEnv` |
| `src/cockpit.js` | Basil | the Cockpit (D-110): `createEnvironment` (this machine's environment: the session's Node.js and the framework's machine check, shared with the check before a session), `registerCockpit` (the `atf.cockpit` webview view and its actions) |
| `src/cockpit-sidebar-page.js` | Basil | the panel's page (HTML, CSP, its script), `validatePanelMessage`, and `formAnswers` (the New product form as `run-config.mjs draft`'s answers) |
| `src/cockpit-actions.js` | Basil | the intents as `atf` argv (`intentArgv`) and the commands the check before a session covers (`GATED_COMMANDS`), pure (D-111) |
| `src/cockpit-panel.js` | Basil | the editor tab (D-111): `atf.openCockpit`, the `atf.cockpitPanel` webview panel, its data from `cockpit.mjs`, and the re-check of every message's target; opens no agent itself |
| `src/cockpit-panel-page.js` | Basil | the editor tab's page (HTML, CSP, its script), its tab list, `validatePanelPageMessage` and `validateTabMessage` |
| `src/cockpit-style.js` | Basil | the look shared by the sidebar and the tab: theme colours, the accent, high-contrast fallbacks |
| `src/cockpit-tabs/` | Basil | one renderer per tab of the editor tab: `timeline.js`, `trace.js`, `failures.js`, `safety.js` |
| `src/node-env.js` | Basil | the Node.js installs on the machine (`findNodes`), the one a new terminal finds (`terminalNode`), and the pin on an agent terminal's command line (`pinPrefix`) |
| `src/runs.js` | Basil | the Products view's (`atf.runs`) view model and TreeDataProvider |
| `src/sheets/*.js` | Poppy | the clarifications and approval sheet editors, and the approve action; exports `registerSheets(context, deps)` |
| `src/report.js` | Ivy | the report webview; exports `registerReport(context, deps)` |
| `test/*.test.mjs` | each owner | node:test over the pure modules; no `vscode` import (inject it) |
| `test/smoke/` | Ivy | an optional `@vscode/test-electron` smoke test, skipped without VS Code |
| `scripts/` | Ivy | the build (esbuild → `dist/extension.js`, CommonJS, `vscode` external) and the packaging (vsce) |

`deps` passed to `registerSheets` and `registerReport`: `{ vscode, workspace, cli, output }`. Here `workspace` is the object from `src/workspace.js`, `cli` the object from `src/cli.js`, and `output` a VS Code OutputChannel named `atf`.

## Contributions (in `package.json`, written by Basil)
- **Activation:** `workspaceContains:atf/atf.json`, and VS Code's own activation when one of its views is opened or one of its commands runs (so the welcome buttons work in a window with no project).
- **View container `atf`** (activity bar, title "ATF"), with these views:
  - `atf.cockpit`: "Cockpit" (Basil, D-110), a webview view, always shown, first;
  - `atf.runs`: "Products" (Basil; titled "Runs" before D-107, the id unchanged), collapsed by default since the Cockpit lists the products too;
  - `atf.clarifications`: "Clarifications" (Poppy; a tree of products, modules and open rows), collapsed by default, shown only when `atf.workspaceState == ok`;
  - `atf.approvals`: "Test case approval" (Poppy; a tree of products, modules and pending cases), collapsed by default, shown only when `atf.workspaceState == ok`.
- **Context keys** (set by the extension, read by the manifest):
  - `atf.workspaceState`: `noFolder`, `noWorkspace` (no folder holds `atf/atf.json`), `noFramework` (the project has no `@testagentic/atf` installed: a fresh clone, say), `badMarker` (`atf/atf.json` can't be read) or `ok`;
  - `atf.active`: the state is `ok`;
  - `atf.hasProducts`: the state is `ok` and the project has a run-config (a `config/*.{yaml,yml}` watcher detects it again);
  - `atf.registryConnected`: a registry token is known (stored, `ATF_NPM_TOKEN` in VS Code's own environment, or one in the user's npm config, D-112).
- **Welcome content** of the Products view, per state:
  - `noFolder`: "No atf project is open." with **Create new project…** and **Open existing project…**;
  - `noWorkspace`: "This folder isn't an atf project yet." with the same two buttons;
  - either of those while `!atf.registryConnected`: a line saying creating a project asks once for a GitHub token with `read:packages`, with **Connect now**;
  - `noFramework`: **Install the framework** and **Refresh**;
  - `badMarker`: **Refresh**;
  - `ok` with no product (empty tree): **New product…** and a **Let the orchestrator interview me** link (`command:atf.newProduct?["interview"]`).

  The tree sets no message of its own on top. At activation, a popup shows only where a button fixes the state: `noWorkspace` with the package installed in the folder (**Set up atf in this folder**), `noFramework` (**Install the framework**), `badMarker` (**Check again**).
- **Walkthrough `atf.getStarted`** ("Get started with atf"), each step's markdown in `media/walkthrough/` (shipped in the vsix):

  | Step | Its button | Done when |
  |---|---|---|
  | Connect to the package registry | `atf.connect` | `onContext:atf.registryConnected` |
  | Create or open a project | `atf.createProject`, `atf.openProject` | `onContext:atf.workspaceState == ok` |
  | Add a product | `atf.newProduct` | `onContext:atf.hasProducts` |
  | Choose where agents run (optional) | the `atf.host` setting | `onSettingChanged:atf.host`, or `onStepSelected` |
  | Start your first run | `atf.run` | `onCommand:atf.run` |

  The last step says runs are `readonly` by default, and `full-run` is only for a target the human is authorized to test.
- **Setting `atf.host`:** `claude` (the default), `copilot-chat`, `copilot-cli` or `codex`: where an agent session opens (below). The earlier value `copilot` is read as `copilot-cli`, and rewritten to it where it is set.
- **Setting `atf.nodePath`:** the Node.js atf runs on (empty: `node` on the PATH): the extension's own commands, and every agent session it opens, whose command line puts this Node's folder first on its `PATH` (D-110). The Cockpit's **Use Node …** sets it, in the user's settings.
- **Setting `atf.checkBeforeRun`** (default `true`): the product's dependency check before a run or resume session (below). The Node.js check runs either way.

**Commands** (category "atf"):

| Id | Title | Owner | Runs |
|---|---|---|---|
| `atf.refresh` | Refresh | Basil | refreshes every view |
| `atf.createProject` | Create new project… | Basil | the token if none is known, the folder, then `npx --yes @testagentic/atf@<the extension's version> init <folder>` in the background, then **New product…** (below) |
| `atf.openProject` | Open existing project… | Basil | a folder holding `atf/atf.json` (or inside one), opened in this window |
| `atf.connect` | Connect to the package registry… | Basil | asks for the registry token and stores it in secret storage |
| `atf.forgetToken` | Forget the registry token | Basil | deletes the stored token |
| `atf.installFramework` | Install the framework | Basil | `npm install` in the background, in a project in state `noFramework`, then `atf sync` |
| `atf.init` | Set up atf in this folder (init) | Basil | `atf init` in the background, in the folder, on the framework installed there; without one, offers **Create new project…** |
| `atf.sync` | Sync host files | Basil | `atf sync` in the background |
| `atf.check` | Check host files | Basil | `atf check` in the background; a failure offers **Sync now** |
| `atf.doctor` | Doctor | Basil | the CLI's doctor step for `atf doctor <product>` (from its plan) with `--json`, in the background; the checks are listed one per line with their status and fix |
| `atf.validate` | Validate config | Basil | `atf validate <product>` in the background |
| `atf.sweep` | Sweep leftovers… | Basil | the sweep's dry run, then, when something would be deleted, the typed-slug dialog and `ledger.mjs sweep --confirm-file` (below) |
| `atf.run` | Start or continue a run | Basil | an agent session for `atf run <product>` (below) |
| `atf.resume` | Resume a stage | Basil | an agent session for `atf resume <product> --stage <s> [--module <m>]` |
| `atf.newProduct` | New product… | Basil | asks how: **Fill in the form** shows the Cockpit's New product form (D-110); **Set it up myself** runs `atf config <product> --url <url> [--no-login]` in the background, behind a cancellable progress notification; **Let the orchestrator interview me** opens an agent session for `atf interview` |
| `atf.openCockpit` | Open Cockpit | Basil | the Cockpit's editor tab (below), one per window; icon `$(dashboard)`; in the palette when `atf.active`, and a title button on the Cockpit and Products views |
| `atf.openConfig` | Open config | Basil | opens a product's (or environment's) `config/<file>.yaml`, asked among them when there are several |
| `atf.openClarifications` | Open clarifications | Poppy | opens the clarifications editor for a product or module |
| `atf.openApproval` | Open approval sheet | Poppy | opens the approval editor for a module |
| `atf.approveModule` | Approve module… | Poppy | the typed-slug dialog, then `testcases.mjs approve <product> <module> --confirm-file` (below) |
| `atf.openReport` | Open report | Ivy | the report webview for a run; a run collected but never rendered is rendered in the background (`report.mjs render`) on request |

**Menus.**
- **The Products view's title** has **New product…** (`$(add)`, first) and **Start or continue a run** when `atf.active`, and **Refresh**. Its `…` menu adds Doctor, Resume a stage, Sync host files and Check host files when `atf.active`, and **Create new project…** and **Open existing project…** always.
- **The Command Palette:** Refresh, Create new project…, Open existing project… and Connect to the package registry… always; `atf.init` only when `atf.workspaceState == noWorkspace`; Install the framework only when `atf.workspaceState == noFramework`; Forget the registry token only when `atf.registryConnected`; every other command only when `atf.active`.
- **A product or environment item** (`atf.product`, `atf.environment`) has, on right-click, **Start or continue a run**, **Doctor**, **Resume a stage**, **Validate config**, **Open config** and **Sweep leftovers…**, plus the inline ▷ (run).

Every command a menu runs takes the tree node as its argument (its `product`, `environment`, `stage`, `module`) and asks only for what the node lacks. The project commands take no argument: a command link can't point Create new project… at a folder.

## Rules
- **No new runtime behaviour in the framework.** The extension only calls `atf` commands and the framework's scripts, and reads artifacts. A script that lacks what the extension needs, for example a `--json` output, is reported, not added by the extension agents.
- **Only the installed framework, with one exception** (D-107). The extension runs the workspace's own installed `@testagentic/atf`, except for **Create new project…**, which runs the registry's `@testagentic/atf@<the extension's exact version>` init before any workspace exists. `runNpm` runs only `npx --yes @testagentic/atf@<exact version> init <absolute folder>` (no range, no tag) and a bare `npm install`; `npmCommandProblem` refuses every other npm or npx command before spawning. On POSIX it is an argument array with no shell; on Windows npm is a `.cmd`, so the line is built for `cmd.exe` (`quoteNpmCmd`), and an argument it can't pass safely (`"`, `%`, `!`, `^`, a quoted one ending in `\`) is refused. With `atf.nodePath` set, the npm or npx beside that Node.js is used.
- **The registry token** (D-107): a GitHub personal access token (classic) with only `read:packages`.
  - **Asked once** (**Connect to the package registry…**, or the first create or install that needs it), in a password box, and kept in VS Code's secret storage under `atf.registryToken`. **Forget the registry token** deletes it. Without one stored, an `ATF_NPM_TOKEN` in VS Code's own environment is used, unasked; without that, the `//npm.pkg.github.com/:_authToken` in the user's own npm config (the file `npm_config_userconfig` names, else `~/.npmrc`), read when needed, `${VAR}` expanded, never copied into secret storage or written anywhere (D-112). A keychain VS Code can't reach counts as no token stored.
  - **Where it goes:** only into the environment of the npm, npx and `atf init` processes the extension starts itself (create, install, init), as `ATF_NPM_TOKEN`. It is never logged, shown, put in argv or written to a file, and every line those processes log or show is masked (`redactLine`). It never reaches a terminal or the chat panel: `runInTerminal` refuses an environment carrying `ATF_NPM_TOKEN` or an `npm_config_…:_authToken`, so an agent session never gets it.
  - **The registry, without `~/.npmrc`** (`registryEnv`): the same processes get `npm_config_@testagentic:registry=https://npm.pkg.github.com` and `npm_config_//npm.pkg.github.com/:_authToken=${ATF_NPM_TOKEN?}`, the two lines of the workspace's `.npmrc`. npm reads settings from `npm_config_<key>` variables above its files, so the user's own `~/.npmrc` (proxy, CA, other registries) is kept and nothing is written. Why not a file: see `src/project.js`'s header and D-107. An inherited `npm_config_allow_scripts` (any spelling) is left out of their environment (`npmEnv`), since npm 12 refuses it as a flag in a project install; npm still reads the user's `allow-scripts` from `.npmrc` (D-108).
- **Create new project…** (user, 2026-10-31). Each step can be cancelled, and a cancel runs nothing:
  1. the token, when none is known;
  2. the folder (D-108):
     - when the window has one folder that is not a project, a pick between it (**In this folder** when it is empty, dotfiles aside; **In a new folder in this one** otherwise) and **Choose another folder…**; else a folder picker, its button **Choose where to create the project**, where a new folder can be made;
     - a folder that is a project, or inside one, is refused before anything else is asked, with **Open it** on that project;
     - an empty folder is used as it is. Any other gets a new folder for the project: an input box asks its name (default `atf-tests`), checked as typed by `projectNameProblem` (a plain name with no `/`, `\`, `" % ! ^ < > : | ? *` or control characters, not `.` or `..`, and not an existing non-empty folder), and the extension makes it;
  3. `npx --yes @testagentic/atf@<version> init <folder>` in the background, in that folder, behind a cancellable notification, the version being the extension's own (`package.json`; D-105's version lock). init writes the project files (its `package.json` allows the package's install script for npm 12) and runs `npm install`, which inherits the registry settings, then renders the host files itself (`atf sync`; D-108);
  4. **New product…**: at once when the folder is this window's; otherwise the window reloads on the folder (`vscode.openFolder`, same window) after storing `atf.pendingNewProduct = { folder, at }` in `globalState`. Activation runs the marker when this window's workspace is that folder, ready, and the marker is under 10 minutes old; keeps it when it is another window's; clears it otherwise, and always once its own window has seen it.

  A registry refusal (an `npm error` line with 401, 403 or 404) says the token can't read `@testagentic/atf` and offers **Replace token** and **Show output**. When init stopped after writing `atf/atf.json`, the message says the project files are in place: open the folder, then **Install the framework**. npm 12's EALLOWSCRIPTS (an `allow-scripts` setting handed to it as a flag) is named as such, with what to do: update the extension and try again, or, when the project files are in place, open the folder and **Install the framework**. Every reason ends with one full stop (`sentence()`).
- **Open existing project…**: a folder picker. A folder holding `atf/atf.json`, or inside one, is opened in this window (its project root). Any other folder is offered **Create new project here**.
- **Install the framework** (state `noFramework` only): the token, then `npm install` in the project, in the background, with the registry settings. Then `atf sync` in the background, as **Sync host files** runs it (`syncHostFiles`), since npm 12 may skip the framework's postinstall that renders the host files (D-108); a sync that fails or is cancelled says the framework is installed and offers **Sync host files**. Then the framework's version, and **New product…** when the project has no product.
- **The framework's scripts by their real path.** `runJson` and `runStreaming` start a framework script from the framework's real folder: in a linked install (npm workspaces, `npm link`), `node_modules/@testagentic/atf` is a symlink, and a script started through it would not see itself as the main module and would run nothing.
- **Background commands.** init, sync, check, doctor, validate, `atf config` and the report's render ask nothing, so they run inside the extension (`runStreaming`; create and install through `runNpm`, the same way): a child process with an argument array and no shell, `ATF_ENV` set by the command itself (never inherited), its output in the `atf` channel, under a cancellable notification showing its latest line. A cancel kills the process tree. Then a result message: what it did, or why it failed (the script's own errors) with **Show output**. None of them prompts: the doctor's `--fix` installs (npm, Playwright's browser, k6 through winget or Homebrew) and init's `npm install` run with no input. A k6 the doctor just installed may need VS Code restarted before its PATH sees it.
- **Human-only commands** (approve, sweep, `import --approved`, eject, migrate, issues) never run silently. `runJson` and `runStreaming` refuse them before spawning anything, unless the command carries `--confirm-file` naming a file `confirmedRun` itself just wrote for exactly that command, and the file still exists. The extension offers two of them:
  - **Approve module…** (`src/sheets/commands.js`):
    1. A modal summary of the module's saved `approval.csv`: its yes, no and changes decisions, and its blank rows. Unsaved edits in the approval editor must be saved first, or approve records the saved sheet without them.
    2. An input box: "Type the module slug `<m>` to record these decisions". It is validated as typed, and only an exact match enables OK.
    3. `confirmedRun("approve", …)` writes `testcases/approval-confirm.json` and runs `testcases.mjs approve <p> <m> --confirm-file <it>` with the `ATF_ENV` of the environment whose last run lists the module.
    4. The result (recorded, cleared, the new counts, or the script's refusal), then the approval view and the Products tree are refreshed.
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
  - `claude`, `copilot-cli` and `codex`: `npx --no atf <command> … [--host copilot|codex]` in a VS Code terminal created with `location: TerminalLocation.Editor`, preceded, when `atf.nodePath` is set, by that Node's folder put first on the command's `PATH` (`PATH='<dir>':"$PATH" npx …`, PowerShell's `$env:PATH = '<dir>;' + $env:PATH; npx.cmd …`, cmd.exe's `set "PATH=<dir>;%PATH%" && npx …`; on the command line, not the terminal's environment, which the shell's startup files could undo), so it is a tab in the editor area, named for the session ("atf run acme", "atf run acme (uat)", "atf resume acme · explore"). The CLI keeps its own doctor pre-check and its own first prompt, and `ATF_AGENT` still overrides the agent command. For `codex`, Codex must trust the project and its hooks (`/hooks`) before the guard runs. Claude Code's panel can't pick the agent, so its CLI is the way to start the orchestrator-agent. The agent CLI is an interactive program the human types into: this is the only terminal the extension opens (`runInTerminal` refuses anything else).
  - `copilot-chat`:
    1. If VS Code Chat is missing (no `workbench.action.chat.open`), the extension says so and offers **Use Claude Code** or **Use Copilot CLI**, which also sets `atf.host`.
    2. Another environment than `default` is offered Copilot CLI instead: a chat session can't be given `ATF_ENV`.
    3. The extension asks the installed CLI for its plan (`cliPlan`: a child node imports `scripts/lib/cli.mjs` and prints `plan()`'s steps). It runs the plan's pre-steps, the doctor, in the background, and stops where the CLI would stop. Problems that block a stage are repeated in a warning.
    4. It opens VS Code Chat with the plan's own first prompt: `{ query, mode: "orchestrator-agent", isPartialQuery: true }`. The undocumented `mode` field is dropped if the command refuses it.
    5. An info message: "Choose orchestrator-agent in the chat's Agent dropdown, then press Enter."

    The prompt is never sent for the human, and never restated by the extension.
- **the Cockpit** (`atf.cockpit`, D-110; `src/cockpit.js`, `src/cockpit-sidebar-page.js`). A webview view with the sheets' hygiene: CSP `default-src 'none'`, one inline style and script with a fresh nonce, no forms posted, no remote resource, every value put in the DOM as text; `retainContextWhenHidden`. The page is untrusted input: `validatePanelMessage` accepts only its known messages, with bounded fields, and the extension checks each target again (a product it lists, a Node.js it offered, a command on its short list) before acting.
  - **Without a ready project** it shows the workspace state's message and its buttons (Create new project…, Open existing project…, Install the framework, Refresh), and the Node.js check.
  - **Environment**, checked when the page first loads and on **Check again**, one check at a time:
    1. the Node.js a session would run on: the pin (`atf.nodePath`, its own `-p process.versions.node`), else what a new terminal finds: VS Code's terminal shell started as an interactive login shell (`-ilc`), so its startup files run as in a terminal, printing one marked line (POSIX; on Windows the first `node.exe` on VS Code's `Path`). Below Node.js 20, or with a pin, the Node.js installs found are offered (nvm, Volta, fnm, Homebrew's kegs, the usual folders, the `PATH`; each probed, 20 or later, newest first) as **Use Node <version> (<source>)**, with **Unpin** when pinned. A choice is accepted only if the check offered it;
    2. the framework's machine check, `doctor.mjs --machine --json` (no run-config: Node.js for the extension's own commands, the framework's dependencies, the login browser, the browser server's browser, k6 as a warning). **Fix what atf can install** runs it with `--fix` (only the checks it marks `fixable`).
  - **Products**: each product and environment with its state (run active, last run ended, not run yet) and **▷ Run**, **Doctor** and **Config**, which run the commands of the same names on it; **+ New product**.
  - **New product** (open when there is no product): the orchestrator's interview questions as a form: the product's name, public or internal, the URL, a description and an overview link, the modules (one per line, `Name` or `Name | URL`), references and API (links or files, with a file picker that gives paths from the project's root), whether it needs a login (and a credentials file's path, never a secret), the steps, the test case types when test cases run without their automation step, and a test case file. **Create the run-config** checks the obvious gaps first, then writes the answers to a temporary file outside the workspace (owner-only, removed afterwards) and runs `run-config.mjs draft` on it: the script writes `config/<product>.yaml`, `readonly`, never over an existing file. Its errors are listed in the form; on success the panel offers **Log in now** (when a login is needed: `atf login <product>` in the background), **Start run** and **Open config**. **let the orchestrator interview me** opens the agent interview instead.
  - **Pipeline** (D-111; the product's `cockpit.mjs <product> --json`, with `ATF_ENV` for the environment, is the only data source: the extension decides nothing about what may run). A product and environment picker with the run's mode badge and id; **Needs you** (clarifications, approvals, blocked or failed stages with **Resume**, leftovers to sweep); the **pipeline rail** (the product stages, then one row per module with a glyph and a text label per stage; a click focuses that stage in the editor tab); the **intents** with a module picker; and links to the editor tab.
  - **Intents:** Explore, Write test cases, Automate, Load test, Heal. Each carries `enabled` and `why` from the script and opens an agent session through the one session path, behind the check before a session. Argv (`intentArgv`): explore, testcases, automate and k6 are `atf <cmd> <p> --module <m> [--env <e>]`; Heal is `atf resume <p> --stage <domain stage> --module <m> [--env <e>]`, the domain stage (`playwright-ui`, `playwright-api` or `k6`) whose triage has healable rows. An active run disables no intent (each resumes it); only what the run's steps rule out, or no healable failure, disables one, with the script's reason as the tooltip.
  - **Look** (`src/cockpit-style.js`): the theme's colours plus one accent, `#2fd1a8` (the extension icon's, mixed with the foreground); a glyph always has a text label; high-contrast themes get their own fallbacks.
- **The Cockpit's editor tab** (`atf.openCockpit`, D-111; `src/cockpit-panel.js`, `src/cockpit-panel-page.js`, `src/cockpit-tabs/*.js`). A `WebviewPanel` of type `atf.cockpitPanel`, one per window (a second command reveals it), with the same hygiene as the sidebar page: strict CSP with a nonce, text-only DOM, `validatePanelPageMessage` and `validateTabMessage` accepting only known, bounded messages, and the extension re-checking every target (a listed product and module, a known stage and tab) against the product list and the last `cockpit.mjs` data. It refreshes when the run's files change. Sessions it starts (Resume, Heal) go through the same gated session path. Four tabs:
  - **Run timeline:** module × stage lanes with durations, attempts and errors, each stage's earlier attempts (when, how long, how each ended, D-113), and the ended runs with their reports and stage times;
  - **Traceability:** case → approval → automated test → last result, filterable, gaps only;
  - **Failures & bug drafts:** clusters by triage class, evidence, the bug drafts report-data already exported, and Heal;
  - **Safety & ledger:** the mode and what it means, this run's ledger entries (live or cleaned), the sweep flow unchanged (`atf.sweep`), and the customized framework config. Before a product's first run it shows the mode the run-config would give the next run, marked "before the first run", with the permissions it would take; the run's resolved mode in `run.json` stays the only mode the guard reads.

  **Files it opens:** only inside the workspace, and never `.auth/`, the run-config's `credentials_file`, or a file whose name matches `/credential|\.env/i` (strict on purpose). A missing source in the data is shown as missing, not as zero.
- **The check before a session** (D-110, D-111). **Start or continue a run**, **Resume a stage** and the Cockpit's intents (`explore`, `testcases`, `automate`, `k6`; `GATED_COMMANDS`), from any menu, the panel, the editor tab or the palette, first:
  1. check the session's Node.js (above). Older than 20, or none: a modal error, since the guard would refuse every tool call of the session (D-109), with **Use Node <version>** (the newest found; it pins it and checks again) and **Show environment**. No **Start anyway**;
  2. unless `atf.checkBeforeRun` is `false`, run the product's dependency check: the CLI's own `atf doctor <p> --no-fix` step, with `--json`. A failing check stops it, in a modal warning that lists each with its fix: **Fix and check again** (when one is `fixable`: the doctor step with its installs, then the check, once), **Start anyway** (the run's own stage gate stops exactly the stages that need what is missing) or **Show checks**.

  The interview is not checked: it starts no stage.
- **New product…** (user, 2026-10-29). Each step can be cancelled, and a cancel runs nothing:
  1. a pick: **Fill in the form** (the Cockpit's form, above), **Set it up myself** or **Let the orchestrator interview me** (the command's optional argument, `"form"`, `"config"` or `"interview"`, skips it);
  2. the product's name, checked as it is typed against what `atf config` refuses: a lowercase kebab-case slug with no `config/<product>.yaml` yet;
  3. the target URL, checked the same way (http or https, the CLI's own test);
  4. a pick: **Log in now** (the default; Microsoft Edge opens) or **No login needed** (`--no-login`).

  `atf config` runs in the background ("Creating config/<product>.yaml…", then "Waiting for you to sign in in Microsoft Edge…" while the login runs). Success shows **Open config** and **Start run**; a failure shows why, with **Show output**. The interview is an agent session, opened as `atf.run` opens one. The CLI checks every argument again; the extension's checks only say it sooner.
- **Text only:** the extension never shows or sends secret values (the credentials files, `.auth/`, the registry token).
- **Platforms:** Windows, macOS and Linux. Use `path` and `vscode.Uri`, with no shell-string concatenation; arguments go to `cli.js` as arrays.
