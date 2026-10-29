# The atf VS Code extension: shared spec (phase 7, P-12)

The extension is a UI over the `atf` CLI and the artifact contract. It is **not** part of safety (P-12, D-020): it never registers, replaces or bypasses the hooks. It writes artifacts only through the framework's scripts, or as a human edit to a file a human may edit. It is published publicly to the VS Code Marketplace and Open VSX (user, 2026-10-27). It holds no IP: without the licensed `@testagentic/atf` package installed in the workspace, it does nothing.

## Layout (`packages/vscode/`)

| Path | Owner | What |
|---|---|---|
| `package.json` | Basil | the extension manifest (all contributions below), scripts, devDependencies |
| `src/extension.js` | Basil | `activate`/`deactivate`; wires the modules below |
| `src/workspace.js` | Basil | finds the atf workspace (`atf/atf.json`) and the installed framework (`node_modules/@testagentic/atf`) |
| `src/cli.js` | Basil | runs atf: `runJson(args)` (child process, parsed JSON or a clear error) and `runInTerminal(args, { name })` (a VS Code terminal, for anything interactive or long) |
| `src/runs.js` | Basil | the run tree's view model and TreeDataProvider |
| `src/sheets/*.js` | Poppy | the clarifications and approval sheet editors; exports `registerSheets(context, deps)` |
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

**Commands** (category "atf"):

| Id | Title | Owner | Runs |
|---|---|---|---|
| `atf.refresh` | Refresh | Basil | refreshes every view |
| `atf.init` | Create workspace (init) | Basil | `atf init` in a terminal |
| `atf.sync` | Sync host files | Basil | `atf sync`, through `runJson` or the terminal |
| `atf.check` | Check host files | Basil | `atf check` |
| `atf.doctor` | Doctor | Basil | `atf doctor <product>` in a terminal |
| `atf.run` | Start or continue a run | Basil | `atf run <product>` in a terminal |
| `atf.resume` | Resume a stage | Basil | `atf resume <product> --stage <s> [--module <m>]` in a terminal |
| `atf.openClarifications` | Open clarifications | Poppy | opens the clarifications editor for a product or module |
| `atf.openApproval` | Open approval sheet | Poppy | opens the approval editor for a module |
| `atf.approveModule` | Approve module… | Poppy | `atf approve <product> <module>` **in a terminal**: the human types the slug; the extension never approves |
| `atf.openReport` | Open report | Ivy | the report webview for a run |

## Rules
- **No new runtime behaviour in the framework.** The extension only calls `atf` commands and reads artifacts. A script that lacks what the extension needs, for example a `--json` output, is reported, not added by the extension agents.
- **Human-only commands** (approve, sweep, `import --approved`, eject, init, migrate, issues) run only in a terminal the human sees, never in a background process.
- **Text only:** the extension never shows or sends secret values (the credentials files, `.auth/`).
- **Platforms:** Windows, macOS and Linux. Use `path` and `vscode.Uri`, with no shell-string concatenation; arguments go to `cli.js` as arrays.
