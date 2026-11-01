# atf for VS Code

A user interface for **atf**, the agentic testing framework (`@testagentic/atf`): check that your machine is ready,
create a product, see your test runs, answer clarifications, sign off test cases and read run reports without leaving the
editor. Everything happens inside VS Code: no command sends you to a separate terminal.

## Requirements

This extension holds none of the framework: it works in an atf **project**, a folder holding `atf/atf.json` with the
licensed `@testagentic/atf` package installed. It can create that project for you.

You need Node.js 20 or later, and a GitHub account that has been given read access to `@testagentic/atf`. The
**Cockpit** panel checks your Node.js and can point atf at a newer one you already have installed.

## Getting started

1. **Install the extension**, then click the **ATF** icon in the activity bar.
2. **Create new project…** The first time, it asks for a GitHub personal access token (classic) with only the
   `read:packages` scope ([create one](https://github.com/settings/tokens/new?scopes=read:packages&description=atf-install)).
   VS Code keeps it in its secret storage: you don't edit `~/.npmrc` or set a shell variable. If your `~/.npmrc`
   already has a token for `npm.pkg.github.com`, that one is used and nothing is asked. Then **choose where to
   create the project**. An empty folder is used as it is. Any other folder gets a new folder for the project, whose
   name you type (`atf-tests` by default), so your other files are never mixed in. A folder inside an existing project
   is refused, with **Open it**. The extension downloads the `@testagentic/atf` of its own version, sets the project up
   there and opens it.
3. **Check your machine:** the **Cockpit** panel, the first view, lists what atf needs (Node.js 20 or later, the
   framework's dependencies, the browsers) and fixes what it can.
4. **Add your first product:** in the Cockpit's **New product** form, give the product's name, its URL, the modules
   to test, any references, whether it needs a login, and the steps to run, then **Create the run-config**.
5. **Start a run:** **▷ Run** on the product. Runs are `readonly` by default.

The **Get started with atf** walkthrough (Help, Welcome, or **Welcome: Open Walkthrough…** in the Command Palette)
takes you through the same steps. Already have a project, such as a cloned one? **Open existing project…** opens it,
and **Install the framework** installs its package when it has none yet.

Never paste the token into a chat or a project file. **Forget the registry token** in the Command Palette removes it.

**From a terminal instead:** set `ATF_NPM_TOKEN` and the `@testagentic` registry in `~/.npmrc` as the access
instructions you were sent describe, run `npx @testagentic/atf init my-tests`, and open `my-tests` in VS Code. The extension starts when the folder contains
`atf/atf.json`.

Use the extension whose version matches the `@testagentic/atf` version installed in the workspace. **Create new
project…** installs the matching version for you.

## Views

The **ATF** icon in the activity bar opens four views:

- **Cockpit:** one page with your machine's environment checks, your products, the pipeline and the New product form (below), and an editor tab with the run's timeline, traceability, failures and safety.
- **Products:** each product's runs, with their status and the next stage. Without a project, it offers **Create new
  project…** and **Open existing project…**. It starts collapsed, since the Cockpit lists the products too.
- **Clarifications:** the open clarification rows, by product and module. Starts collapsed.
- **Test case approval:** the test cases awaiting your sign-off, by product and module. Starts collapsed.

Clarifications and Test case approval appear once a project with the framework installed is open.

## Commands

All commands are in the Command Palette under the **atf** category.

| Command | What it does |
|---|---|
| Refresh | Refreshes every view. |
| Create new project… | Sets up a project in an empty folder you choose, or in a new named folder inside a non-empty one, with the `@testagentic/atf` of the extension's version, then goes on to **New product…**. |
| Open existing project… | Opens a folder that holds `atf/atf.json`. |
| Connect to the package registry… | Asks for the registry token and keeps it in VS Code's secret storage. |
| Forget the registry token | Removes the stored token. |
| Install the framework | Runs `npm install` in the background, in a project whose package isn't installed yet, then **Sync host files**. |
| Set up atf in this folder (init) | Runs `atf init` in the background, in an open folder that already has the package installed. |
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

## The Cockpit

The Cockpit is the first view of the **ATF** sidebar: one page to get from a fresh machine to a run.

- **Environment.** When it opens, and on **Check again**, it checks:
  - which Node.js an agent session would run on, the one a new terminal finds. A session needs Node.js 20 or later. If
    yours is older, as when a shell finds Homebrew's `node@18` before nvm's Node 24, the Cockpit lists the newer
    Node.js installs it finds and offers **Use Node <version>**. That sets `atf.nodePath`, and every session the
    extension opens then runs on that Node, whatever your shell finds. It never edits your shell's files. **Unpin**
    goes back to the terminal's Node;
  - the framework's own checks for this machine: Node.js for atf's commands, the framework's dependencies, the browser
    the login opens, the browser the agents' browser server needs, and k6 (only needed for load tests).
    **Fix what atf can install** runs the safe installs (npm, Playwright's browsers).
- **Products:** each product with **▷ Run**, **Doctor** and **Config**.
- **Pipeline.** Pick a product and environment: the page shows the run's mode (`readonly` or `full-run`) and its id,
  then:
  - **Needs you:** what waits for a human: clarifications to answer, test cases to approve, blocked or failed stages
    (with **Resume**) and leftovers to sweep;
  - **the pipeline rail:** the product's stages, then one row per module with the state of each stage, as a glyph and
    a text label;
  - **intents**, on the module you pick: **Explore**, **Write test cases**, **Automate**, **Load test** and **Heal**.
    Each opens an agent session, the same one you would start with `atf explore`, `atf testcases`, `atf automate`,
    `atf k6` or, for Heal, `atf resume` on the stage with healable failures. A button that can't start is disabled and
    its tooltip says why. A run in progress disables none of them;
  - links into the editor tab.
- **Open Cockpit** (the dashboard button in the title of the Cockpit and Products views, or the command palette)
  opens the Cockpit in an editor tab, one per window, with four tabs:
  - **Run timeline:** each module's stages with durations, attempts and errors, and the ended runs with their reports;
  - **Traceability:** each test case, its approval, the automated test and its last result; filter to the gaps only;
  - **Failures & bug drafts:** failures grouped by class, their evidence, the exported bug drafts and **Heal**;
  - **Safety & ledger:** the run's mode and what it means, the entities this run created (live or cleaned), the
    leftover cleanup, and any customized framework config. Before a product's first run it shows the mode its
    run-config would give the next run, marked "before the first run".

  The Cockpit only reads: it opens files inside your workspace (never `.auth/`, a credentials file or a `.env` file) and
  starts the same `atf` sessions you could type.
- **New product:** the questions the orchestrator's interview asks, as a form: the product's name, public or internal,
  the URL to test, a description, the modules (one per line, with `| URL` for a module's own page), references and an
  API spec (links or files, with a file picker), whether it needs a login (the path to a credentials file, never a
  password), the steps to run and your own test case file. **Create the run-config** writes `config/<product>.yaml`,
  always `readonly`, through atf's own script, and lists anything to fix. Then **Log in now** (when it needs a login),
  **Start run** or **Open config**. No AI is involved: the agents start with the run. Prefer a conversation? **let the
  orchestrator interview me** opens the agent interview instead.

**Before every session.** **Start or continue a run**, **Resume a stage** and the intents first check the session's Node.js: on one older
than 20 the session would be refused, so it stops there, offering **Use Node <version>**. Then they run the product's
own check. A problem stops the run with **Fix and check again**, **Start anyway** or **Show checks**. Turn that product
check off with the `atf.checkBeforeRun` setting; the Node.js check always runs.

## Agent sessions

The `atf.host` setting chooses where **Start or continue a run**, **Resume a stage** and the interview open the
orchestrator-agent:

- **`claude`** (the default): Claude Code's CLI, `claude --agent orchestrator-agent`, in a terminal tab in the editor
  area, named for the session (for example "atf run acme"). Claude Code's panel can't choose the agent, so its CLI is
  used.
- **`copilot-cli`**: Copilot CLI, `copilot --agent orchestrator-agent`, the same way. The earlier value `copilot` means
  this one.
- **`codex`**: OpenAI Codex, `codex "<prompt>"`, the same way (`--host codex`). Codex must trust the project and its
  hooks (`/hooks`) before the guard runs.
- **`antigravity`**: Google Antigravity's CLI, `agy --agent orchestrator-agent`, the same way (`--host antigravity`).
  Not yet verified on a real Antigravity.
- **`copilot-chat`**: VS Code Chat. The extension runs atf's own check of what the run needs, then opens the chat with
  the run's first prompt. Choose **orchestrator-agent** in the chat's Agent dropdown if it is not already chosen, then
  press Enter: nothing is sent for you. A product's other environments (`--env`) open in Copilot CLI instead, since a
  chat can't be given its environment. Without Copilot Chat, the extension says so and offers the other two.

### Switching the AI host, even mid-run

The **AI host** picker at the top of the Cockpit sets `atf.host` for the workspace. Choosing another host first shows a
short warning with **Switch** and **Cancel**. Use it when one host runs out of credits in the middle of a run:

1. Close the old host's session, so two sessions don't drive the same run.
2. Switch, then press **▷ Run**. The run continues from its files on the new host. Finished stages stay done. A stage
   that was cut off mid-way counts as one of its two attempts and runs again, from its last saved step where it has one.
3. Only what was saved carries over (answers, approvals, the run's files), not the old chat.

The hosts are not equal: on every host but Claude Code and VS Code's local agent, the guard can't tell the run's
agents apart, so a `full-run` gives every call the run's combined limits. The warning says what the new host needs.

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
**+** in the Products view's title, or the button the empty view shows) and choose:

- **Fill in the form:** the Cockpit's New product form (above).
- **Set it up myself:** type the product's name (lowercase words joined by hyphens, such as `acme-crm`) and the target's
  URL, then choose **Log in now** (your browser opens: sign in there, and atf saves the session for the run and closes the window) or
  **No login needed**. The extension creates the run-config and shows its progress in a notification, which you can
  cancel; the details are in the **atf** output channel. Then open the config to fill in its modules, or start the run.
- **Let the orchestrator interview me:** the orchestrator opens as an agent session (see above), asks a few questions
  and drafts the run-config with you.

Right-click a product in the Products view to start or continue its run, resume a stage, run the doctor, validate or open
its config, or sweep its leftovers.

## The report

**Open report** shows the deck of a finished run (`artifacts/<product>/results/<run>/report/index.html`) in an editor
tab. Run it from a run in the Products view, or from the Command Palette to pick a run. The deck can read only its own
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
