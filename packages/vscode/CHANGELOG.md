# Changelog

The extension is released together with `@testagentic/atf`, under the same version: use the extension whose version
matches the package installed in your workspace.

## 0.1.0

The first release.

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
