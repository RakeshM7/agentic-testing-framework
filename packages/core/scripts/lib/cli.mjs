// The `atf` command line (D-087), behind packages/core/bin/atf.mjs. It replaces the Makefile: the same targets, typed
// the same way on macOS, Windows and Linux, with Node APIs only (no make, no sh, no sed). Humans type these commands;
// agents never call atf, and the guard refuses its human-only forms to every tool call (scripts/lib/guard.mjs).
//
// plan() turns argv into the steps to run -- a framework script, npm/npx, or the host CLI that opens the
// orchestrator-agent session -- or an error, and never touches the disk beyond reading it; run() executes the steps
// in order in the workspace, stopping at the first one that fails, as make did.
//
// The guard matches `atf approve`, `atf import … --approved` and `atf sweep` literally, so the parser accepts no
// command alias or abbreviation and no `--approved=<value>` (node:util parseArgs, strict).
//
// `atf sync --postinstall` is the package's npm postinstall (packaging §3.3): it renders the host files of the
// workspace `npm install` ran in (INIT_CWD), and never fails the install. It does nothing for a framework that is not
// installed, so `npm ci` in the monorepo can't regenerate the committed files the drift check compares (D-018).
//
// `atf init [dir]` creates a client's workspace (packaging §3.3, §3.6, §3.7; scripts/lib/init.mjs): the files it lacks,
// never overwriting one, then the install and sync that make the host files, and the doctor's base checks. It is the
// one command that runs outside a workspace, since it makes one.
//
// `atf version [--json]` says what is running (docs/packaging.md §3.10): the package's name and version, the artifact
// contract it reads and writes, the contract the workspace records, Node.js and the plugin. It reads only, and works
// outside a workspace too.
//
// `atf migrate [--dry-run]` brings the workspace's artifacts to this package's artifact contract (docs/packaging.md
// §3.10; scripts/lib/migrate.mjs): every product and environment at once, so it takes no --env. It runs in a child node,
// since the migration is async and run() is not.
//
// `atf issues export|import` (docs/packaging.md §3.9, draft P-8; scripts/lib/issues-bundle.mjs): export writes the
// redacted bundle of the framework issues agents recorded, after a preview and a typed `yes` on the human's terminal
// (or --yes); import, in the framework's source checkout only, turns a client's bundle into feedback files. Both cover
// every product and environment, so neither takes --env. They run in a child node, since export asks on the terminal
// and run() is synchronous. Exactly the words export and import, like every command.
import { spawnSync } from "node:child_process";
import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { CONFIG_FILES, configPath } from "./config.mjs";
import { CONTRACT_VERSION, SLUG_RE, STAGES, UNRECORDED_CONTRACT, contractProblem, workspaceContract } from "./contract.mjs";
import { DOCTOR_BASE_SCRIPT, applyInit, initPlan, initRefusal, installedIn } from "./init.mjs";
import { packageOf } from "./provenance.mjs";
import { WORKSPACE_MARKER, expandFw, findWorkspace, frameworkRel, frameworkRoot, isInstalled, isWithin, sameDir, workspaceRoot } from "./roots.mjs";
import { SETUP_WORKFLOW, TOKEN_ENV, sync } from "./sync.mjs";

export const USAGE = `atf <command> [<product>] [options]       every command works the same on macOS, Windows and Linux

One-time setup:
  atf init [<dir>] [--no-install]                   create a test workspace here (or in <dir>): package.json, .npmrc,
                                                    .gitignore, atf/, AGENTS.md, config/, .vscode/settings.json; then
                                                    npm install, sync and a dependency check. Never overwrites a file
  atf setup                                         install dependencies and a browser
  atf config <product> --url <url> [--no-login]     create config/<product>.yaml from the example, then log in
  atf interview                                     or: the orchestrator asks a few questions and writes the config
  atf login <product> [--wait <seconds>]            log in once in Microsoft Edge and save the session (default 60 s)
  atf validate <product>                            check the run-config
  atf doctor <product> [--no-fix]                   check (and install what it safely can) what every stage needs;
                                                    login, run, resume and automate run it first
  atf e2e [--keep]                                  the live end-to-end check (framework source checkout only)
  atf version [--json]                              the package and its version, the artifact contract, the
                                                    workspace's recorded contract, Node.js and the plugin

Upgrading:
  atf migrate [--dry-run]                           bring the workspace's artifacts to this package's artifact
                                                    contract, after an upgrade that changes it: backs up the run
                                                    state, then applies the package's migrations (--dry-run: show
                                                    them, write nothing)

Framework issues (problems the agents met with the framework itself, kept in each run's results):
  atf issues export [--run <id> | --since <YYYY-MM-DD>] [--include-evidence] [--client <name>] [--out <dir>]
                    [--yes] [--dry-run]             write atf-issues-<client>-<date>.zip, redacted, for the
                                                    framework's maintainers: shows every entry, issue and redaction,
                                                    then asks you to type yes (--yes: don't ask; --dry-run: show only).
                                                    Screenshots, network bodies and large files only with
                                                    --include-evidence
  atf issues import <zip> [--out <dir>]             turn a client's bundle into feedback files under
                                                    feedback/client-<client>-<date>/ (framework source checkout only)

Host files (the agents, hooks and MCP config of Claude Code, Copilot and VS Code):
  atf sync                                          render them from the installed package and atf/; npm install
                                                    runs it too
  atf check                                         fail when they are out of date, or atf/ has an error

Config:
  atf eject config [<file>]                         copy the package's config/<file> (or all five) to atf/config/,
                                                    where it replaces the package's copy entirely; never overwrites

Running and resuming (a finished stage stays done):
  atf run <product>                                 start the run, or continue the active one
  atf status <product>                              every stage and whether it is done
  atf next <product>                                what the run does next
  atf diff <product> [<run-a> <run-b>]              what changed between two ended runs (default: the last two)
  atf resume <product> --stage <stage> [--module <m>]   any stage, optionally one module
  atf explore|clarifications|testcases|k6|report <product> [--module <m>]   continue from that stage
  atf automate <product> [--module <m>]             Playwright UI + API tests (needs approved cases)
  atf steps <product> <steps>                       choose the run's steps, e.g. explore,testcases
  atf import <product> <module> [--file <f>] [--approved]   bring in your own test case file
  atf approve <product> <module>                    sign off a module's test cases (your own terminal)
  atf sweep <product> [--run <id>] [--dry-run]      between runs, delete what ended runs left in the target
                                                    (full-run config; your own terminal)

Options for every command:
  --env <env>        another environment of the product: config/<product>-<env>.yaml, run with ATF_ENV=<env>
  --host claude|copilot   the CLI that opens the orchestrator-agent session (default claude); ATF_AGENT="<command>"
                     overrides it with any command that takes the first prompt as its last argument`;

// The commands that open an orchestrator-agent session with a first prompt.
export const HOSTS = {
  claude: ["claude", "--agent", "orchestrator-agent"],
  copilot: ["copilot", "--agent", "orchestrator-agent", "-i"],
};
const STAGE_SHORTCUTS = ["explore", "clarifications", "testcases", "k6", "report"];
const STAGE_NAMES = Object.keys(STAGES);

const COMMON = { env: { type: "string" }, host: { type: "string" }, help: { type: "boolean", short: "h" } };
// positionals: names, `?` optional, `...` the rest
const COMMANDS = {
  help: { args: [] },
  init: { args: ["dir?"], options: { "no-install": { type: "boolean" } } },
  setup: { args: [] },
  config: { args: ["product"], options: { url: { type: "string" }, "no-login": { type: "boolean" } } },
  interview: { args: [] },
  login: { args: ["product"], options: { wait: { type: "string" } } },
  validate: { args: ["product"] },
  doctor: { args: ["product"], options: { "no-fix": { type: "boolean" } } },
  e2e: { args: [], options: { keep: { type: "boolean" } } },
  version: { args: [], options: { json: { type: "boolean" } } },
  migrate: { args: [], options: { "dry-run": { type: "boolean" } } },
  issues: {
    args: ["subcommand", "rest..."],
    options: { run: { type: "string" }, since: { type: "string" }, "include-evidence": { type: "boolean" }, client: { type: "string" }, out: { type: "string" }, yes: { type: "boolean" }, "dry-run": { type: "boolean" } },
  },
  sync: { args: [], options: { postinstall: { type: "boolean" } } },
  check: { args: [] },
  eject: { args: ["subcommand", "file..."] },
  status: { args: ["product"] },
  next: { args: ["product"] },
  diff: { args: ["product", "runs..."] },
  run: { args: ["product"] },
  resume: { args: ["product"], options: { stage: { type: "string" }, module: { type: "string" } } },
  ...Object.fromEntries(STAGE_SHORTCUTS.map((s) => [s, { args: ["product"], options: { module: { type: "string" } } }])),
  automate: { args: ["product"], options: { module: { type: "string" } } },
  steps: { args: ["product", "steps"] },
  import: { args: ["product", "module"], options: { file: { type: "string" }, approved: { type: "boolean" } } },
  approve: { args: ["product", "module"] },
  sweep: { args: ["product"], options: { run: { type: "string" }, "dry-run": { type: "boolean" } } },
};

const fail = (error) => ({ error });

// argv -> { steps: [{ cmd, args, env?, agent?, cwd?, failNote? } | { write } | { eject } | { sync, failNote? } | { init } |
// { say }], notes?, postinstall?, standalone? } | { print } | { error }. `ctx` carries what the plan reads from outside: env, cwd, workspace, framework, exists(file).
export function plan(argv, ctx = {}) {
  const { env = process.env, cwd = process.cwd(), workspace = workspaceRoot, framework = frameworkRoot, exists = existsSync } = ctx;
  const [name = "help", ...rest] = argv;
  if (name === "--help" || name === "-h") return { print: USAGE };
  const spec = Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : null;
  if (!spec) return fail(`unknown command '${name}'. Run atf help for the list.`);
  let parsed;
  try {
    parsed = parseArgs({ args: rest, options: { ...COMMON, ...spec.options }, strict: true, allowPositionals: true });
  } catch (e) {
    return fail(`atf ${name}: ${e.message}`);
  }
  const { values: v, positionals } = parsed;
  if (name === "help" || v.help) return { print: USAGE };

  const named = {};
  const required = spec.args.filter((a) => !a.endsWith("...") && !a.endsWith("?"));
  const optional = spec.args.filter((a) => a.endsWith("?")).map((a) => a.slice(0, -1));
  const known = required.length + optional.length;
  if (positionals.length < required.length) return fail(`atf ${name} needs ${required.map((a) => `<${a}>`).join(" ")}, e.g. ${example(name)}`);
  if (positionals.length > known && !spec.args.some((a) => a.endsWith("..."))) return fail(`atf ${name}: unexpected '${positionals[known]}'`);
  [...required, ...optional].forEach((a, i) => (named[a] = positionals[i]));
  const extra = positionals.slice(known);
  for (const k of ["product", "module"]) if (named[k] !== undefined && !SLUG_RE.test(named[k])) return fail(`<${k}> '${named[k]}' must be a lowercase kebab-case slug`);
  if (v.module !== undefined && !SLUG_RE.test(v.module)) return fail(`--module '${v.module}' must be a lowercase kebab-case slug`);
  if (v.env !== undefined && !SLUG_RE.test(v.env)) return fail(`--env '${v.env}' must be a lowercase kebab-case environment name`);

  const rel = frameworkRel(workspace, framework);
  const script = (s) => path.join(framework, "scripts", s);
  const node = (s, ...args) => ({ cmd: process.execPath, args: [script(s), ...args] });
  const childEnv = v.env ? { ATF_ENV: v.env } : {};
  const product = named.product;
  const config = product && `config/${product}${v.env ? `-${v.env}` : ""}.yaml`;
  const hasConfig = () => config && exists(path.join(workspace, config));
  const doctor = (...flags) => node("doctor.mjs", config, ...flags);
  const fix = v["no-fix"] ? [] : ["--fix"];
  const agent = (prompt) => {
    const launch = agentCommand(v.host, env);
    if (launch.error) return launch;
    return { cmd: launch.cmd[0], args: [...launch.cmd.slice(1), expandFw(prompt, rel)], agent: true };
  };
  const steps = (...list) => {
    const bad = list.find((s) => s.error);
    return bad ? fail(bad.error) : { steps: list.map((s) => ({ ...s, env: { ...childEnv, ...s.env } })) };
  };
  const needConfig = (hint = "") => (hasConfig() ? null : fail(`No ${config}${hint}`));

  switch (name) {
    case "init":
      return initCommand({ dir: path.resolve(cwd, named.dir ?? "."), framework, cwd, noInstall: Boolean(v["no-install"]) });
    case "setup":
      return steps({ cmd: "npm", args: ["install"], shell: true }, { cmd: "npx", args: ["playwright", "install", "chromium"], shell: true });
    case "config": {
      if (!v.url) return fail(`atf config needs --url <target url>, e.g. atf config ${product} --url https://crm.example.com`);
      if (!/^https?:\/\/\S+$/i.test(v.url)) return fail(`--url '${v.url}' must be an http(s) URL`);
      if (hasConfig()) return fail(`${config} already exists; edit it instead`);
      const write = { write: { file: config, from: path.join(framework, "config", "run-config.example.yaml"), product, url: v.url } };
      const notes = [
        `Created ${config}. Still to fill in by hand: modules, knowledge.references, testcases.output_format.`,
        "authorizations.mode stays readonly; set full-run yourself only for a target you are authorized to test.",
      ];
      if (v["no-login"]) return { steps: [write], notes };
      return { steps: [write, { ...doctor("--for", "login", "--fix"), env: childEnv }, { ...node("run.mjs", "login", config, "--seconds", "60"), env: childEnv }], notes };
    }
    case "interview":
      return steps(agent("I have no run-config yet. Interview me for it (short, one message of questions), draft it with node {fw}/scripts/run-config.mjs draft, show me the summary, then start the run if I say so."));
    case "login": {
      const wait = v.wait ?? "60";
      if (!/^[1-9]\d*$/.test(wait)) return fail(`--wait '${wait}' must be a whole number of seconds`);
      return needConfig(`. Run atf config ${product} --url <target url> first`) ?? steps(doctor("--for", "login", ...fix), node("run.mjs", "login", config, "--seconds", wait));
    }
    case "validate":
      return steps(node("run-config.mjs", "validate", config));
    case "doctor":
      return needConfig() ?? steps(doctor(...fix));
    case "e2e":
      if (isInstalled(framework)) return fail("atf e2e runs only in the framework's source checkout, not from an installed package");
      return steps(node("e2e.mjs", ...(v.keep ? ["--keep"] : [])));
    case "version":
      return { print: versionText(versionInfo({ workspace, framework }), { json: Boolean(v.json) }) };
    case "migrate":
      if (v.env) return fail("atf migrate migrates every product and environment of the workspace at once: it takes no --env");
      return steps({ cmd: process.execPath, args: ["--input-type=module", "-e", MIGRATE_SCRIPT, workspace, framework, ...(v["dry-run"] ? ["--dry-run"] : [])] });
    case "issues":
      return issuesCommand({ sub: named.subcommand, extra, v, cwd, workspace, framework });
    case "sync":
      return v.postinstall ? postinstallPlan({ env, cwd, framework }) : { steps: [{ sync: { workspace, framework } }] };
    case "check":
      return { steps: [{ sync: { workspace, framework, check: true } }] };
    case "eject": {
      // An ejected atf/config/<file> is the whole file from then on (packaging §3.4): the package's copy and any overlay
      // atf/<file> are no longer read, so an upgrade can't change it. Every target is checked before anything is
      // written, and an existing one is never overwritten: a human's edits to an ejected file are theirs to keep.
      if (named.subcommand !== "config") return fail(`atf eject takes config, not '${named.subcommand}', e.g. ${example(name)}`);
      if (extra.length > 1) return fail(`atf eject config: unexpected '${extra[1]}'`);
      // In one directory atf/config would sit inside the framework itself, next to the config/ it replaces.
      if (sameDir(workspace, framework)) return fail("atf eject config needs a workspace apart from the framework: here they are the same directory, so the framework's config/ is already the only copy");
      const wanted = extra[0] === undefined ? CONFIG_FILES : [extra[0].endsWith(".yaml") ? extra[0] : `${extra[0]}.yaml`];
      if (!CONFIG_FILES.includes(wanted[0])) return fail(`atf eject config: '${extra[0]}' is not a framework config file (one of: ${CONFIG_FILES.join(", ")})`);
      const files = wanted.map((f) => ({ name: f, file: `atf/config/${f}`, from: configPath(f, { framework }) }));
      const missing = files.filter((f) => !exists(f.from));
      if (missing.length) return fail(`the framework has no ${missing.map((f) => f.from).join(", ")}; reinstall the package`);
      const ejected = files.filter((f) => exists(path.join(workspace, f.file)));
      if (ejected.length) return fail(alreadyEjected(ejected));
      const overlay = files.length === 1 ? `atf/${files[0].name}` : "atf/<file>";
      const notes = [
        `${files.length === 1 ? `${files[0].file} now replaces the package's config/${files[0].name}` : "Each ejected file now replaces the package's copy"} entirely: later package upgrades won't change it, and an overlay ${overlay} for it is ignored.`,
        ...(files.some((f) => f.name === "permissions.yaml") ? ["atf/config/permissions.yaml is the agents' safety ceiling, frozen into each run when it starts: have a human review every change to it."] : []),
      ];
      return { steps: [{ eject: files.map(({ file, from }) => ({ file, from })) }], notes };
    }
    case "status":
    case "next":
      return steps(node("run.mjs", name, product));
    case "diff":
      if (extra.length !== 0 && extra.length !== 2) return fail("atf diff takes two run ids, or none for the last two");
      return steps(node("run.mjs", "diff", product, ...extra));
    case "run":
      return (
        needConfig(`. Run atf config ${product} --url <target url>, or atf interview to be asked instead`) ??
        steps(doctor("--fix", "--warn-only"), agent(`Start or resume the run for ${config}: node {fw}/scripts/run.mjs init ${config} (add --resume when a run is active), then follow run.mjs next. Finished stages stay done.`))
      );
    case "resume":
    case "explore":
    case "clarifications":
    case "testcases":
    case "k6":
    case "report": {
      const stage = name === "resume" ? v.stage : name;
      if (!stage) return fail(`atf resume needs --stage <one of: ${STAGE_NAMES.join(" ")}>, or use atf run to continue wherever the run stands`);
      if (!STAGE_NAMES.includes(stage)) return fail(`Unknown --stage ${stage}. One of: ${STAGE_NAMES.join(" ")}`);
      return (
        needConfig() ??
        steps(doctor("--fix", "--stage", stage), agent(`Resume the active run for ${config} (node {fw}/scripts/run.mjs init ${config} --resume; if none is active, start one). Do not redo completed stages. Start only the ${stage} stage${v.module ? ` for module ${v.module}` : ""} and the stages that depend on it, following run.mjs next; skip every other stage.`))
      );
    }
    case "automate":
      return (
        needConfig() ??
        steps(doctor("--fix", "--stage", "playwright-ui,playwright-api"), agent(`Resume the active run for ${config} (node {fw}/scripts/run.mjs init ${config} --resume). Do not redo completed stages. Start only the playwright-ui and playwright-api stages${v.module ? ` for module ${v.module}` : ""} and what they unlock, following run.mjs next. A module with no human-approved test case is awaiting-approval: report it, do not force it.`))
      );
    case "steps":
      return steps(node("run-config.mjs", "set", config, "--steps", named.steps));
    case "import":
      return steps(node("testcases.mjs", "import", product, named.module, ...(v.file ? ["--file", v.file] : []), ...(v.approved ? ["--approved"] : [])));
    case "approve":
      return steps(node("testcases.mjs", "approve", product, named.module));
    case "sweep":
      return steps(node("ledger.mjs", "sweep", product, ...(v.run ? ["--run", v.run] : []), ...(v["dry-run"] ? ["--dry-run"] : [])));
  }
  return fail(`atf ${name}: not implemented`);
}

// What `atf version` reports. The workspace is none when an installed framework has no workspace around it (the one
// case main() would refuse for any other command); one directory that is both reads its own marker, if any.
// -> { package: {name, version} | null, contract, workspace: null | {root, contract, recorded, problem?} | {root, error},
//      node, plugin: null }
export function versionInfo({ workspace = workspaceRoot, framework = frameworkRoot, node = process.version } = {}) {
  let ws = null;
  if (!(sameDir(workspace, framework) && isInstalled(framework))) {
    const w = workspaceContract(workspace);
    const problem = !w.error && contractProblem(workspace);
    ws = { root: workspace, ...w, ...(problem ? { problem: `${problem.detail}. Fix: ${problem.fix}` } : {}) };
  }
  // plugin: the Claude Code plugin's version, locked to the package's (packaging §3.12), from phase 6
  return { package: packageOf(framework), contract: CONTRACT_VERSION, workspace: ws, node, plugin: null };
}

export function versionText(info, { json = false } = {}) {
  if (json) return JSON.stringify(info, null, 2);
  const w = info.workspace;
  const ws = !w
    ? "none (not inside an atf workspace)"
    : w.error
      ? `unreadable: ${w.error}`
      : w.recorded
        ? `${w.contract} (${WORKSPACE_MARKER})`
        : `not recorded, ${UNRECORDED_CONTRACT} assumed`;
  return [
    info.package ? `${info.package.name} ${info.package.version}` : "package: unknown (the framework's package.json can't be read)",
    `artifact contract: ${info.contract}`,
    `workspace contract: ${ws}`,
    ...(w?.problem ? [`  ${w.problem}`] : []),
    `Node.js: ${info.node}`,
    `plugin: ${info.plugin ? `${info.plugin.name} ${info.plugin.version}` : "none"}`,
  ].join("\n");
}

// atf init's steps. `standalone`: it runs outside any workspace (main() skips workspaceError), since it makes one.
//   1. the files (init.mjs initPlan, read here; written by run(), which reports each one)
//   2. the host files: in process when this framework is the one installed in `dir`; otherwise npm install renders them
//      through the package's postinstall. npm install also runs when init added a dependency to package.json.
//   3. the doctor's base group in a child node, on the framework installed there (init.mjs DOCTOR_BASE_SCRIPT)
//   4. the next steps
// --no-install skips the install and the check (they need the package from the registry) and names the install as
// the first next step instead. A step after the files that fails says what is in place and what is not (failNote), and
// exits 1.
function initCommand({ dir, framework, cwd, noInstall }) {
  const refusal = initRefusal(dir, framework);
  if (refusal) return fail(refusal);
  let p;
  try {
    p = initPlan({ dir, framework });
  } catch (e) {
    p = { actions: [], errors: [`can't read the framework's package or templates in ${framework} (${e.message}); reinstall the package`] };
  }
  const here = installedIn(dir, framework);
  const needsInstall = !here || p.depsAdded;
  const steps = [{ init: { dir, actions: p.actions, errors: p.errors } }];
  if (here) steps.push({ sync: { workspace: dir, framework }, failNote: `atf init: the workspace files above are in place, but the host files were not rendered. Fix the error above, then run ${SYNC_FIX} in ${dir}.` });
  if (needsInstall && !noInstall)
    steps.push({ cmd: "npm", args: ["install"], shell: true, cwd: dir, failNote: `atf init: the workspace files above are in place, but npm install failed, so the framework and its dependencies are not installed in ${dir} and the host files were not rendered. Fix the error above, then run npm install there: its postinstall renders the host files.` });
  if (!noInstall) steps.push({ cmd: process.execPath, args: ["--input-type=module", "-e", DOCTOR_BASE_SCRIPT, dir, p.name ?? "@testagentic/atf"], cwd: dir, failNote: "atf init: the workspace is set up, but the dependency check above found a problem. Fix it as it says, then run npx atf check (the host files), or npx atf doctor <product> once you have a run-config." });
  const rel = path.relative(cwd, dir);
  const next = [
    ...(rel ? [`cd ${/\s/.test(rel) ? JSON.stringify(rel) : rel}`] : []),
    ...(needsInstall && noInstall ? ["npm install                                    installs the framework and Playwright, then renders the host files"] : []),
    "npx atf config <product> --url <target url>    create the product's run-config, then log in (or: npx atf interview)",
    "npx atf run <product>                          start the run",
  ];
  const say = ["", "Next:", ...next.map((l, i) => `  ${i + 1}. ${l}`), "Commit what init created; the host files sync renders stay git-ignored."];
  return { steps: [...steps, { say }], standalone: true };
}

// npm runs a dependency's postinstall in the package's own folder and sets INIT_CWD to the folder `npm install` ran
// in, so the workspace is the nearest atf/atf.json at or above INIT_CWD (the working directory without npm).
//   - a framework that is not installed (the monorepo's packages/core, linked by npm workspaces): nothing, silently;
//     its host files are committed and checked for drift, never regenerated by an install (D-018)
//   - no workspace yet (the package installed before atf init): one hint
//   - a framework installed somewhere else (a global install, run from inside some workspace): not this workspace's
//     package, so its paths must not land in this workspace's hook commands
// Every outcome exits 0: a postinstall must never fail the client's install (the doctor reports stale host files).
function postinstallPlan({ env, cwd, framework }) {
  if (!isInstalled(framework)) return { steps: [], postinstall: true };
  const from = path.resolve(env.INIT_CWD || cwd);
  const workspace = findWorkspace(from);
  if (!workspace) return { print: `atf: no atf workspace at ${from} (no atf/atf.json there or above): run npx atf init to create one; it renders the host files.`, postinstall: true };
  if (!isWithin(framework, workspace)) return { print: `atf: this @testagentic/atf (${framework}) is not installed in ${workspace}, so its host files were left as they are: run npx atf sync from the workspace.`, postinstall: true };
  return { steps: [{ sync: { workspace, framework, postinstall: true } }], postinstall: true };
}

const SYNC_FIX = "npx atf sync";

// atf migrate in a child node (argv: the workspace, the framework, then --dry-run or nothing): lib/migrate.mjs
// migrateWorkspace() is async (it imports the package's steps) while run() is synchronous, as with init.mjs
// DOCTOR_BASE_SCRIPT. Its exit code is the command's. The CLI never imports migrate.mjs itself: loaded by path, it stays
// its own module in the published build, where its import() of the steps is its own.
export const MIGRATE_SCRIPT = `
import path from "node:path";
import { pathToFileURL } from "node:url";
const [workspace, framework, flag] = process.argv.slice(1);
const { migrateWorkspace } = await import(pathToFileURL(path.join(framework, "scripts", "lib", "migrate.mjs")).href);
process.exitCode = await migrateWorkspace({ workspace, framework, dryRun: flag === "--dry-run" });
`;

// atf issues: its options checked here, so a mistyped one never reaches the child; the client name, the runs and the
// bundle are checked there (scripts/lib/issues-bundle.mjs). Paths are resolved from where the human typed the command,
// since the child runs in the workspace.
const ISSUES_EXPORT_ONLY = ["run", "since", "include-evidence", "client", "yes", "dry-run"];
function issuesCommand({ sub, extra, v, cwd, workspace, framework }) {
  if (sub !== "export" && sub !== "import") return fail(`atf issues takes export or import, not '${sub}', e.g. ${example("issues")}`);
  if (v.env) return fail(`atf issues ${sub} covers every product and environment of the workspace at once: it takes no --env`);
  const out = v.out === undefined ? {} : { out: path.resolve(cwd, v.out) };
  const child = (opts) => ({ steps: [{ cmd: process.execPath, args: ["--input-type=module", "-e", ISSUES_SCRIPT, workspace, framework, JSON.stringify(opts)] }] });
  if (sub === "import") {
    const wrong = ISSUES_EXPORT_ONLY.find((k) => v[k] !== undefined);
    if (wrong) return fail(`atf issues import takes <zip> and --out only, not --${wrong}`);
    if (!extra.length) return fail("atf issues import needs <zip>, e.g. atf issues import atf-issues-acme-2026-10-26.zip");
    if (extra.length > 1) return fail(`atf issues import: unexpected '${extra[1]}'`);
    if (isInstalled(framework)) return fail("atf issues import runs only in the framework's own source checkout, where its maintainers turn client bundles into feedback; here, atf issues export makes the bundle you send them");
    return child({ subcommand: "import", zip: path.resolve(cwd, extra[0]), ...out });
  }
  if (extra.length) return fail(`atf issues export: unexpected '${extra[0]}'`);
  if (v.run !== undefined && v.since !== undefined) return fail("atf issues export takes --run or --since, not both");
  if (v.run !== undefined && !SLUG_RE.test(v.run)) return fail(`--run '${v.run}' must be a run id (lowercase kebab-case)`);
  if (v.since !== undefined && !isDate(v.since)) return fail(`--since '${v.since}' must be a date, YYYY-MM-DD`);
  if (v.yes && v["dry-run"]) return fail("atf issues export takes --yes or --dry-run, not both");
  return child({ subcommand: "export", run: v.run, since: v.since, includeEvidence: Boolean(v["include-evidence"]), client: v.client, yes: Boolean(v.yes), dryRun: Boolean(v["dry-run"]), ...out });
}

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);

// atf issues in a child node (argv: the workspace, the framework, then the options as JSON), loaded by path like
// MIGRATE_SCRIPT so lib/issues-bundle.mjs stays its own module in the published build. stdio is inherited, so export's
// prompt reads the human's own terminal, and a non-terminal stdin makes it refuse without --yes.
export const ISSUES_SCRIPT = `
import path from "node:path";
import { pathToFileURL } from "node:url";
const [workspace, framework, json] = process.argv.slice(1);
const { issuesCommand } = await import(pathToFileURL(path.join(framework, "scripts", "lib", "issues-bundle.mjs")).href);
process.exitCode = await issuesCommand({ workspace, framework, ...JSON.parse(json) });
`;

// One sync or check: what changed, or what stops it. -> exit code (0 for every outcome of the postinstall).
function syncStep({ workspace, framework, check = false, postinstall = false }, out) {
  let r;
  try {
    r = sync({ workspace, framework, check });
  } catch (e) {
    r = { errors: [e.message], changed: [] };
  }
  const label = postinstall ? "atf sync (postinstall)" : `atf ${check ? "check" : "sync"}`;
  if (r.errors.length) {
    for (const e of r.errors) out.error(`${label}: error: ${e}`);
    if (postinstall) {
      out.error(`${label}: the host files were not updated; your install itself succeeded. Fix the error above, then run ${SYNC_FIX}.`);
      return 0;
    }
    out.error(check ? `Fix the error above, then run ${SYNC_FIX}.` : `Nothing was written. Fix the error above, then run ${SYNC_FIX} again.`);
    return 1;
  }
  const created = r.created ?? [];
  const problems = r.problems ?? [];
  for (const f of r.changed) out.log(`${label}: ${check ? "out of date" : "updated"}: ${f}`);
  // the cloud agent's setup workflow (atf.json "cloud_agent"): written once, then the client's
  for (const f of created) out.log(check ? `${label}: missing: ${f} (${SYNC_FIX} creates it)` : `${label}: created: ${f}: the Copilot cloud agent's setup steps, yours from now on. Commit it, merge it to the default branch, and add the Agents secret ${TOKEN_ENV}.`);
  // what sync never rewrites: a warning when syncing, a failure when checking
  for (const p of problems) out.error(`${label}: ${check ? "error" : "warning"}: ${p.detail}. Fix: ${p.fix}.`);
  const n = r.changed.length + created.length;
  if (check) {
    if (!n && !problems.length) return out.log(`${label}: the host files are in sync with the framework.`), 0;
    if (n) out.error(`${n} host file(s) out of date with the framework: run ${SYNC_FIX}.`);
    if (problems.length) out.error(`Fix ${SETUP_WORKFLOW} as above: atf sync never rewrites it.`);
    return 1;
  }
  out.log(n ? `${label}: ${n} file(s) updated.` : `${label}: the host files are up to date.`);
  return 0;
}

// atf init's files: an error the plan found writes nothing; otherwise every file is reported as created, updated or
// present. -> exit code
function initStep({ dir, actions, errors }, out) {
  out.log(`atf init: ${dir}`);
  if (errors.length) {
    for (const e of errors) out.error(`atf init: error: ${e}`);
    out.error("atf init: nothing was written.");
    return 1;
  }
  const r = applyInit({ dir, actions });
  for (const line of r.lines) if (/^(?: {2}FAILED|atf init stopped)/.test(line)) out.error(line); else out.log(line);
  return r.code;
}

const alreadyEjected = (files) =>
  `${files.map((f) => f.file).join(", ")} ${files.length === 1 ? "is" : "are"} already ejected; edit ${files.length === 1 ? "it" : "them"} instead. Nothing was written.`;

const example = (name) => {
  const ex = { config: "atf config acme-crm --url https://crm.example.com", eject: "atf eject config permissions.yaml", import: "atf import acme-crm contacts", approve: "atf approve acme-crm contacts", steps: "atf steps acme-crm explore,testcases", issues: "atf issues export --dry-run" };
  return ex[name] ?? `atf ${name} acme-crm`;
};

// The host CLI command: ATF_AGENT (split on whitespace; the prompt goes last) wins over --host.
export function agentCommand(host, env = process.env) {
  if (env.ATF_AGENT?.trim()) return { cmd: env.ATF_AGENT.trim().split(/\s+/) };
  const h = host ?? "claude";
  if (!Object.hasOwn(HOSTS, h)) return { error: `--host '${h}' must be one of: ${Object.keys(HOSTS).join(", ")} (or set ATF_AGENT to the full command)` };
  return { cmd: HOSTS[h] };
}

// A step through cmd.exe on Windows: npm, npx and most host CLIs are .cmd shims there, which only a shell starts. Each
// argument is double-quoted; one with a double quote or a percent sign, which cmd.exe would still read, is refused.
export function windowsCommandLine(cmd, args) {
  const bad = [cmd, ...args].find((a) => /["%\r\n]/.test(a));
  if (bad !== undefined) return { error: `can't pass ${JSON.stringify(bad)} through cmd.exe safely` };
  const quote = (a) => (a === "" || /[\s&|<>^()!,;=]/.test(a) ? `"${a}"` : a);
  return { line: [cmd, ...args].map(quote).join(" ") };
}

// The run-config the example makes for `atf config`: the same three lines `make config` rewrote with sed.
export function configFromExample(text, { product, url }) {
  return text.replace(/^product:.*$/m, `product: ${product}`).replace(/^ {2}url:.*$/m, `  url: ${url}`).replace(/^ {2}name: Acme CRM$/m, `  name: ${product}`);
}

// Executes a plan's steps in the workspace; returns the exit code. `spawn` is spawnSync's shape (tests stub it).
export function run(p, { workspace = workspaceRoot, platform = process.platform, spawn = spawnSync, out = console } = {}) {
  // a step with a failNote is one stage of a command that already changed something (atf init): it fails with 1 and
  // says what is in place and what is not
  const failed = (step, code) => (step.failNote ? (out.error(step.failNote), 1) : code);
  if (p.print) {
    out.log(p.print);
    return 0;
  }
  if (p.error) {
    out.error(p.error);
    return 2;
  }
  for (const step of p.steps) {
    if (step.sync) {
      const code = syncStep(step.sync, out);
      if (code) return failed(step, code);
      continue;
    }
    if (step.init) {
      const code = initStep(step.init, out);
      if (code) return code;
      continue;
    }
    if (step.say) {
      for (const line of step.say) out.log(line);
      continue;
    }
    if (step.write) {
      const target = path.join(workspace, step.write.file);
      if (existsSync(target)) {
        out.error(`${step.write.file} already exists; edit it instead`);
        return 1;
      }
      writeFileSync(target, configFromExample(readFileSync(step.write.from, "utf8"), step.write));
      for (const n of p.notes ?? []) out.log(n);
      continue;
    }
    if (step.eject) {
      // plan() checked the targets; checked again here, all before the first copy, so a file ejected meanwhile still
      // leaves nothing written. COPYFILE_EXCL keeps the never-overwrite promise even then, and copies byte for byte.
      const taken = step.eject.filter((e) => existsSync(path.join(workspace, e.file)));
      if (taken.length) {
        out.error(alreadyEjected(taken));
        return 1;
      }
      mkdirSync(path.join(workspace, "atf", "config"), { recursive: true });
      for (const e of step.eject) {
        copyFileSync(e.from, path.join(workspace, e.file), constants.COPYFILE_EXCL);
        out.log(`Ejected ${e.file}`);
      }
      for (const n of p.notes ?? []) out.log(n);
      continue;
    }
    const env = { ...process.env, ...step.env };
    const shell = platform === "win32" && (step.shell || step.agent);
    let r;
    if (shell) {
      const line = windowsCommandLine(step.cmd, step.args);
      if (line.error) {
        out.error(line.error);
        return 2;
      }
      r = spawn(line.line, [], { cwd: step.cwd ?? workspace, env, stdio: "inherit", shell: true });
    } else r = spawn(step.cmd, step.args, { cwd: step.cwd ?? workspace, env, stdio: "inherit" });
    if (r.error) {
      out.error(r.error.code === "ENOENT" ? `${step.cmd} not found on PATH${step.agent ? " (install it, or pick another with --host or ATF_AGENT)" : ""}` : r.error.message);
      return failed(step, 1);
    }
    if (r.status !== 0) return failed(step, r.status ?? 1);
  }
  return 0;
}

// The workspace a command works in must be a real one when the framework is installed: an installed package has no
// config/ of its own to run from.
export function workspaceError({ workspace = workspaceRoot, framework = frameworkRoot } = {}) {
  if (sameDir(workspace, framework) && isInstalled(framework)) return `not inside an atf workspace: no atf/atf.json in ${process.cwd()} or above it (or set ATF_WORKSPACE)`;
  return null;
}

export function main(argv, { out = console } = {}) {
  if (isPostinstall(argv)) return postinstall(argv, { out });
  const p = plan(argv);
  const wsErr = !p.print && !p.error && !p.standalone && workspaceError();
  return run(wsErr ? { error: wsErr } : p, { out });
}

// `--postinstall` is a flag of sync only: `atf check --postinstall` is refused by the parser, like any unknown option.
export const isPostinstall = (argv) => argv[0] === "sync" && argv.includes("--postinstall");

// The postinstall: the plan's own workspace (from INIT_CWD), not this process's, and exit 0 whatever happens, a
// usage error and an exception included, each printed with the command that fixes it.
export function postinstall(argv, { ctx, out = console } = {}) {
  try {
    const p = plan(argv, ctx);
    if (p.error) out.error(`atf sync (postinstall): ${p.error.replace(/\.$/, "")}. Run ${SYNC_FIX} from your workspace.`);
    else run(p, { out });
  } catch (e) {
    out.error(`atf sync (postinstall): ${e.message}. Your install itself succeeded; run ${SYNC_FIX} from your workspace.`);
  }
  return 0;
}
