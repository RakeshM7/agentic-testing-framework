import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { HOSTS, ISSUES_SCRIPT, USAGE, agentCommand, configFromExample, plan, run, versionInfo, windowsCommandLine, workspaceError } from "./lib/cli.mjs";
import { CONTRACT_VERSION } from "./lib/contract.mjs";
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
  for (const cmd of ["init", "setup", "config", "interview", "login", "validate", "doctor", "e2e", "version", "migrate", "issues", "eject", "run", "status", "next", "diff", "resume", "explore", "clarifications", "testcases", "k6", "report", "automate", "steps", "import", "approve", "sweep"])
    assert.match(USAGE, new RegExp(`atf (?:\\S+\\|)*${cmd}\\b`), `${cmd} is in the usage`);
});

test("atf version: the package and its version, the artifact contract, the workspace's recorded contract, Node.js and the plugin; text or --json", () => {
  // a framework at a faked release: its own package.json, never this repository's
  const fw = tempRoot();
  put(fw, "package.json", JSON.stringify({ name: "@testagentic/atf", version: "0.3.1" }));
  const root = ws();
  const text = (workspace, framework = fw) => plan(["version"], ctx(workspace, { framework })).print;
  assert.equal(text(root), ["@testagentic/atf 0.3.1", `artifact contract: ${CONTRACT_VERSION}`, "workspace contract: not recorded, 2 assumed", `Node.js: ${process.version}`, "plugin: none"].join("\n"));
  put(root, "atf/atf.json", `{ "contract": ${CONTRACT_VERSION} }`);
  assert.match(text(root), new RegExp(`^workspace contract: ${CONTRACT_VERSION} \\(atf/atf\\.json\\)$`, "m"));
  put(root, "atf/atf.json", '{ "contract": 1 }');
  assert.match(text(root), /^workspace contract: 1 \(atf\/atf\.json\)\n {2}atf\/atf\.json records artifact contract 1, older than this framework's 2: .*Fix: npx atf migrate/m);
  put(root, "atf/atf.json", "{ broken");
  assert.match(text(root), /^workspace contract: unreadable: atf\/atf\.json could not be read as JSON/m);
  // an installed package with no workspace around it: it still answers (main() refuses other commands there)
  const installed = path.join(tempRoot(), "node_modules", "@testagentic", "atf");
  put(installed, "package.json", JSON.stringify({ name: "@testagentic/atf", version: "1.0.0" }));
  assert.match(text(installed, installed), /^@testagentic\/atf 1\.0\.0\n[\s\S]*^workspace contract: none \(not inside an atf workspace\)$/m);
  assert.match(text(root, tempRoot()), /^package: unknown \(the framework's package\.json can't be read\)$/m);

  put(root, "atf/atf.json", "{}");
  const json = JSON.parse(plan(["version", "--json"], ctx(root, { framework: fw })).print);
  assert.deepEqual(json, { package: { name: "@testagentic/atf", version: "0.3.1" }, contract: CONTRACT_VERSION, workspace: { root, contract: 2, recorded: false }, node: process.version, plugin: null });
  assert.deepEqual(versionInfo({ workspace: installed, framework: installed, node: "v20.0.0" }), { package: { name: "@testagentic/atf", version: "1.0.0" }, contract: CONTRACT_VERSION, workspace: null, node: "v20.0.0", plugin: null });
  // by default, this framework's own package.json
  assert.equal(JSON.parse(plan(["version", "--json"], ctx(root)).print).package.version, JSON.parse(readFileSync(path.join(frameworkRoot, "package.json"), "utf8")).version);
  // strict like every command; run() prints it and exits 0
  assert.match(plan(["version", "--jso"], ctx(root)).error, /Unknown option '--jso'/);
  assert.match(plan(["version", "extra"], ctx(root)).error, /^atf version: unexpected 'extra'$/);
  const logs = [];
  assert.equal(run(plan(["version"], ctx(root, { framework: fw })), { out: { log: (m) => logs.push(m), error: (m) => logs.push(m) } }), 0);
  assert.match(logs[0], /^@testagentic\/atf 0\.3\.1\n/);
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

test("atf issues: exactly export or import, strict options, paths from where it was typed, in a child node", () => {
  const root = ws();
  const here = tempRoot();
  const p = (argv, extra) => plan(argv, ctx(root, { cwd: here, ...extra }));
  const opts = (argv) => {
    const r = p(argv);
    assert.equal(r.error, undefined, `${argv.join(" ")}: ${r.error}`);
    const [step] = r.steps;
    assert.equal(step.cmd, process.execPath);
    assert.deepEqual(step.args.slice(0, 2), ["--input-type=module", "-e"]);
    assert.equal(step.args[2], ISSUES_SCRIPT);
    assert.deepEqual(step.args.slice(3, 5), [root, frameworkRoot]);
    return JSON.parse(step.args[5]);
  };
  assert.deepEqual(opts(["issues", "export"]), { subcommand: "export", includeEvidence: false, yes: false, dryRun: false });
  assert.deepEqual(opts(["issues", "export", "--run", "acme-20261026-1230", "--include-evidence", "--client", "Globex", "--out", "bundles", "--yes"]), { subcommand: "export", run: "acme-20261026-1230", includeEvidence: true, client: "Globex", yes: true, dryRun: false, out: path.join(here, "bundles") });
  assert.deepEqual(opts(["issues", "export", "--since", "2026-10-01", "--dry-run"]), { subcommand: "export", since: "2026-10-01", includeEvidence: false, yes: false, dryRun: true });
  assert.deepEqual(opts(["issues", "import", "b.zip", "--out", "fb"]), { subcommand: "import", zip: path.join(here, "b.zip"), out: path.join(here, "fb") });
  const err = (...argv) => p(argv).error;
  assert.match(err("issues"), /^atf issues needs <subcommand>, e\.g\. atf issues export --dry-run$/);
  assert.match(err("issues", "Export"), /^atf issues takes export or import, not 'Export'/);
  assert.match(err("issues", "exports"), /^atf issues takes export or import, not 'exports'/);
  assert.match(err("issue", "export"), /unknown command 'issue'/);
  assert.match(err("issues", "export", "--run", "a", "--since", "2026-10-01"), /takes --run or --since, not both/);
  assert.match(err("issues", "export", "--since", "2026-02-30"), /--since '2026-02-30' must be a date, YYYY-MM-DD/);
  assert.match(err("issues", "export", "--since", "yesterday"), /must be a date/);
  assert.match(err("issues", "export", "--run", "Acme_1"), /--run 'Acme_1' must be a run id/);
  assert.match(err("issues", "export", "--yes", "--dry-run"), /takes --yes or --dry-run, not both/);
  assert.match(err("issues", "export", "--yes=true"), /does not take an argument/);
  assert.match(err("issues", "export", "--evidence"), /Unknown option '--evidence'/);
  assert.match(err("issues", "export", "now"), /^atf issues export: unexpected 'now'$/);
  assert.match(err("issues", "export", "--env", "staging"), /covers every product and environment .*: it takes no --env/);
  assert.match(err("issues", "import"), /^atf issues import needs <zip>/);
  assert.match(err("issues", "import", "a.zip", "b.zip"), /^atf issues import: unexpected 'b\.zip'$/);
  assert.match(err("issues", "import", "a.zip", "--yes"), /^atf issues import takes <zip> and --out only, not --yes$/);
  // import: the framework's source checkout only
  const copy = tempRoot();
  put(copy, "node_modules/atf/scripts/x.mjs", "");
  assert.match(p(["issues", "import", "a.zip"], { framework: path.join(copy, "node_modules", "atf") }).error, /runs only in the framework's own source checkout/);
});

test("atf issues export through run(): the child previews, refuses without a terminal or --yes, and writes with --yes", async () => {
  const { main: addIssue } = await import("./framework-issues.mjs");
  const { endRun, initRun } = await import("./run.mjs");
  const { writeConfig } = await import("./test-helpers.mjs");
  const root = tempRoot();
  put(root, "atf/atf.json", JSON.stringify({ client: "globex" }));
  assert.equal(initRun(writeConfig(root), { root, framework: root, runId: "acme-run-1", env: { CLAUDECODE: "1" } }).errors, undefined);
  addIssue(["add", "acme", "--from", "module-explorer", "--kind", "doc", "--target", "docs/conventions.md", "--summary", "wrong for https://app.acme.test", "--evidence", "seen"], { root });
  await endRun("acme", { root, framework: root });
  const exec = (argv) => {
    const res = {};
    const code = run(plan(argv, ctx(root)), { workspace: root, spawn: (cmd, args, opts) => Object.assign(res, spawnSync(cmd, args, { ...opts, stdio: "pipe", encoding: "utf8" })), out: { log() {}, error() {} } });
    return { code, out: `${res.stdout}${res.stderr}` };
  };
  const zips = () => readdirSync(root).filter((f) => f.endsWith(".zip"));
  const dry = exec(["issues", "export", "--dry-run"]);
  assert.equal(dry.code, 0, dry.out);
  assert.match(dry.out, /^atf issues export: 1 framework issue\(s\) from 1 ended run\(s\), for client globex$/m);
  assert.match(dry.out, /wrong for <url-1>/);
  assert.deepEqual(zips(), []);
  const refused = exec(["issues", "export"]);
  assert.equal(refused.code, 1);
  assert.match(refused.out, /not written: confirm on a terminal by typing yes, or pass --yes/);
  assert.deepEqual(zips(), []);
  const yes = exec(["issues", "export", "--yes"]);
  assert.equal(yes.code, 0, yes.out);
  assert.equal(zips().length, 1);
  assert.match(zips()[0], /^atf-issues-globex-\d{4}-\d{2}-\d{2}\.zip$/);
  const imported = exec(["issues", "import", path.join(root, zips()[0])]);
  assert.equal(imported.code, 0, imported.out);
  assert.match(imported.out, /^ {2}feedback\/client-globex-\d{4}-\d{2}-\d{2}\/FI-[0-9a-f]{8}\.md$/m);
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
