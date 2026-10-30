# atf for VS Code

A user interface for **atf**, the agentic testing framework (`@testagentic/atf`): see your test runs, answer
clarifications, sign off test cases and read run reports without leaving the editor. Everything happens inside VS Code:
no command sends you to a separate terminal.

## Requirements

This extension holds none of the framework. It does nothing on its own: it needs a workspace with the licensed
`@testagentic/atf` package installed.

1. Get access to `@testagentic/atf` (a read-only npm token, used as `ATF_NPM_TOKEN`).
2. Install it in an empty folder, open the folder in VS Code and run **atf: Create workspace (init)** from the Command
   Palette (or run `npx atf init` there yourself).
3. The extension starts when the folder contains `atf/atf.json`.

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
| Create workspace (init) | Runs `atf init` in the background, in the open folder. |
| Sync host files | Runs `atf sync` in the background. |
| Check host files | Runs `atf check` in the background, and offers **Sync now** when they are out of date. |
| Doctor | Runs `atf doctor <product>` in the background and lists each check with its status and its fix. |
| Validate config | Runs `atf validate <product>` in the background. |
| Start or continue a run | Opens the orchestrator-agent session for `atf run <product>` (see [Agent sessions](#agent-sessions)). |
| Resume a stage | Opens the session for `atf resume <product> --stage <stage>`. |
| New product… | Creates a product's run-config: set it up yourself (`atf config`, run in the background), or let the orchestrator interview you (an agent session). |
| Open config | Opens a product's run-config, `config/<product>.yaml`. |
| Sweep leftovers… | Between runs, deletes what ended runs left in the target, once you confirm (see below). |
| Open clarifications | Opens the clarifications sheet of a product or module. |
| Open approval sheet | Opens a module's test case approval sheet. |
| Approve module… | Records the module's approval sheet once you type the module slug (see below). |
| Open report | Shows a run's report deck. |

Background commands show their progress in a notification, which you can cancel; the details are in the **atf** output
channel, and a failure offers **Show output**.

## Agent sessions

The `atf.host` setting chooses where **Start or continue a run**, **Resume a stage** and the interview open the
orchestrator-agent:

- **`claude`** (the default): Claude Code's CLI, `claude --agent orchestrator-agent`, in a terminal tab in the editor
  area, named for the session (for example "atf run acme"). Claude Code's panel can't choose the agent, so its CLI is
  used.
- **`copilot-cli`**: Copilot CLI, `copilot --agent orchestrator-agent`, the same way. The earlier value `copilot` means
  this one.
- **`copilot-chat`**: VS Code Chat. The extension runs atf's own check of what the run needs, then opens the chat with
  the run's first prompt. Choose **orchestrator-agent** in the chat's Agent dropdown if it is not already chosen, then
  press Enter: nothing is sent for you. A product's other environments (`--env`) open in Copilot CLI instead, since a
  chat can't be given its environment. Without Copilot Chat, the extension says so and offers the other two.

## Decisions only you can make

Approving test cases and sweeping leftovers are yours alone. The extension never does either on your behalf: each one
asks you to type a slug in its own dialog. Your typed slug goes to the framework's script through a one-time
confirmation file, which the script checks, uses once and deletes. AI agents can't run these commands or write that
file: the framework's guard refuses both.

- **Approve module…** shows how many yes, no and changes decisions the saved approval sheet holds. Save or discard any
  unsaved edits in the sheet first. Then type the module's slug, exactly, to record them. Only approved test cases are
  automated.
- **Sweep leftovers…** (right-click a product) first lists, without deleting anything, what ended runs left in the
  target and what you must clean up by hand. If something can be deleted, it warns that this deletes live data in the
  target. Then type the product's slug to delete it, for every ended run or for one run. The framework sweeps only
  between runs, and only for a run-config in `full-run` mode.

## A new product

A product starts with its run-config, `config/<product>.yaml`: what to test, and where. Click **New product…** (the
**+** in the Runs view's title, or the button the empty view shows) and choose:

- **Set it up myself:** type the product's name (lowercase words joined by hyphens, such as `acme-crm`) and the target's
  URL, then choose **Log in now** (Microsoft Edge opens: sign in there, and atf saves the session for the run) or
  **No login needed**. The extension creates the run-config and shows its progress in a notification, which you can
  cancel; the details are in the **atf** output channel. Then open the config to fill in its modules, or start the run.
- **Let the orchestrator interview me:** the orchestrator opens as an agent session (see above), asks a few questions
  and drafts the run-config with you.

Right-click a product in the Runs view to start or continue its run, resume a stage, run the doctor, validate or open
its config, or sweep its leftovers.

## The report

**Open report** shows the deck of a finished run (`artifacts/<product>/results/<run>/report/index.html`) in an editor
tab. Run it from a run in the Runs view, or from the Command Palette to pick a run. The deck can read only its own
report folder and has no network access. Use the arrow keys, Page Up and Page Down, Home and End to move between
slides.

If the run's report was collected but never rendered, the extension offers to render it
(`node <framework>/scripts/report.mjs render <product>`, in the background) and then shows it.

## Safety

The extension is not part of the framework's safety. The rules that limit what the agents may do (the read-only
default, full runs, deleting only what a run created) are enforced by the hooks that `atf sync` installs in the
workspace. The extension never registers, changes or bypasses them. It writes run files only through the framework's
own scripts, or as an edit you make to a sheet you may edit, and it never shows or sends credential values.

## Licence

See `LICENSE.md`, included with the extension. The `@testagentic/atf` package has its own licence.
