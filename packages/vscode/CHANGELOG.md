# Changelog

The extension is released together with `@testagentic/atf`, under the same version: use the extension whose version
matches the package installed in your workspace.

## 0.1.4

- **Node.js 20 or later, checked up front:** an agent session on an older Node.js is refused at its first step, with
  what to do (switch Node, then start a new session), instead of failing later when the login or a browser opens. The
  package declares the minimum to npm, and **Create new project…** adds an `.nvmrc`, so `nvm use` in the project picks
  the right Node.

## 0.1.3

Fixes for **Create new project…**, found with npm 12.

- **Your folders stay yours:** an empty folder is used as it is. Any other folder gets a new folder for the project,
  whose name you type (`atf-tests` by default), so the project's files are never mixed in with yours. A folder inside
  an existing project is refused, with **Open it**. The folder dialog's button now reads **Choose where to create the
  project**.
- **npm 12 installs work:** an `allow-scripts` setting in your `~/.npmrc` no longer makes the install fail with
  EALLOWSCRIPTS. If an older framework still hits it, the message says so and what to do.
- **Host files after Install the framework:** it now runs **Sync host files** after `npm install`, since npm 12 may
  skip the framework's own install script that renders them.
- Error messages no longer end with a doubled full stop.

## 0.1.2

Start from the extension alone: no terminal, no `~/.npmrc`, no shell variable.

- **Create new project…:** sets up an atf project in a folder you choose, with the `@testagentic/atf` of the
  extension's own version, then goes straight on to **New product…** for your first product.
- **The registry token, asked once:** a GitHub personal access token (classic) with `read:packages`, kept in VS Code's
  secret storage. It goes only to the installs the extension runs, never to an agent session. **Connect to the package
  registry…** and **Forget the registry token** manage it.
- **Open existing project…** opens a folder holding `atf/atf.json`, and **Install the framework** runs `npm install`
  in a project whose package isn't installed yet, a fresh clone for example.
- **Get started with atf:** a walkthrough from connecting to the registry to your first run.
- **Products view:** the Runs view is now called Products, and the activity bar's container ATF. Without a project it
  shows **Create new project…** and **Open existing project…**; Clarifications and Test case approval appear once a
  project with the framework installed is open.
- **Fewer popups:** a message shows at startup only when one of its buttons fixes the problem, and no message sends you
  to a terminal. **Create workspace (init)** is now **Set up atf in this folder (init)**.

## 0.1.1

The first release of the extension (`@testagentic/atf` 0.1.0 was released without it).

Everything happens inside VS Code: no command sends you to a separate terminal.

- **Runs view:** each product's runs, their status and the next stage; start or continue a run, resume a stage, and
  refresh.
- **Agent sessions:** the `atf.host` setting chooses where a run, a resumed stage or the interview opens. `claude` (the
  default) and `copilot-cli` open the agent CLI in a terminal tab in the editor area, named for the session.
  `copilot-chat` runs the CLI's own check first, then opens VS Code Chat with the run's first prompt, for you to send to
  the orchestrator-agent. The earlier value `copilot` now means `copilot-cli`.
- **New product…:** create a product's run-config from the Runs view, yourself (the name, the URL and an optional
  login, with the progress in a notification) or through the orchestrator's interview; open a product's config, and
  its commands, from its right-click menu.
- **Clarifications view and editor:** the open clarification rows by product and module, edited in a sheet that writes
  through the framework's scripts.
- **Test case approval view and editor:** the cases awaiting sign-off by module, with the approval sheet. **Approve
  module…** shows the sheet's decisions and records them once you type the module slug in its dialog.
- **Sweep leftovers…:** between runs, lists what ended runs left in the target, and deletes it once you confirm the
  warning and type the product slug.
- **Report:** a run's report deck in an editor tab, locked to the report's folder, with no network access. A report
  that was never rendered is rendered for you.
- **Workspace commands:** create a workspace, sync and check the host files, validate a run-config, and the doctor,
  each in the background with its progress in a notification. The doctor lists each check with its fix.
