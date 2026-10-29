# Packaging the framework for clients

**Status:** agreed design, 2026-10-24. The user reviewed every draft entry below and agreed to each as written. Every phase is in force (D-085 as amended by D-086, and D-087 to D-099; the cloud-agent opt-in and the Claude Code plugin are experimental until verified live; the cloud-agent opt-in is experimental until verified live); the rest is not yet. The draft decision entries at the end are written in the format of [`decisions.md`](decisions.md). Each one moves into `decisions.md` as Accepted (dated 2026-10-24, with its superseded entries marked) in the same change that implements its phase, so the log never runs ahead of the code (rules 4 and 5 there).

## 1. What was decided in the interview

| Question | Answer |
|---|---|
| Who installs it | Clients and partners, outside the org |
| Hosts on day one | All current hosts: Claude Code, VS Code (local agent and Copilot CLI engine), Copilot CLI, the cloud coding agent |
| Where a client's work lives | A dedicated test repo per client, holding one or more products (today's layout) |
| Main reason for packaging | Protect the IP |
| Strength of that protection | Legal plus light friction: a licence, a compiled package, a private registry. Every host keeps running locally |
| Safety config (permissions, models, platforms, MCP) | Fully overridable by the client, through overlays and through eject |
| Distribution | Private npm registry, a scoped package, one access token per client |
| Host files (`.claude/agents`, `.github/agents`, hooks, MCP configs) | Generated in the client repo by `atf sync` and git-ignored |
| Agent prompts | Clients may add instructions per agent (add-on fragments) but can't replace the shipped body |
| `feedback-implementor-agent` | Re-scoped: it fixes the **outputs** (test cases, Playwright and k6 code, the report), not the framework |
| Framework issues met during a client's run | Exported as a redacted bundle the client sends back |
| Decision log in client repos | The framework's own log stays internal; `atf init` gives each client an empty log and the same confirmation hook for their own repo-level decisions |
| Upgrades | Semver, plus tested `atf migrate` steps for the artifact contract |
| VS Code extension | Later, as a UI layer only, with no safety role |
| Claude Code plugin | Yes, as a second channel next to npm |
| Source repo | A monorepo |
| Client operating systems | macOS, Windows and Linux |

## 2. What "light friction" protection buys, and what it doesn't

A local package can't hide its agent prompts. Claude Code and Copilot load agents only from plain-text files in the workspace, and the model can repeat them anyway. A determined user can also read the scripts in `node_modules`. What the chosen level does give:

- **Legal:** the package is `"license": "UNLICENSED"` with a commercial EULA (`LICENSE.md`) that grants use and forbids redistribution and derivative works. The contract is the real protection.
- **Access:** the package is only on a private registry. Revoking a client's token stops upgrades, but not their installed copy.
- **Friction:**
  - Each script entry point is bundled with esbuild into one file. It is not minified, so hook-error stack traces in `artifacts/hook-errors.jsonl` stay readable.
  - The package holds only what runs. The tests, the decision log, `feedback/`, the git history and the maintainer docs stay in the monorepo.
- **Not in the client's git:** the host files are git-ignored (P-3), so the prompts never land in the client's history.

If stronger protection is ever needed, the step up is to host the deterministic layer (scripts, templates, generators) as a service. That is out of scope here. There is no licence-key check either (Q4).

## 3. Architecture

### 3.1 Two roots instead of one

Today `repoRoot` (`scripts/lib/contract.mjs:21`) is the directory the scripts live in, and every path hangs off it: the scripts, the templates, the schemas, `config/`, `artifacts/`, `playwright-tests/` and `k6-tests/`. 38 files under `scripts/` use it. Packaging splits it in two:

| Root | What it holds | Who writes it |
|---|---|---|
| **Framework root** (`frameworkRoot`): the installed package, `node_modules/@testagentic/atf/` | scripts, `agents/` sources, the default `config/`, `templates/`, `schemas/`, the agent-facing docs | only the package manager; the guard denies every agent write there |
| **Workspace root** (`workspaceRoot`): the client's test repo | `config/<product>.yaml` run-configs, `atf/` (overlays, ejected config, agent fragments, the client decision log), `artifacts/`, `playwright-tests/`, `k6-tests/`, `feedback/`, the generated host files | the pipeline, the client's humans, and `atf sync` |

How each root is resolved:
- `frameworkRoot` comes from the script's own location. This is exactly today's `repoRoot` logic, renamed.
- `workspaceRoot` is the first match of: `ATF_WORKSPACE`, `CLAUDE_PROJECT_DIR` in hooks, then the nearest ancestor of the working directory that holds `atf/atf.json`, written by `atf init`.
- In the monorepo's own dev workspace, both resolve as today, so nothing changes for development.

What has to change:
- `contract.paths()` and the guard's path variables resolve against `workspaceRoot`.
- `templatesOf()`, `schemaDir` and the default config resolve against `frameworkRoot`.
- Every config read goes through one loader, `scripts/lib/config.mjs`, which applies the overlays (§3.4).

### 3.2 How agents call the scripts

Agent bodies call `node scripts/<x>.mjs …` in more than 100 places, and they read `docs/agent-handoffs.md`, `docs/playwright-conventions.md`, `schemas/` and so on.
- **The sources** gain one neutral token, `{fw}`: for example `node {fw}/scripts/run.mjs next <product>` and `{fw}/docs/agent-handoffs.md`.
- **`atf sync`** expands `{fw}` to the package's path relative to the workspace, normally `node_modules/@testagentic/atf`. It finds that path with `require.resolve`, so npm and pnpm both work. In the monorepo's dev workspace it expands to `packages/core`.
- **Commands keep their current shape:** `node <path>/scripts/x.mjs`. There is no `npx` (about 1 s of start-up per call on managed Windows, D-042) and no PATH dependency.
- **The guard's shell allow-lists** match the expanded form. The token is expanded inside `shell_allow` too, so a run's frozen permissions hold exact commands, as today.
- **Lint:** `{fw}` is the only template syntax. D-019's "no template engine" stays true in spirit, because this is one fixed substitution, not a language.

### 3.3 The CLI (`atf`)

A `bin` entry (`atf`) replaces the `Makefile`, because Windows clients don't have `make`. Humans type these commands; agents never call `atf`.

| Command | Does | Replaces |
|---|---|---|
| `atf init [dir]` | Creates the workspace: `package.json` with the dependency pinned, `.npmrc` template for the registry, `.gitignore` entries, `atf/atf.json`, an empty `atf/decisions.md`, `AGENTS.md`, `config/`; then runs `sync` and `doctor` | cloning the repo |
| `atf sync` | Renders the host files from the installed version, the overlays and the fragments. It also runs as `postinstall`. Writes nothing on error | `npm run build-agents` |
| `atf check` | Fails on drift between the installed version and the generated files, and runs the overlay and fragment lint | `npm run check` (client part) |
| `atf doctor [product]` | Today's doctor, plus: package and plugin versions match, the host files are in sync, the registry is reachable | `make doctor` |
| `atf interview`, `atf run`, `atf resume`, `atf login`, `atf status`, `atf next`, `atf steps`, `atf approve`, `atf import`, `atf sweep`, `atf diff`, `atf validate` | Same as today's targets; `--env <env>` replaces `ENV=` (D-081) | `make <target>` |
| `atf eject config [<file>]` | Copies the package's config (or one file) into `atf/config/`; that file then fully replaces the package's | — |
| `atf migrate [--dry-run]` | Applies the artifact-contract migrations from the workspace's recorded version to the installed one | — |
| `atf issues export [--run <id>]` | Writes a redacted framework-issues bundle to send back | `run.mjs end` writing `feedback/run-*` (D-083) |
| `atf version` | Package, contract, plugin and Node versions | — |

All of it works the same on macOS, Windows and Linux. The CLI uses Node APIs only: no shell builtins, no bash, `path` everywhere, and nothing assumes `/` in the guard's path matching.

### 3.4 Config overrides: overlays and eject

Every file in the package's `config/` (`permissions.yaml`, `models.yaml`, `platforms.yaml`, `mcp.yaml`, `hooks.yaml`) is read through `scripts/lib/config.mjs`:

1. If `atf/config/<file>` exists (ejected), it is the whole file, and the package's copy is ignored.
2. Otherwise the package's file is the base, and `atf/<file>` (an overlay) is deep-merged over it:
   - a map merges key by key;
   - a list replaces the base list;
   - `null` deletes a key.
3. The merged result is schema-checked. `run.mjs init` freezes it into the run's state (D-006, unchanged).

**What can't be overridden (it lives in code, not config):**
- the `readonly` default and the mode cap (D-004);
- deletes scoped to the run's ledger (D-005, D-074);
- fail-closed behaviour (D-007, D-036);
- the agent identity rules (D-021);
- the guard-check before a run's first stage (D-037).

A client who patches `node_modules` is outside the licence and outside any guarantee. `atf doctor` reports a package whose file digests don't match the published ones.

**Who may write overlays:** humans only. The guard denies agent writes under `atf/`, which extends D-013 from `config/` to the client's overrides.

**Provenance:** `run.json` records which config files were overlaid or ejected, with their digests (it extends D-077), and the report shows "custom safety config" whenever `permissions.yaml` differs from the package's.

### 3.5 Agent add-on fragments

`atf/agents/<name>.extra.md` is appended at sync under a fixed heading, `## Project additions (from atf/agents/<name>.extra.md)`.
- The body lint applies: `forbidden_in_body` and Copilot's `body_limit`, both measured on the combined text.
- A fragment can't change the agent's frontmatter, so its tools, model and subagents still come only from config.
- A fragment for an agent the package doesn't have fails `sync`.

### 3.6 Host files in the client repo

`atf sync` writes these files from the installed package. They are git-ignored apart from the exceptions below:
- `.claude/agents/`, `.github/agents/`;
- `.mcp.json`, `.vscode/mcp.json`;
- the `hooks` key of `.claude/settings.json`, `.github/hooks/framework-guard.json`, `.vscode/hooks/framework-guard.json`;
- `.vscode/settings.json` (the framework keys only).

Each hook command is `node node_modules/@testagentic/atf/scripts/hooks/pretooluse.mjs --host …`.

**Committed exceptions:**
- **`AGENTS.md`:** it holds no IP, and every host needs it at session start. `atf init` writes it as a short brief that points to `{fw}/docs/…` and to `atf/decisions.md`. It keeps D-027's "one brief" rule.
- **`.claude/settings.json`:** it's a file the client may also edit. `sync` owns only its `hooks` key (D-042), and the client decides whether to commit it.

**Cloud coding agent:** as far as I know, it reads custom agents and hooks from the repository as committed (the reason behind D-018). If so, git-ignored host files don't exist for it. The proposal is an opt-in setting, `atf/atf.json` `"cloud_agent": true`. With it, `sync` writes `.github/agents/` and `.github/hooks/` to a path the client commits, and `copilot-setup-steps.yml` runs `npm ci`. That puts the Copilot prompts in that client's git, which they accept by opting in. **To verify in phase 3**, along with whether setup steps run before the agent profile loads.

### 3.7 The client decision log

`atf init` creates `atf/decisions.md`. It has the same format and rules as ours, starts with no entries, and uses the same `decisions.mjs` (index, for, show, the confirmation hook) pointed at `workspaceRoot`.
- **What it governs:** the client's overlays, fragments, run-configs and any house rules about their test code.
- **What stays internal:** the framework's own `docs/decisions.md` lives only in the monorepo, and the package doesn't contain it.
- **Agent references:** the two agents that mention `docs/decisions.md` (and `feedback-implementor-agent`) point to `atf/decisions.md` instead.

### 3.8 `feedback-implementor-agent`, re-scoped to outputs

**What it does now:** it changes the framework itself (D-062, `agents/feedback-implementor-agent.md`) and is barred from generated test code. In a client install, the framework is read-only in `node_modules`, so it has nothing to work on.

**What it does instead:** it takes feedback about what a run **produced** and fixes it in the workspace:
- the knowledge base;
- test cases;
- the endpoint catalogue and plans;
- Playwright and k6 code;
- the report narrative.

**The constraints that carry over from the per-domain design:**
- **Through the same handles as the domain fixers.** Generated code is regenerated by scripts (D-054 – D-057), so a direct edit to a managed file would be overwritten. The implementor works through the overlays and slots each domain owns, then runs that domain's `check`. Concretely, it routes a finding to the right overlay and slot set, using `fix.mjs` and the domain's paths command.
- **Re-approval.** A changed test case goes back through human approval (`testcases.mjs approve` stays human-only, D-048).
- **Unchanged parts of D-062:** `feedback.mjs check` still verifies each Resolution (one per finding, the files changed, and the client decisions considered from `atf/decisions.md`). The test-per-script-change rule becomes "the domain's check passes" (`ui-code.mjs check`, `api-code.mjs check`, `testcases.mjs check` …).
- **Still human-only:** safety, overlays, ejected config and the host files.

**What it may write:** the overlays, slots and fragments of each domain (the domain fixers' set in `config/permissions.yaml`, plus the test case and knowledge overlays), and the feedback files. It may not write `node_modules`, `atf/`, the host files, or anything managed.

**Framework maintenance in the monorepo:** today's framework-fixing agent continues there as a dev-only `framework-implementor-agent`, which the package never ships. It works from the issue bundles that `atf issues import` turns into feedback files, under D-062's checks (Q5).

### 3.9 Framework issues: an export bundle

`framework-issues.mjs add` is unchanged (D-083). What changes is what happens at the end:
- **`run.mjs end`** writes the issues to `artifacts/<product>/results/<run>/framework-issues.json` only.
- **`atf issues export [--run <id> | --since <date>]`** writes `atf-issues-<client>-<date>.zip` holding:
  - the issues with their `FI-` ids;
  - the package, contract and Node versions, the host, and which config files were overlaid or ejected;
  - the evidence, **redacted**: hosts, URLs, emails, tokens and IDs that look like secrets are replaced by placeholders, and screenshots and network bodies are left out unless `--include-evidence` is given;
  - a manifest listing every redaction.
- **Before writing,** the command shows the client what's in the bundle.
- **On our side,** `atf issues import <zip>` (monorepo only) turns a bundle into today's feedback files for the maintainers.

### 3.10 Versions and migrations

- **Versioning:** the package is semver.
- **Contract version:** `LAYOUT_VERSION` (`contract.mjs:19`) becomes the artifact-contract version, recorded in `atf/atf.json` and in every `run.json`.
- **Provenance** gains the package version and the plugin version; the git commit is null in a client workspace, which D-077 already allows.
- **Patch and minor releases** must read every artifact a previous release of the same major wrote. CI enforces this with fixtures: a frozen workspace from each supported version.
- **A major release** that changes the contract ships `migrations/<from>-to-<to>.mjs`. Each is pure, idempotent and tested on those fixtures. `atf migrate` takes the workspace lock, backs up `artifacts/<product>/state/`, applies the steps in order and records them.
- **Resume across versions:** `run.mjs resume` refuses a run started on another major, or on an unmigrated contract. Within a major it continues and records the version change in the run's history.
- **Generated test code** (`playwright-tests/`, `k6-tests/`): managed files are re-rendered by the next run's foundation and code steps as today. A major's release notes say so when re-rendering changes them.

### 3.11 The monorepo

```
packages/
  core/                 @testagentic/atf: scripts/, agents/, config/ (defaults), templates/, schemas/, docs/ (agent-facing,
                        platforms.md included), bin/atf.mjs, migrations/, LICENSE.md. Published as the bundled build
                        (dist), never as source.
  claude-plugin/        the Claude Code plugin (phase 6)
  vscode/               the extension (later)
config/, artifacts/, playwright-tests/, k6-tests/, feedback/
                        the repo root is the maintainers' workspace (atf/atf.json marks it): one place to open for
                        framework edits and pipeline runs
docs/                   maintainer docs: decisions.md, agent-architecture, packaging
AGENTS.md               the maintainers' brief (the client one is generated by atf init)
package.json            npm workspaces (packages/*); packages/core is linked at node_modules/@testagentic/atf
```

**Decided for phase 2 (user, 2026-10-26):**
- **The repo root is the workspace.** There is no `dev/` folder. The host files, `AGENTS.md`, the decision log, the run-configs, `artifacts/` and the generated test code stay at the root, and the framework moves to `packages/core`.
- **npm workspaces.** They need no extra tool. `packages/core` is linked into `node_modules/@testagentic/atf`, as a client gets it.
- **Read-only only when installed.** The guard's `framework-readonly` rule (D-085) applies only when the framework root's real path, after symlinks, lies inside a `node_modules` directory. A source checkout such as `packages/core`, reached through the workspace link, stays editable under the normal per-agent permissions and the decision-log hook.
- **Decision-log paths.** The move renames the **Affects** paths in `docs/decisions.md` in place, with a `packages/core/` prefix and nothing else changed. A new entry records why, and a test checks that only **Affects** lines changed.

**Decided for phase 2, second round (user, 2026-10-26), after a first attempt broke the live guard by leaving `guard.mjs` half-edited while a run was active:**
- **End the active run first.** With no active run, a broken intermediate guard fails open and can be recovered. Anything the hook loads is edited only as a whole-file write.
- **Draft numbering.** Drafts take the next free ID when they land (the table in §6).
- **The Makefile's Affects.** Deleting it renames `Makefile` in the **Affects** of D-066, D-069, D-075, D-081 and D-084 to `packages/core/bin/atf.mjs`, under the same mechanical-rename rule.
- **How the move runs.** A subagent prepares and tests a move script without running it. The user runs it from their own terminal, since it also rewrites `.claude/settings.json`, then starts a new session, because Claude Code fixes the hook path at session start.
- **Two parts.** Phase 2 is split into 2a (the move) and 2b (the CLI).
- **Printed hints and headers** go through `{fw}` in 2a.
- **Playwright** is a peer dependency of `@testagentic/atf`, and `atf doctor` checks it.

**Decided for phase 2b (user, 2026-10-26), recorded as D-087:**
- **Arguments.** The product and module are positional, everything else a flag: `atf approve <product> <module>`, `atf resume <product> --stage k6 --module deals`, `--env <env>` for `ENV=`.
- **Opening the session.** `--host claude|copilot` (default `claude`), overridden by `ATF_AGENT="<command>"`.
- **Shipped docs** write framework commands as `node {fw}/scripts/…`.
- **Developer commands.** Only `atf setup` and `atf e2e`; `npm run check`, `npm test` and `npm run build-agents` stay npm scripts until phase 3.
- **The decisions that name `make`** (D-066, D-069, D-075, D-081, D-084) are extended, not superseded, so they keep governing their files.

- `npm run check` in the monorepo builds the root's host files and fails on drift. In the monorepo, the generated files stay committed, so D-018's reasons still hold for our own cloud-agent maintenance.
- The release workflow does four things:
  - runs `npm test`, including the migration fixtures and the offline pipeline test (D-084);
  - bundles the scripts;
  - checks the package's file list against an allow-list;
  - publishes to the private registry.

### 3.12 The Claude Code plugin

- **What it is:** a private plugin marketplace, a git repo clients are given access to. It holds a plugin that carries the Claude Code agents, the hook registration (`${CLAUDE_PLUGIN_ROOT}`) and the MCP servers.
- **Where the code comes from:** prompt bodies can't resolve `${CLAUDE_PLUGIN_ROOT}`, so the plugin still uses the npm package in the workspace for every script call. In effect the plugin replaces only the Claude Code half of `atf sync`. The workspace still needs the package installed.
- **Versions:** `atf doctor` and the guard's pre-flight refuse a plugin whose version differs from the installed package.
- **To verify in phase 6:**
  - how a plugin agent's name appears in the hook payload's `agent_type` (it may be namespaced as `plugin:agent`), because the Claude adapter must map it to the bare name and nothing else (D-021);
  - whether plugin agents can still spawn each other three layers deep.
- **Cost:** a second release channel. Each release publishes both, from the same commit and with the same version.

### 3.13 The VS Code extension (later)

- **What it is:** a UI over `atf` commands and the artifact contract:
  - a run tree with status and next stage;
  - the clarifications CSV and the approval sheets as editable views that write through their scripts, never directly;
  - the report webview;
  - init, sync and doctor commands.
- **What it is not:** a runtime or part of safety. The hooks stay the only enforcement.

## 4. Phased plan

| Phase | Delivers | Main risk |
|---|---|---|
| 0 | Review this doc; confirm or change the draft decisions | — |
| 1 | **Root split in place:** `frameworkRoot` and `workspaceRoot`, `config.mjs` (no overlays yet), the `{fw}` token in sources and the guard. All tests run with the workspace in a temp dir, apart from the framework | the largest change: 38 files, plus the guard's path matching |
| 2a | **The move:** a tested move script the user runs from their own terminal, then a new session. It moves the framework to `packages/core` (the root stays the workspace) and moves `platforms.md` into core. It sets up npm workspaces with Playwright as a peer dependency, applies read-only only when installed, and routes printed hints and generated-code headers through `{fw}`. Decision-log **Affects** get the `packages/core/` prefix, checked by a frozen-log test | this session's hook path; the guard must stay loadable throughout |
| 2b | **The CLI:** `bin/atf.mjs` covers every `make` target. The guard learns the human-only `atf` forms (approval, approved import, sweep). The Makefile is removed, its **Affects** become `packages/core/bin/atf.mjs`, `make` becomes `atf` in docs and hints, and CI runs on macOS, Windows and Linux | path assumptions on Windows |
| 3 | **Client workspace:** `init`, `sync` writing git-ignored host files, overlays, eject, fragments, the client decision log, the generated `AGENTS.md`, the cloud-agent opt-in | the cloud agent's behaviour (§3.6) |
| 4 | **Release:** the esbuild bundle, the file allow-list, the EULA, the private registry publish, the contract version, `atf migrate` with fixture CI, the provenance additions | bundling scripts that are also imported by tests |
| 5 | **Feedback:** the output-scoped implementor, `atf issues export` and import | routing a finding to the right overlay or slot |
| 6 | **Claude Code plugin** | plugin `agent_type` naming (§3.12) |
| 7 | **VS Code extension (UI)** | — |

## 5. Resolved questions (2026-10-24)

- **Q1 · Package name:** `@testagentic/atf`; the CLI is `atf`.
- **Q2 · Cloud agent:** supported through the opt-in commit (§3.6, P-3). A client who doesn't opt in keeps every host file git-ignored.
- **Q3 · Hard safety rules:** fixed in code (§3.4, P-4). Overrides change who may do what, never the readonly default, ledger-scoped deletes, fail-closed behaviour or agent identity.
- **Q4 · Licence checks:** the private registry token is the only gate. There is no licence-key code; the EULA covers use.
- **Q5 · Framework maintenance:** today's framework-fixing agent stays in the monorepo as a dev-only `framework-implementor-agent`, never shipped. It works from imported issue bundles, under D-062's checks.
- **Q6 · Redaction defaults:** text only, redacted, previewed before writing. Screenshots and network bodies only with `--include-evidence` (P-8).

## 6. Draft decision entries

Drafts are numbered P-1 to P-12. Each takes the next free `D-` ID when it is recorded, because the log requires sequential IDs. Superseded entries get `Superseded by D-NNN (<date>)` in the same change.

| Draft | Recorded as | Phase |
|---|---|---|
| P-1 · two roots | D-085 | 1 |
| P-2 · private licensed package, monorepo | monorepo part: D-086; distribution part: phase 4 | 2a, 4 |
| P-3 · `atf sync`, git-ignored host files, `atf init` | D-089 (and D-092 for client hooks and MCP servers) | 3b |
| P-3 · the cloud-agent opt-in | D-093 (experimental: `docs/cloud-agent-verification.md`) | 3c |
| P-2 · distribution: bundle, allow-list, EULA gate; the registry | D-094, superseded by D-103 (GitHub Packages, 2026-10-29) | 4 |
| P-4 · config overlays and eject | D-088 | 3a |
| P-7 · feedback-implementor-agent fixes outputs; dev-only framework-implementor-agent | D-096 | 5 |
| P-8 · redacted issue export and import | D-097 | 5 |
| P-9 · contract version, `atf migrate`, frozen fixtures | D-095 | 4 |
| P-11 · the Claude Code plugin | D-098 (experimental: `docs/claude-plugin-verification.md`) | 6 |
| P-12 · the VS Code extension | D-099 (public: VS Code Marketplace and Open VSX) | 7 |
| P-5 · agent add-on fragments | D-090 | 3b |
| P-6 · the client decision log | D-091 | 3b |
| P-10 · `atf` CLI replaces the Makefile | D-087 (the `make` targets; the other commands land with phases 3 to 5) | 2b |
| others | the next free ID when their phase lands | 3–7 |

### D-085 · The framework root and the workspace root are separate; the framework is installed read-only
- **Status:** Accepted, recorded in decisions.md · **Date:** 2026-10-24 · **Source:** conversation with the user, 2026-10-24 (packaging for clients)
- **Decision:**
  - **Two roots.** `frameworkRoot` is the package's own location: scripts, agents, default config, templates, schemas and the agent-facing docs. `workspaceRoot` is resolved from `ATF_WORKSPACE`, then `CLAUDE_PROJECT_DIR` in hooks, then the nearest `atf/atf.json` above the working directory. It holds run-configs, `atf/`, `artifacts/`, `playwright-tests/`, `k6-tests/`, `feedback/` and the host files.
  - **What resolves where.** `contract.paths()` and the guard's path variables resolve against the workspace; templates, schemas and default config against the framework.
  - **Agent sources.** They use one token, `{fw}`, for framework paths (commands, docs, schemas). The render step expands it to the package's path relative to the workspace, inside `shell_allow` too.
  - **Read-only framework.** The guard denies every agent write under `frameworkRoot`.
- **Why:** a client installs the framework and keeps their own work. With one root, neither upgrades nor a separate test repo are possible.
- **Affects:** `scripts/lib/contract.mjs`, `scripts/lib/guard.mjs`, `scripts/lib/permissions.mjs`, `scripts/hooks/pretooluse.mjs`, `scripts/lib/foundation.mjs`
- **Confirmed by the user on:** — (extends D-002 and D-020 without weakening them)

### P-2 · Clients get a private, licensed npm package built from a monorepo
- **Status:** Accepted: the monorepo part as D-086 (phase 2a), the distribution part as D-094 (2026-10-26, phase 4: npmjs private org, 0.1.0, a DRAFT licence gate) · **Date:** 2026-10-24 · **Source:** conversation with the user, 2026-10-24
- **Decision:**
  - **Monorepo.** This repo holds `packages/core` (the package), `packages/claude-plugin`, later `packages/vscode`, with the repo root as the maintainers' workspace, which consumes the package through the npm workspace link like a client.
  - **Distribution.** The package is published only to a private registry, one access token per client. It is `UNLICENSED`, with a commercial EULA.
  - **Light friction.** Script entry points are bundled (esbuild, not minified). The package holds only runtime files, enforced by an allow-list in the release workflow. The tests, the decision log, `feedback/` and the maintainer docs are never shipped.
  - **Accepted limit.** Agent prompts are plain text in every client install. The protection is legal and access-based, not technical.
- **Why:** the user wants to protect the IP while clients keep running the pipeline in their own Claude Code and Copilot. A contract plus friction is the strongest protection compatible with local hosts.
- **Affects:** `package.json`
- **Confirmed by the user on:** —

### P-3 · In a client workspace, host files are generated by `atf sync` and git-ignored
- **Status:** Accepted, recorded in decisions.md as D-089 (2026-10-26, phase 3b): sync also runs automatically on install, and a client's own agents, hooks and MCP servers are kept or pointed to `atf/` (D-089, D-092). The cloud-agent opt-in is phase 3c · **Date:** 2026-10-24 · **Source:** conversation with the user, 2026-10-24
- **Decision:**
  - **What sync writes.** `atf sync` (also run on `postinstall`) renders the agent files, MCP configs and hook registrations from the installed package, the overlays and the fragments. It writes nothing on error.
  - **Git-ignored.** In a client workspace those files are git-ignored. `AGENTS.md` is generated once by `atf init` and committed.
  - **Cloud agent opt-in.** `atf/atf.json` `cloud_agent: true` makes `sync` write the Copilot agent and hook files for committing, so the cloud coding agent can see them.
  - **Monorepo unchanged.** In the monorepo, the dev workspace's generated files stay committed (D-018).
- **Why:** prompts stay out of client git history, and an upgrade is just a version bump. D-018's committed-files rule exists for the cloud agent, which the opt-in keeps.
- **Affects:** `scripts/build-agents.mjs`, `scripts/lib/hook-registrations.mjs`, `scripts/lib/mcp.mjs`
- **Supersedes:** D-018 (for client workspaces only) · **Confirmed by the user on:** —

### P-4 · Clients may override any config through overlays or eject; the hard safety rules stay in code
- **Status:** Accepted, recorded in decisions.md as D-088 (2026-10-26, phase 3a). The `atf/` rule refuses framework agents, and calls a host can't attribute during a run; a human's own session may write there (user, 2026-10-26) · **Date:** 2026-10-24 · **Source:** conversation with the user, 2026-10-24
- **Decision:**
  - **One loader.** Every framework config file is read through `scripts/lib/config.mjs`:
    - an ejected `atf/config/<file>` replaces the package's;
    - otherwise an overlay `atf/<file>` is deep-merged over it (maps merge, lists replace, `null` deletes);
    - the result is schema-checked and frozen per run (D-006).
  - **Hooks stay mandatory.** No override can turn off the PreToolUse hook.
  - **Code-level rules stay fixed:** the readonly default and mode cap, ledger-scoped deletes, fail-closed behaviour and agent identity.
  - **Humans only.** Agents may not write under `atf/` (extends D-013).
  - **Shown in provenance.** `run.json` records which files were overlaid or ejected, with digests, and the report flags a custom `permissions.yaml`.
- **Why:** the user wants clients in control of their own setup. Keeping the hard rules in code means an override changes who may do what, never whether a readonly run stays readonly.
- **Affects:** `scripts/lib/permissions.mjs`, `scripts/lib/provenance.mjs`, `config/permissions.yaml`
- **Confirmed by the user on:** — (extends D-006, D-013 and D-077 without weakening them)

### P-5 · Clients extend an agent with an add-on fragment; they never replace its body
- **Status:** Accepted, recorded in decisions.md as D-090 (2026-10-26, phase 3b) · **Date:** 2026-10-24 · **Source:** conversation with the user, 2026-10-24
- **Decision:**
  - **Appended at sync.** `atf/agents/<name>.extra.md` is appended at sync under a fixed heading.
  - **Linted as a whole.** The body lint (`forbidden_in_body`, `body_limit`) runs on the combined text.
  - **Frontmatter untouched.** A fragment can't change frontmatter.
  - **Known agents only.** A fragment for an unknown agent fails `sync`.
- **Why:** clients need house rules, but prompt fixes must keep flowing with upgrades. A replaced body would stop receiving them.
- **Affects:** `scripts/lib/agents/source.mjs`, `scripts/lib/agents/lint.mjs`
- **Confirmed by the user on:** — (extends D-018 and D-019 without weakening them)

### P-6 · Each client workspace has its own decision log; the framework's log stays internal
- **Status:** Accepted, recorded in decisions.md as D-091 (2026-10-26, phase 3b): the log is named in `atf/atf.json`, default `atf/decisions.md` · **Date:** 2026-10-24 · **Source:** conversation with the user, 2026-10-24
- **Decision:**
  - **Created by init.** `atf init` creates an empty `atf/decisions.md` with the same rules and format.
  - **Same tooling.** `decisions.mjs` (lookup and the confirmation hook) reads the workspace's log.
  - **Ours stays internal.** `docs/decisions.md` is never shipped.
  - **Agents point at the workspace log.** Agents that cite the log cite `atf/decisions.md`.
- **Why:** clients make their own lasting choices (overlays, fragments, conventions). Our rationale is internal IP and governs a framework clients can't edit.
- **Affects:** `scripts/lib/decisions.mjs`, `scripts/decisions.mjs`
- **Confirmed by the user on:** — (extends D-031 and D-082 without weakening them)

### P-7 · `feedback-implementor-agent` fixes a run's outputs, not the framework
- **Status:** Accepted, recorded in decisions.md as D-096 (2026-10-27, phase 5) · **Date:** 2026-10-24 · **Source:** conversation with the user, 2026-10-24 ("designed to fix the issues reported in testcase generation or playwright tests etc, the actual outputs of this framework")
- **Decision:**
  - **New scope.** The agent takes feedback about a run's outputs (knowledge, test cases, catalogue and plans, Playwright and k6 code, report narrative) and fixes them only through each domain's overlays and slots, followed by that domain's `check`.
  - **Re-approval.** Changed test cases return to human approval.
  - **Resolution still checked.** `feedback.mjs check` keeps verifying the Resolution. "A test per script change" becomes "the domain's check passes".
  - **Out of reach:** the framework, `atf/`, the host files and managed files.
  - **Framework maintenance** moves to a dev-only `framework-implementor-agent` in the monorepo, never shipped, which keeps D-062's checks (Q5).
- **Why:** in a client install the framework is read-only, and the user's intent for this agent was always the outputs.
- **Affects:** `agents/feedback-implementor-agent.md`, `scripts/feedback.mjs`, `scripts/lib/feedback.mjs`, `config/permissions.yaml`, `docs/conventions.md`
- **Supersedes:** D-062 (its write scope and the test-per-change rule) · **Confirmed by the user on:** —

### P-8 · Framework issues leave a client workspace only as a redacted export bundle
- **Status:** Accepted, recorded in decisions.md as D-097 (2026-10-27, phase 5) · **Date:** 2026-10-24 · **Source:** conversation with the user, 2026-10-24
- **Decision:**
  - **End of run.** `run.mjs end` keeps the issues in the run's `framework-issues.json` and no longer writes `feedback/run-*`.
  - **Export.** `atf issues export` writes a redacted zip: the issues, the versions, the config customizations, and evidence with hosts, URLs, emails and secret-like values replaced. Screenshots and bodies are included only on request, and every redaction is listed in a manifest. The client sees it before it is written.
  - **Import.** `atf issues import` in the monorepo turns a bundle into maintainer feedback files.
- **Why:** framework issues are ours to fix, and client product data must not leave without the client seeing exactly what goes.
- **Affects:** `scripts/framework-issues.mjs`, `scripts/lib/framework-issues.mjs`, `scripts/run.mjs`
- **Supersedes:** D-083 (where the issues go at run end) · **Confirmed by the user on:** —

### P-9 · Semver with tested artifact migrations; a run never resumes across a major
- **Status:** Accepted, recorded in decisions.md as D-095 (2026-10-26, phase 4) · **Date:** 2026-10-24 · **Source:** conversation with the user, 2026-10-24
- **Decision:**
  - **Contract version.** `LAYOUT_VERSION` becomes the artifact-contract version, recorded in `atf/atf.json` and `run.json`. Provenance adds the package and plugin versions.
  - **Within a major.** Patch and minor releases read every artifact of their major, checked against frozen workspace fixtures in CI.
  - **Across a major.** A contract change ships pure, idempotent, tested `migrations/` that `atf migrate` applies under the lock, with a backup.
  - **Resume.** `resume` refuses a run from another major or an unmigrated workspace.
- **Why:** clients keep long-lived knowledge, catalogues and test cases. An upgrade must not lose them, or silently misread them.
- **Affects:** `scripts/lib/contract.mjs`, `scripts/run.mjs`, `scripts/lib/provenance.mjs`, `schemas/run.schema.json`
- **Confirmed by the user on:** — (extends D-071, D-072 and D-077 without weakening them)

### P-10 · A cross-platform `atf` CLI replaces the Makefile; macOS, Windows and Linux are supported
- **Status:** Accepted in part, recorded in decisions.md as D-087 (2026-10-26): the CLI covers every former `make` target, and CI runs on all three systems. `init`, `sync`, `check`, `eject`, `migrate` and `issues` come with phases 3 to 5, which extend D-087. D-087 extends D-066, D-069, D-075, D-081 and D-084 instead of superseding them (user, 2026-10-26) · **Date:** 2026-10-24 · **Source:** conversation with the user, 2026-10-24
- **Decision:**
  - **The CLI.** The `atf` bin provides `init`, `sync`, `check`, `doctor`, `eject`, `migrate`, `issues` and every former `make` target, with `--env` for `ENV=`.
  - **Portable.** The CLI and the hooks use only Node APIs, and CI runs the test suite on all three operating systems.
  - **The Makefile goes.** The `make e2e` harness becomes `atf e2e` in the monorepo only.
- **Why:** client machines include corporate Windows laptops without `make`, and one command surface is easier to document and support.
- **Affects:** `Makefile`, `scripts/e2e.mjs`, `scripts/run.mjs`
- **Supersedes:** the `make` parts of D-069, D-081 and D-084 · **Confirmed by the user on:** —

### P-11 · Claude Code also gets a private plugin, version-locked to the npm package
- **Status:** Accepted, recorded in decisions.md as D-098 (2026-10-27, phase 6): the guard stays in project settings, not in the plugin · **Date:** 2026-10-24 · **Source:** conversation with the user, 2026-10-24
- **Decision:**
  - **What it carries.** A private plugin marketplace carries the Claude Code agents, the hook registration and the MCP servers.
  - **Script calls.** They still use the workspace's npm package.
  - **Version lock.** `doctor` and the pre-flight refuse a plugin whose version differs from the package's.
  - **Identity.** The Claude adapter maps a plugin agent's `agent_type` to the bare agent name, and nothing else (D-021).
  - **Releases.** Both are released from the same commit.
- **Why:** plugin install and update is the native path for Claude Code users. Locking the versions keeps one source of truth.
- **Affects:** `scripts/hooks/hosts/claude.mjs`, `scripts/lib/doctor.mjs`
- **Confirmed by the user on:** — (extends D-020 and D-021 without weakening them)

### P-12 · The VS Code extension, when built, is a UI over the CLI with no safety role
- **Status:** Accepted, recorded in decisions.md as D-099 (2026-10-29, phase 7): published publicly, approval through the sheet and a terminal · **Date:** 2026-10-24 · **Source:** conversation with the user, 2026-10-24
- **Decision:**
  - **What it does.** The extension shows run status, the clarifications and approval sheets, and the report, and runs CLI commands.
  - **Through the scripts.** It writes artifacts only through their scripts.
  - **No safety role.** It never registers, replaces or bypasses the hooks.
- **Why:** humans need a better interface for approvals and clarifications. Safety must stay in the one guard every host runs (D-020).
- **Affects:** `docs/packaging.md`
- **Confirmed by the user on:** —
