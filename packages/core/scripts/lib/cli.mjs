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
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { SLUG_RE, STAGES } from "./contract.mjs";
import { expandFw, frameworkRel, frameworkRoot, isInstalled, sameDir, workspaceRoot } from "./roots.mjs";

export const USAGE = `atf <command> [<product>] [options]       every command works the same on macOS, Windows and Linux

One-time setup:
  atf setup                                         install dependencies and a browser
  atf config <product> --url <url> [--no-login]     create config/<product>.yaml from the example, then log in
  atf interview                                     or: the orchestrator asks a few questions and writes the config
  atf login <product> [--wait <seconds>]            log in once in Microsoft Edge and save the session (default 60 s)
  atf validate <product>                            check the run-config
  atf doctor <product> [--no-fix]                   check (and install what it safely can) what every stage needs;
                                                    login, run, resume and automate run it first
  atf e2e [--keep]                                  the live end-to-end check (framework source checkout only)

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
  setup: { args: [] },
  config: { args: ["product"], options: { url: { type: "string" }, "no-login": { type: "boolean" } } },
  interview: { args: [] },
  login: { args: ["product"], options: { wait: { type: "string" } } },
  validate: { args: ["product"] },
  doctor: { args: ["product"], options: { "no-fix": { type: "boolean" } } },
  e2e: { args: [], options: { keep: { type: "boolean" } } },
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

// argv -> { steps: [{ cmd, args, env?, agent? }], notes? } | { print } | { error }. `ctx` carries what the plan reads
// from outside: env, workspace, framework, exists(file).
export function plan(argv, ctx = {}) {
  const { env = process.env, workspace = workspaceRoot, framework = frameworkRoot, exists = existsSync } = ctx;
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
  const required = spec.args.filter((a) => !a.endsWith("..."));
  if (positionals.length < required.length) return fail(`atf ${name} needs ${required.map((a) => `<${a}>`).join(" ")}, e.g. ${example(name)}`);
  if (positionals.length > required.length && !spec.args.some((a) => a.endsWith("..."))) return fail(`atf ${name}: unexpected '${positionals[required.length]}'`);
  required.forEach((a, i) => (named[a] = positionals[i]));
  const extra = positionals.slice(required.length);
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

const example = (name) => {
  const ex = { config: "atf config acme-crm --url https://crm.example.com", import: "atf import acme-crm contacts", approve: "atf approve acme-crm contacts", steps: "atf steps acme-crm explore,testcases" };
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
  if (p.print) {
    out.log(p.print);
    return 0;
  }
  if (p.error) {
    out.error(p.error);
    return 2;
  }
  for (const step of p.steps) {
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
    const env = { ...process.env, ...step.env };
    const shell = platform === "win32" && (step.shell || step.agent);
    let r;
    if (shell) {
      const line = windowsCommandLine(step.cmd, step.args);
      if (line.error) {
        out.error(line.error);
        return 2;
      }
      r = spawn(line.line, [], { cwd: workspace, env, stdio: "inherit", shell: true });
    } else r = spawn(step.cmd, step.args, { cwd: workspace, env, stdio: "inherit" });
    if (r.error) {
      out.error(r.error.code === "ENOENT" ? `${step.cmd} not found on PATH${step.agent ? " (install it, or pick another with --host or ATF_AGENT)" : ""}` : r.error.message);
      return 1;
    }
    if (r.status !== 0) return r.status ?? 1;
  }
  return 0;
}

// The workspace a command works in must be a real one when the framework is installed: an installed package has no
// config/ of its own to run from.
export function workspaceError({ workspace = workspaceRoot, framework = frameworkRoot } = {}) {
  if (sameDir(workspace, framework) && isInstalled(framework)) return `not inside an atf workspace: no atf/atf.json in ${process.cwd()} or above it (or set ATF_WORKSPACE)`;
  return null;
}

export function main(argv) {
  const p = plan(argv);
  const wsErr = !p.print && !p.error && workspaceError();
  return run(wsErr ? { error: wsErr } : p);
}
