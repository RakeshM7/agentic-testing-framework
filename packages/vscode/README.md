# atf for VS Code

A user interface for **atf**, the agentic testing framework (`@testagentic/atf`): see your test runs, answer
clarifications, sign off test cases and read run reports without leaving the editor.

## Requirements

This extension holds none of the framework. It does nothing on its own: it needs a workspace with the licensed
`@testagentic/atf` package installed.

1. Get access to `@testagentic/atf` (a read-only npm token, used as `ATF_NPM_TOKEN`).
2. In an empty folder, create the workspace with `npx atf init`, or run **atf: Create workspace (init)** from the
   Command Palette.
3. Open the folder in VS Code. The extension starts when the folder contains `atf/atf.json`.

Use the extension whose version matches the `@testagentic/atf` version installed in the workspace.

## Views

The **atf** icon in the activity bar opens three views:

- **Runs:** each product's runs, with their status and the next stage.
- **Clarifications:** the open clarification rows, by product and module.
- **Test case approval:** the test cases awaiting your sign-off, by product and module.

## Commands

All commands are in the Command Palette under the **atf** category.

| Command | What it does |
|---|---|
| Refresh | Refreshes every view. |
| Create workspace (init) | Runs `atf init` in a terminal. |
| Sync host files | Runs `atf sync`. |
| Check host files | Runs `atf check`. |
| Doctor | Runs `atf doctor <product>` in a terminal. |
| Start or continue a run | Runs `atf run <product>` in a terminal. |
| Resume a stage | Runs `atf resume <product> --stage <stage>` in a terminal. |
| Open clarifications | Opens the clarifications sheet of a product or module. |
| Open approval sheet | Opens a module's test case approval sheet. |
| Approve module… | Runs `atf approve <product> <module>` in a terminal, where you type the confirmation yourself. |
| Open report | Shows a run's report deck. |

Anything that needs a human's decision, such as approving test cases, runs in a terminal you see and type into. The
extension never approves, sweeps or imports on your behalf.

## The report

**Open report** shows the deck of a finished run (`artifacts/<product>/results/<run>/report/index.html`) in an editor
tab. Run it from a run in the Runs view, or from the Command Palette to pick a run. The deck can read only its own
report folder and has no network access. Use the arrow keys, Page Up and Page Down, Home and End to move between
slides.

If the run's report was collected but never rendered, the extension offers the render command
(`node <framework>/scripts/report.mjs render <product>`) and runs it in a terminal.

## Safety

The extension is not part of the framework's safety. The rules that limit what the agents may do (the read-only
default, full runs, deleting only what a run created) are enforced by the hooks that `atf sync` installs in the
workspace. The extension never registers, changes or bypasses them. It writes run files only through the framework's
own scripts, or as an edit you make to a sheet you may edit, and it never shows or sends credential values.

## Licence

See `LICENSE.md`, included with the extension. The `@testagentic/atf` package has its own licence.
