import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { HOSTS, USAGE, agentCommand, configFromExample, plan, run, windowsCommandLine, workspaceError } from "./lib/cli.mjs";
import { frameworkRoot } from "./lib/roots.mjs";
import { put, tempRoot } from "./test-helpers.mjs";

// A workspace apart from the framework, as in the monorepo and a client install: config/acme.yaml exists.
const ws = () => {
  const root = tempRoot();
  put(root, "atf/atf.json", "{}");
  put(root, "config/acme.yaml", "product: acme\n");
  return root;
};
const ctx = (workspace, extra = {}) => ({ workspace, framework: frameworkRoot, env: {}, ...extra });
const script = (s) => path.join(frameworkRoot, "scripts", s);
// a step as [program, ...args], the node binary and framework scripts shortened
const shown = (step) => [step.cmd === process.execPath ? "node" : step.cmd, ...step.args.map((a) => (a.startsWith(path.join(frameworkRoot, "scripts")) ? path.relative(frameworkRoot, a).replaceAll("\\", "/") : a))];

test("every make target has its atf command, with the same script calls", () => {
  const root = ws();
  const steps = (...argv) => {
    const p = plan(argv, ctx(root));
    assert.equal(p.error, undefined, `${argv.join(" ")}: ${p.error}`);
    return p.steps.map(shown);
  };
  assert.deepEqual(steps("setup"), [["npm", "install"], ["npx", "playwright", "install", "chromium"]]);
  assert.deepEqual(steps("validate", "acme"), [["node", "scripts/run-config.mjs", "validate", "config/acme.yaml"]]);
  assert.deepEqual(steps("doctor", "acme"), [["node", "scripts/doctor.mjs", "config/acme.yaml", "--fix"]]);
  assert.deepEqual(steps("doctor", "acme", "--no-fix"), [["node", "scripts/doctor.mjs", "config/acme.yaml"]]);
  assert.deepEqual(steps("login", "acme", "--wait", "120"), [
    ["node", "scripts/doctor.mjs", "config/acme.yaml", "--for", "login", "--fix"],
    ["node", "scripts/run.mjs", "login", "config/acme.yaml", "--seconds", "120"],
  ]);
  assert.deepEqual(steps("status", "acme"), [["node", "scripts/run.mjs", "status", "acme"]]);
  assert.deepEqual(steps("next", "acme"), [["node", "scripts/run.mjs", "next", "acme"]]);
  assert.deepEqual(steps("diff", "acme"), [["node", "scripts/run.mjs", "diff", "acme"]]);
  assert.deepEqual(steps("diff", "acme", "r1", "r2"), [["node", "scripts/run.mjs", "diff", "acme", "r1", "r2"]]);
  assert.deepEqual(steps("steps", "acme", "explore,testcases"), [["node", "scripts/run-config.mjs", "set", "config/acme.yaml", "--steps", "explore,testcases"]]);
  assert.deepEqual(steps("approve", "acme", "contacts"), [["node", "scripts/testcases.mjs", "approve", "acme", "contacts"]]);
  assert.deepEqual(steps("import", "acme", "contacts", "--file", "data/c.feature", "--approved"), [["node", "scripts/testcases.mjs", "import", "acme", "contacts", "--file", "data/c.feature", "--approved"]]);
  assert.deepEqual(steps("sweep", "acme", "--run", "acme-1", "--dry-run"), [["node", "scripts/ledger.mjs", "sweep", "acme", "--run", "acme-1", "--dry-run"]]);
  assert.deepEqual(steps("e2e", "--keep"), [["node", "scripts/e2e.mjs", "--keep"]]);
  assert.equal(plan(["status", "acme"], ctx(root)).steps[0].args[0], script("run.mjs"), "the framework's own script, by absolute path");
});

test("run, resume, the stage shortcuts, automate and interview check first, then open the orchestrator session", () => {
  const root = ws();
  const p = (...argv) => plan(argv, ctx(root));
  const run1 = p("run", "acme").steps;
  assert.deepEqual(shown(run1[0]), ["node", "scripts/doctor.mjs", "config/acme.yaml", "--fix", "--warn-only"]);
  assert.deepEqual(run1[1].args.slice(0, -1), ["--agent", "orchestrator-agent"]);
  assert.equal(run1[1].cmd, "claude");
  assert.equal(run1[1].agent, true);
  const prompt = run1[1].args.at(-1);
  assert.match(prompt, /^Start or resume the run for config\/acme\.yaml: node \S*scripts\/run\.mjs init config\/acme\.yaml/);
  assert.doesNotMatch(prompt, /\{fw\}/, "the prompt names the framework's real path");

  const k6 = p("k6", "acme", "--module", "deals").steps;
  assert.deepEqual(shown(k6[0]), ["node", "scripts/doctor.mjs", "config/acme.yaml", "--fix", "--stage", "k6"]);
  assert.match(k6[1].args.at(-1), /Start only the k6 stage for module deals and the stages that depend on it/);
  assert.deepEqual(shown(p("resume", "acme", "--stage", "api-discovery").steps[0]).slice(-2), ["--stage", "api-discovery"]);
  assert.match(p("resume", "acme").error, /needs --stage <one of: knowledge .* report>/);
  assert.match(p("resume", "acme", "--stage", "nope").error, /Unknown --stage nope/);
  assert.match(p("automate", "acme").steps[1].args.at(-1), /Start only the playwright-ui and playwright-api stages and what they unlock/);
  assert.deepEqual(shown(p("automate", "acme").steps[0]).slice(-2), ["--stage", "playwright-ui,playwright-api"]);
  assert.match(p("interview").steps[0].args.at(-1), /^I have no run-config yet\..* node \S*scripts\/run-config\.mjs draft/);
  // a missing config stops before anything runs
  assert.match(p("run", "other").error, /^No config\/other\.yaml\. Run atf config other --url <target url>, or atf interview/);
  assert.match(p("doctor", "other").error, /^No config\/other\.yaml/);
});

test("--host picks the session's CLI, ATF_AGENT overrides it, and an unknown host is refused", () => {
  const root = ws();
  const last = (argv, env = {}) => plan(argv, ctx(root, { env })).steps?.at(-1);
  assert.deepEqual([last(["run", "acme", "--host", "copilot"]).cmd, ...last(["run", "acme", "--host", "copilot"]).args.slice(0, -1)], HOSTS.copilot);
  const custom = last(["run", "acme"], { ATF_AGENT: "  my-cli  --agent  orchestrator-agent " });
  assert.deepEqual([custom.cmd, ...custom.args.slice(0, -1)], ["my-cli", "--agent", "orchestrator-agent"]);
  assert.match(plan(["run", "acme", "--host", "cursor"], ctx(root)).error, /--host 'cursor' must be one of: claude, copilot/);
  assert.deepEqual(agentCommand(undefined, {}).cmd, HOSTS.claude);
});

test("--env names the environment's config and runs every step with ATF_ENV (D-081)", () => {
  const root = ws();
  put(root, "config/acme-staging.yaml", "product: acme\nenvironment: staging\n");
  const p = plan(["run", "acme", "--env", "staging"], ctx(root));
  assert.deepEqual(shown(p.steps[0]).slice(0, 3), ["node", "scripts/doctor.mjs", "config/acme-staging.yaml"]);
  for (const s of p.steps) assert.equal(s.env.ATF_ENV, "staging");
  assert.equal(plan(["status", "acme"], ctx(root)).steps[0].env.ATF_ENV, undefined);
  assert.match(plan(["run", "acme", "--env", "Staging"], ctx(root)).error, /--env 'Staging' must be a lowercase kebab-case/);
});

test("the human-only forms are spelled exactly: no alias, no abbreviation, no --approved=<value>", () => {
  const root = ws();
  const err = (...argv) => plan(argv, ctx(root)).error;
  assert.match(err("approv", "acme", "contacts"), /unknown command 'approv'/);
  assert.match(err("APPROVE", "acme", "contacts"), /unknown command/);
  assert.match(err("import", "acme", "contacts", "--approved=yes"), /does not take an argument/);
  assert.match(err("import", "acme", "contacts", "--appr"), /Unknown option '--appr'/);
  assert.match(err("sweep", "acme", "--dry"), /Unknown option '--dry'/);
  assert.match(err("approve", "acme"), /needs <product> <module>, e\.g\. atf approve acme-crm contacts/);
  assert.match(err("approve", "acme", "Contacts"), /<module> 'Contacts' must be a lowercase kebab-case slug/);
  assert.match(err("status", "acme", "extra"), /unexpected 'extra'/);
  assert.match(err("constructor"), /unknown command 'constructor'/);
  // an optional positional (atf init [<dir>]) takes one word at most, and the rest stays strict
  assert.equal(plan(["init", "--no-install"], ctx(root, { cwd: root })).steps[0].init.dir, root);
  assert.match(err("init", "a", "b"), /^atf init: unexpected 'b'$/);
  assert.match(err("init", "--approved"), /Unknown option '--approved'/);
});

test("help and usage", () => {
  for (const argv of [[], ["help"], ["--help"], ["-h"], ["run", "--help"]]) assert.equal(plan(argv, ctx(ws())).print, USAGE, argv.join(" "));
  for (const cmd of ["init", "setup", "config", "interview", "login", "validate", "doctor", "e2e", "eject", "run", "status", "next", "diff", "resume", "explore", "clarifications", "testcases", "k6", "report", "automate", "steps", "import", "approve", "sweep"])
    assert.match(USAGE, new RegExp(`atf (?:\\S+\\|)*${cmd}\\b`), `${cmd} is in the usage`);
});

test("atf config writes the run-config from the example, then logs in unless --no-login", () => {
  const root = ws();
  const p = plan(["config", "crm", "--url", "https://crm.example.com"], ctx(root));
  assert.deepEqual(p.steps.slice(1).map(shown), [
    ["node", "scripts/doctor.mjs", "config/crm.yaml", "--for", "login", "--fix"],
    ["node", "scripts/run.mjs", "login", "config/crm.yaml", "--seconds", "60"],
  ]);
  const quiet = plan(["config", "crm", "--url", "https://crm.example.com", "--no-login"], ctx(root));
  const logs = [];
  assert.equal(run(quiet, { workspace: root, out: { log: (m) => logs.push(m), error: (m) => logs.push(m) } }), 0);
  const text = readFileSync(path.join(root, "config/crm.yaml"), "utf8");
  assert.match(text, /^product: crm$/m);
  assert.match(text, /^ {2}url: https:\/\/crm\.example\.com$/m);
  assert.match(text, /^ {2}name: crm$/m);
  assert.match(logs[0], /^Created config\/crm\.yaml\./);
  assert.match(plan(["config", "acme", "--url", "https://x.test"], ctx(root)).error, /config\/acme\.yaml already exists/);
  assert.match(plan(["config", "crm2"], ctx(root)).error, /needs --url/);
  assert.match(plan(["config", "crm2", "--url", "crm.example.com"], ctx(root)).error, /must be an http\(s\) URL/);
  assert.equal(configFromExample("product: acme-crm\ntarget:\n  url: https://a\n  name: Acme CRM\n", { product: "p", url: "https://b" }), "product: p\ntarget:\n  url: https://b\n  name: p\n");
});

test("atf eject config copies one framework config file, or all five, byte for byte into atf/config/, with the notes", () => {
  const root = ws();
  const logs = [];
  const out = { log: (m) => logs.push(m), error: (m) => logs.push(`error: ${m}`) };
  const p = plan(["eject", "config", "permissions.yaml"], ctx(root));
  assert.deepEqual(p.steps, [{ eject: [{ file: "atf/config/permissions.yaml", from: path.join(frameworkRoot, "config", "permissions.yaml") }] }]);
  assert.equal(existsSync(path.join(root, "atf/config")), false, "plan() writes nothing");
  assert.equal(run(p, { workspace: root, out }), 0);
  assert.ok(readFileSync(path.join(root, "atf/config/permissions.yaml")).equals(readFileSync(path.join(frameworkRoot, "config/permissions.yaml"))), "byte-identical");
  assert.equal(logs[0], "Ejected atf/config/permissions.yaml");
  assert.match(logs[1], /^atf\/config\/permissions\.yaml now replaces the package's config\/permissions\.yaml entirely: later package upgrades won't change it, and an overlay atf\/permissions\.yaml for it is ignored\.$/);
  assert.match(logs[2], /permissions\.yaml is the agents' safety ceiling, frozen into each run .* have a human review every change to it/);

  // the name without .yaml; no permissions note for another file
  logs.length = 0;
  assert.equal(run(plan(["eject", "config", "models"], ctx(root)), { workspace: root, out }), 0);
  assert.deepEqual(logs.slice(0, 1), ["Ejected atf/config/models.yaml"]);
  assert.equal(logs.length, 2);
  assert.match(logs[1], /overlay atf\/models\.yaml for it is ignored/);

  // all five, into a fresh workspace (atf/config created)
  const all = ws();
  logs.length = 0;
  const every = plan(["eject", "config"], ctx(all));
  assert.deepEqual(every.steps[0].eject.map((e) => e.file), ["permissions", "models", "platforms", "mcp", "hooks"].map((f) => `atf/config/${f}.yaml`));
  assert.equal(run(every, { workspace: all, out }), 0);
  for (const f of ["permissions", "models", "platforms", "mcp", "hooks"]) {
    assert.ok(readFileSync(path.join(all, `atf/config/${f}.yaml`)).equals(readFileSync(path.join(frameworkRoot, `config/${f}.yaml`))), `${f}.yaml byte-identical`);
    assert.ok(logs.includes(`Ejected atf/config/${f}.yaml`));
  }
  assert.ok(logs.some((l) => /^Each ejected file now replaces the package's copy entirely: .* an overlay atf\/<file> for it is ignored\.$/.test(l)));
  assert.ok(logs.some((l) => /safety ceiling/.test(l)));
});

test("atf eject config never overwrites, refuses one directory, and parses strictly", () => {
  const root = ws();
  const err = (argv, extra) => plan(argv, ctx(root, extra)).error;
  // an already-ejected target refuses the whole call: nothing else is written
  put(root, "atf/config/mcp.yaml", "mine: true\n");
  assert.equal(err(["eject", "config", "mcp"]), "atf/config/mcp.yaml is already ejected; edit it instead. Nothing was written.");
  assert.match(err(["eject", "config"]), /^atf\/config\/mcp\.yaml is already ejected/);
  assert.equal(existsSync(path.join(root, "atf/config/permissions.yaml")), false);
  assert.equal(readFileSync(path.join(root, "atf/config/mcp.yaml"), "utf8"), "mine: true\n");
  // run() checks again before the first copy: a file ejected after the plan still leaves nothing written
  const fresh = ws();
  const p = plan(["eject", "config"], ctx(fresh));
  put(fresh, "atf/config/hooks.yaml", "mine: true\n");
  const errors = [];
  assert.equal(run(p, { workspace: fresh, out: { log() {}, error: (m) => errors.push(m) } }), 1);
  assert.equal(errors[0], "atf/config/hooks.yaml is already ejected; edit it instead. Nothing was written.");
  assert.equal(existsSync(path.join(fresh, "atf/config/permissions.yaml")), false);
  assert.equal(readFileSync(path.join(fresh, "atf/config/hooks.yaml"), "utf8"), "mine: true\n");
  // the workspace and the framework as one directory
  const one = ws();
  assert.match(err(["eject", "config", "models"], { workspace: one, framework: one }), /^atf eject config needs a workspace apart from the framework/);
  // strict parsing: one subcommand word, the five names only
  assert.match(err(["eject"]), /^atf eject needs <subcommand>, e\.g\. atf eject config permissions\.yaml$/);
  assert.match(err(["eject", "configs"]), /^atf eject takes config, not 'configs'/);
  assert.match(err(["eject", "Config"]), /^atf eject takes config, not 'Config'/);
  assert.match(err(["eject", "permissions.yaml"]), /^atf eject takes config, not 'permissions\.yaml'/);
  assert.match(err(["eject", "config", "permissions.yml"]), /'permissions\.yml' is not a framework config file \(one of: permissions\.yaml, models\.yaml, platforms\.yaml, mcp\.yaml, hooks\.yaml\)/);
  assert.match(err(["eject", "config", "run-config.example.yaml"]), /is not a framework config file/);
  assert.match(err(["eject", "config", "../config/models.yaml"]), /is not a framework config file/);
  assert.match(err(["eject", "config", "models", "mcp"]), /^atf eject config: unexpected 'mcp'/);
  assert.match(err(["eject", "config", "--force"]), /Unknown option '--force'/);
  assert.match(err(["ejec", "config"]), /unknown command 'ejec'/);
});

test("run() stops at the first failing step, in the workspace, and reports a missing program", () => {
  const root = ws();
  const calls = [];
  const spawn = (status) => (cmd, args, opts) => (calls.push({ cmd, args, opts }), { status: status(calls.length) });
  const quiet = { log() {}, error() {} };
  const p = plan(["run", "acme"], ctx(root));
  assert.equal(run(p, { workspace: root, platform: "linux", spawn: spawn(() => 1), out: quiet }), 1);
  assert.equal(calls.length, 1, "a failing doctor stops the session from opening");
  assert.equal(calls[0].opts.cwd, root);
  assert.equal(calls[0].opts.stdio, "inherit", "approve and sweep read the human's own terminal");
  calls.length = 0;
  assert.equal(run(p, { workspace: root, platform: "linux", spawn: spawn(() => 0), out: quiet }), 0);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].opts.shell, undefined, "no shell outside Windows: the prompt is one argument");
  const errors = [];
  const missing = () => ({ error: Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" }) });
  assert.equal(run({ steps: [p.steps[1]] }, { workspace: root, spawn: missing, out: { log() {}, error: (m) => errors.push(m) } }), 1);
  assert.match(errors[0], /claude not found on PATH \(install it, or pick another with --host or ATF_AGENT\)/);
});

test("on Windows, npm, npx and the host CLI go through cmd.exe with every argument quoted; node scripts never do", () => {
  const root = ws();
  const calls = [];
  const spawn = (cmd, args, opts) => (calls.push({ cmd, args, opts }), { status: 0 });
  const quiet = { log() {}, error() {} };
  run(plan(["run", "acme"], ctx(root)), { workspace: root, platform: "win32", spawn, out: quiet });
  assert.equal(calls[0].cmd, process.execPath);
  assert.equal(calls[0].opts.shell, undefined);
  assert.equal(calls[1].opts.shell, true);
  assert.match(calls[1].cmd, /^claude --agent orchestrator-agent "Start or resume the run for config\/acme\.yaml: [^"]+"$/);
  assert.deepEqual(windowsCommandLine("npx", ["playwright", "install", "chromium"]), { line: "npx playwright install chromium" });
  assert.deepEqual(windowsCommandLine("C:\\Program Files\\x\\claude.exe", ["a b", "a&b", ""]), { line: '"C:\\Program Files\\x\\claude.exe" "a b" "a&b" ""' });
  assert.match(windowsCommandLine("claude", ['say "hi"']).error, /can't pass/);
  assert.match(windowsCommandLine("claude", ["100%"]).error, /can't pass/);
});

test("atf needs a workspace when the framework is installed; e2e runs only from the source checkout", () => {
  const root = ws();
  // an installed copy: the framework's real path has a node_modules segment
  const copy = tempRoot();
  const fw = path.join(copy, "node_modules", "atf");
  put(copy, "node_modules/atf/scripts/x.mjs", "");
  assert.ok(existsSync(fw));
  assert.equal(workspaceError({ workspace: fw, framework: fw }), `not inside an atf workspace: no atf/atf.json in ${process.cwd()} or above it (or set ATF_WORKSPACE)`);
  assert.equal(workspaceError({ workspace: root, framework: fw }), null);
  assert.equal(workspaceError({ workspace: frameworkRoot, framework: frameworkRoot }), null, "a source checkout is its own workspace");
  assert.match(plan(["e2e"], ctx(root, { framework: fw })).error, /only in the framework's source checkout/);
});
