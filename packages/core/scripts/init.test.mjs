// `atf init` (docs/packaging.md §3.3, §3.6, §3.7; scripts/lib/init.mjs through scripts/lib/cli.mjs): a client's
// workspace from templates/workspace/, never overwriting, then the sync or the install, and the doctor's base checks.
// Offline: the install is a stubbed spawn, and an installed framework is installedWorkspace()'s real copy.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { plan, run } from "./lib/cli.mjs";
import { parseDecisions } from "./lib/decisions.mjs";
import { CLIENT_GITIGNORE, DOCTOR_BASE_SCRIPT, INIT_BLOCK_END, INIT_BLOCK_START, packageName, withDeps, withInitBlock } from "./lib/init.mjs";
import { frameworkRoot } from "./lib/roots.mjs";
import { CONTRACT_VERSION, workspaceContract } from "./lib/contract.mjs";
import { SETUP_TEMPLATE, SETUP_WORKFLOW, BLOCK_START as SYNC_BLOCK_START } from "./lib/sync.mjs";
import { installedWorkspace, put, tempRoot } from "./test-helpers.mjs";

const FW_PKG = JSON.parse(readFileSync(path.join(frameworkRoot, "package.json"), "utf8"));
const FW = `node_modules/${FW_PKG.name}`;
const FILES = ["package.json", ".npmrc", ".gitignore", "atf/atf.json", "atf/decisions.md", "AGENTS.md", "config/README.md", ".vscode/settings.json"];

// plan + run as `atf init <argv…>` typed in `cwd`; -> { code, logs, errors, calls, plan }
function init(argv, { cwd = tempRoot(), framework = frameworkRoot, platform = "linux", status = () => 0, spawn } = {}) {
  const logs = [];
  const errors = [];
  const calls = [];
  const p = plan(["init", ...argv], { cwd, framework, env: {} });
  const stub = (cmd, args, opts) => (calls.push({ cmd, args, opts }), { status: status(calls.length, cmd) });
  const code = run(p, { platform, spawn: spawn ?? stub, out: { log: (m) => logs.push(m), error: (m) => errors.push(m) } });
  return { code, logs, errors, calls, plan: p };
}
const kinds = (p) => p.steps.map((s) => (s.init ? "init" : s.sync ? "sync" : s.say ? "say" : s.cmd === process.execPath ? "doctor" : `${s.cmd} ${s.args.join(" ")}`));
const snapshot = (root) => Object.fromEntries(FILES.map((f) => [f, readFileSync(path.join(root, f), "utf8")]));
// every `node_modules/@testagentic/atf/<path>` a committed file names is a file the package has
const namedFrameworkPaths = (text) => [...text.matchAll(new RegExp(`${FW.replace(/[/.]/g, "\\$&")}/([\\w./-]+[\\w])`, "g"))].map((m) => m[1]);

test("atf init --no-install in a folder that doesn't exist yet: every file, {fw} as the installed path, the package pinned", () => {
  const cwd = tempRoot();
  const dir = path.join(cwd, "Acme Tests!");
  const r = init(["Acme Tests!", "--no-install"], { cwd });
  assert.deepEqual(kinds(r.plan), ["init", "say"], "no install, no sync, no doctor");
  assert.equal(r.plan.standalone, true, "runs outside any workspace");
  assert.equal(r.code, 0, r.errors.join("\n"));
  assert.deepEqual(r.calls, []);
  for (const f of FILES) assert.ok(existsSync(path.join(dir, f)), f);
  assert.deepEqual(r.logs.filter((l) => /^ {2}created/.test(l)).map((l) => l.split(/\s+/)[2].replace(/:$/, "")), FILES);

  // package.json: private, named after the folder, the package at the running version, its peers pinned
  const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
  assert.deepEqual(pkg, { name: "acme-tests", private: true, devDependencies: { [FW_PKG.name]: FW_PKG.version, ...FW_PKG.peerDependencies } });
  assert.equal(pkg.devDependencies.playwright, "1.64.1");
  assert.match(readFileSync(path.join(dir, "package.json"), "utf8"), /^\{\n {2}"name"[\s\S]*\}\n$/, "2-space indent, trailing newline");

  // .npmrc: the scope on registry.npmjs.org, a token only by environment variable (optional, so npm runs without it)
  const npmrc = readFileSync(path.join(dir, ".npmrc"), "utf8");
  assert.match(npmrc, /^@testagentic:registry=https:\/\/registry\.npmjs\.org\/$/m);
  assert.match(npmrc, /^\/\/registry\.npmjs\.org\/:_authToken=\$\{ATF_NPM_TOKEN\?\}$/m);
  assert.equal(npmrc.split("\n").filter((l) => l && !l.startsWith("#")).length, 2, "only those two lines are active");

  // .gitignore: the init block with the whole baseline
  assert.equal(readFileSync(path.join(dir, ".gitignore"), "utf8"), [INIT_BLOCK_START, ...CLIENT_GITIGNORE, INIT_BLOCK_END, ""].join("\n"));
  for (const must of ["/artifacts/", "node_modules/", ".env", ".env.*", ".auth/"]) assert.ok(CLIENT_GITIGNORE.includes(must), must);

  // atf/: the marker and the empty decision log, which the hook parses with no entries
  // atf/atf.json: the marker, with the artifact contract the workspace starts on (docs/packaging.md §3.10)
  assert.equal(readFileSync(path.join(dir, "atf/atf.json"), "utf8"), `{\n  "contract": ${CONTRACT_VERSION}\n}\n`);
  assert.deepEqual(workspaceContract(dir), { contract: CONTRACT_VERSION, recorded: true });
  assert.ok(r.logs.includes(`  created  atf/atf.json: artifact contract ${CONTRACT_VERSION}`));
  assert.equal(existsSync(path.join(dir, SETUP_WORKFLOW)), false, "no cloud-agent opt-in, no setup workflow");
  const log = readFileSync(path.join(dir, "atf/decisions.md"), "utf8");
  assert.deepEqual(parseDecisions(log), []);
  assert.match(log, new RegExp(`node ${FW}/scripts/decisions\\.mjs for <every file you will change> --full`));

  // the committed briefs: {fw} expanded, and every framework path they name exists in the package
  for (const f of ["atf/decisions.md", "AGENTS.md", "config/README.md", ".vscode/settings.json"]) {
    const text = readFileSync(path.join(dir, f), "utf8");
    assert.doesNotMatch(text, /\{fw\}/, f);
    for (const rel of namedFrameworkPaths(text)) assert.ok(existsSync(path.join(frameworkRoot, rel)), `${f} names ${FW}/${rel}`);
  }
  const brief = readFileSync(path.join(dir, "AGENTS.md"), "utf8");
  for (const doc of ["artifact-contract", "agent-handoffs", "playwright-conventions", "k6-conventions", "conventions", "platforms"]) assert.ok(brief.includes(`\`${FW}/docs/${doc}.md\``), doc);
  assert.match(brief, /`readonly` \(the default\)/);
  assert.match(brief, /`atf\/` is human-only/);
  assert.match(brief, /npx atf config <product> --url <target url>/);
  assert.match(readFileSync(path.join(dir, "config/README.md"), "utf8"), /npx atf interview/);

  // .vscode/settings.json: VS Code's JSON with comments; its auto-approve regex names the installed framework's scripts
  const settings = JSON.parse(readFileSync(path.join(dir, ".vscode/settings.json"), "utf8").replace(/^\s*\/\/.*$/gm, ""));
  assert.deepEqual(settings["chat.hookFilesLocations"], { ".vscode/hooks": true, ".github/hooks": false, ".claude/hooks": false });
  assert.equal(settings["chat.subagents.allowInvocationsFromSubagents"], true);
  const [scripts] = Object.keys(settings["chat.tools.terminal.autoApprove"]);
  const re = new RegExp(scripts.slice(1, -1));
  assert.ok(re.test(`node ${FW}/scripts/run.mjs next acme`));
  assert.ok(!re.test("node node_modules/other/scripts/run.mjs next acme") && !re.test("node scripts/run.mjs next acme"));

  // the next steps: into the folder, the install --no-install skipped, then a run-config and a run
  const next = r.logs.slice(r.logs.indexOf("Next:") + 1);
  assert.match(next[0], /^ {2}1\. cd "Acme Tests!"$/);
  assert.match(next[1], /^ {2}2\. npm install /);
  assert.match(next[2], /^ {2}3\. npx atf config <product> --url <target url> .*npx atf interview/);
  assert.match(next[3], /^ {2}4\. npx atf run <product> /);
});

test("atf init again changes nothing and reports every file as present", () => {
  const cwd = tempRoot();
  const dir = path.join(cwd, "ws");
  assert.equal(init([dir, "--no-install"], { cwd }).code, 0);
  const before = snapshot(dir);
  const again = init(["--no-install"], { cwd: dir });
  assert.equal(again.code, 0, again.errors.join("\n"));
  assert.deepEqual(snapshot(dir), before);
  const report = again.logs.filter((l) => /^ {2}\S/.test(l) && !/^ {2}\d\./.test(l));
  assert.equal(report.length, 8);
  for (const l of report) assert.match(l, /^ {2}present {2}\S+: left as it is$/, l);
  assert.ok(report.some((l) => l.startsWith("  present  config/:")), "an existing config/ is left alone");
  assert.ok(!again.logs.some((l) => /^ {2}\d\. cd /.test(l)), "no cd when it ran in the folder");
});

test("an existing package.json and .gitignore keep everything; only what is missing is added", () => {
  const cwd = tempRoot();
  const dir = path.join(cwd, "client");
  const pkgText = '{\n    "name": "client-tests",\n    "version": "1.0.0",\n    "scripts": {\n        "lint": "eslint ."\n    },\n    "dependencies": {\n        "playwright": "^1.50.0"\n    }\n}';
  put(dir, "package.json", pkgText);
  put(dir, ".gitignore", "# ours\nnode_modules/\n.env\nmine/");
  put(dir, "AGENTS.md", "our own brief\n");
  const r = init(["--no-install"], { cwd: dir });
  assert.equal(r.code, 0, r.errors.join("\n"));

  const after = readFileSync(path.join(dir, "package.json"), "utf8");
  assert.deepEqual(JSON.parse(after), { ...JSON.parse(pkgText), devDependencies: { [FW_PKG.name]: FW_PKG.version } });
  assert.deepEqual(Object.keys(JSON.parse(after)), ["name", "version", "scripts", "dependencies", "devDependencies"], "key order kept");
  assert.match(after, /^\{\n {4}"name"/, "the file's own indentation");
  assert.ok(after.endsWith("}\n"));
  assert.ok(r.logs.includes(`  updated  package.json: added devDependencies ${FW_PKG.name} ${FW_PKG.version}; kept playwright ^1.50.0 (the framework pins 1.64.1; the doctor checks what is installed)`), r.logs.join("\n"));

  // the client's lines untouched; a pattern they already have is not repeated, a negation always sits in the block
  const ignore = readFileSync(path.join(dir, ".gitignore"), "utf8");
  assert.ok(ignore.startsWith("# ours\nnode_modules/\n.env\nmine/\n\n# >>> atf init"), ignore);
  const block = ignore.slice(ignore.indexOf(INIT_BLOCK_START)).split("\n").slice(1, -2);
  assert.deepEqual(block, CLIENT_GITIGNORE.filter((e) => !["node_modules/", ".env"].includes(e)));
  assert.equal(readFileSync(path.join(dir, "AGENTS.md"), "utf8"), "our own brief\n", "never overwritten");
  assert.ok(r.logs.includes("  present  AGENTS.md: left as it is"));
  assert.ok(r.logs.some((l) => l.startsWith("  updated  .gitignore: added /artifacts/")));

  // a line the client later removes from the block comes back there; their own new lines stay where they are
  writeFileSync(path.join(dir, ".gitignore"), ignore.replace("\n/artifacts/\n", "\n").replace("mine/\n", "mine/\ntheirs/\n"));
  assert.equal(init(["--no-install"], { cwd: dir }).code, 0);
  const third = readFileSync(path.join(dir, ".gitignore"), "utf8");
  assert.ok(third.includes("mine/\ntheirs/\n"));
  assert.match(third, new RegExp(`\\n/artifacts/\\n${INIT_BLOCK_END.replace(/[<]/g, "\\$&")}\\n$`), "appended at the end of the block");
});

test("the plan's readers: package names, dependencies, the .gitignore block (CRLF kept, a malformed block refused)", () => {
  assert.equal(packageName("/x/My Tests"), "my-tests");
  assert.equal(packageName("/x/_.Hidden--"), "hidden");
  assert.equal(packageName("/x/node_modules"), "atf-tests");
  assert.equal(packageName("/x/!!!"), "atf-tests");
  assert.equal(packageName(`/x/${"a".repeat(300)}`).length, 214);

  const wanted = { "@testagentic/atf": "1.2.3", playwright: "1.64.1" };
  assert.deepEqual(withDeps('{"devDependencies":{"@testagentic/atf":"1.2.3","playwright":"1.64.1"}}', wanted), { added: [], kept: [] });
  assert.equal(withDeps('{\r\n\t"name": "x"\r\n}\r\n', wanted).text, '{\r\n\t"name": "x",\r\n\t"devDependencies": {\r\n\t\t"@testagentic/atf": "1.2.3",\r\n\t\t"playwright": "1.64.1"\r\n\t}\r\n}\r\n');
  assert.deepEqual(withDeps('{"devDependencies":{"@testagentic/atf":"0.9.0"}}', wanted).kept, [["@testagentic/atf", "0.9.0", "1.2.3"]], "an existing version is never changed");
  assert.match(withDeps("{ not json", wanted).error, /^package\.json is not valid JSON/);
  assert.match(withDeps("[]", wanted).error, /must hold a JSON object/);
  assert.match(withDeps('{"devDependencies":"x"}', wanted).error, /"devDependencies" must be an object/);

  assert.deepEqual(withInitBlock("", ["a/"]), { text: `${INIT_BLOCK_START}\na/\n${INIT_BLOCK_END}\n`, added: ["a/"] });
  assert.deepEqual(withInitBlock("x\r\n", ["a/"]).text, `x\r\n\r\n${INIT_BLOCK_START}\r\na/\r\n${INIT_BLOCK_END}\r\n`);
  assert.deepEqual(withInitBlock("a/\n!b\n", ["a/", "!b"]).added, ["!b"], "a negation outside the block may come before it");
  assert.deepEqual(withInitBlock(`${INIT_BLOCK_START}\na/\n${INIT_BLOCK_END}\n`, ["a/"]), { added: [] });
  for (const bad of [`${INIT_BLOCK_START}\n`, `${INIT_BLOCK_END}\n${INIT_BLOCK_START}\n`, `${INIT_BLOCK_START}\n${INIT_BLOCK_END}\n${INIT_BLOCK_START}\n${INIT_BLOCK_END}\n`])
    assert.match(withInitBlock(bad, ["a/"]).error, /the atf init block is malformed/);
  // sync's block is a different one
  assert.deepEqual(withInitBlock(`${SYNC_BLOCK_START}\n/.mcp.json\n# <<< atf sync\n`, ["a/"]).added, ["a/"]);
});

test("a file init can't read safely stops it before anything is written (exit 1)", () => {
  for (const [file, text, message] of [
    ["package.json", "{ not json", /package\.json is not valid JSON/],
    [".gitignore", `${INIT_BLOCK_START}\nx\n`, /the atf init block is malformed/],
    ["atf/atf.json", "{ nope", /atf\/atf\.json could not be read as JSON/],
    ["atf/atf.json", '{ "cloud_agent": "yes" }', /atf\/atf\.json "cloud_agent" must be true or false, not "yes"; fix it, then run atf init again$/],
    ["atf/atf.json", '{ "claude_plugin": "yes" }', /atf\/atf\.json "claude_plugin" must be true or false, not "yes"; fix it, then run atf init again$/],
    ["atf/atf.json", '{ "claude_plugin": true }', /atf\/atf\.json "plugin_marketplace" is required with "claude_plugin": true: .*; fix it, then run atf init again$/],
    ["atf/atf.json", '{ "claude_plugin": true, "plugin_marketplace": "nope" }', /atf\/atf\.json "plugin_marketplace" must be a git URL .* not "nope"; fix it, then run atf init again$/],
    ["atf/atf.json", '{ "contract": 2.5 }', /atf\/atf\.json "contract" must be a whole number of 1 or more \(the artifact-contract version\), not 2\.5; fix it, then run atf init again$/],
  ]) {
    const dir = path.join(tempRoot(), "ws");
    put(dir, file, text);
    const r = init([dir], { cwd: dir });
    assert.equal(r.code, 1, file);
    assert.match(r.errors[0], message, file);
    assert.equal(r.errors.at(-1), "atf init: nothing was written.");
    assert.deepEqual(readdirSync(dir).filter((f) => f !== file.split("/")[0]), [], `${file}: nothing else written`);
    assert.deepEqual(r.calls, [], `${file}: no install, no doctor`);
  }
});

test("an existing atf.json is never rewritten: without \"contract\" it counts as 2, and another contract is left for the doctor and run.mjs init to refuse", () => {
  for (const [text, contract] of [["{}\n", { contract: 2, recorded: false }], ['{ "contract": 1 }\n', { contract: 1, recorded: true }]]) {
    const dir = path.join(tempRoot(), "ws");
    put(dir, "atf/atf.json", text);
    const r = init(["--no-install"], { cwd: dir });
    assert.equal(r.code, 0, r.errors.join("\n"));
    assert.ok(r.logs.includes("  present  atf/atf.json: left as it is"));
    assert.equal(readFileSync(path.join(dir, "atf/atf.json"), "utf8"), text);
    assert.deepEqual(workspaceContract(dir), contract);
  }
});

test("atf.json naming another decision log: init creates that one", () => {
  const dir = path.join(tempRoot(), "ws");
  put(dir, "atf/atf.json", '{ "decisions": "docs/decisions.md" }\n');
  assert.equal(init(["--no-install"], { cwd: dir }).code, 0);
  assert.deepEqual(parseDecisions(readFileSync(path.join(dir, "docs/decisions.md"), "utf8")), []);
  assert.equal(existsSync(path.join(dir, "atf/decisions.md")), false);
});

test("atf.json that already opts in to the cloud agent: init writes the setup workflow from the template, once, never over the client's", () => {
  const dir = path.join(tempRoot(), "ws");
  put(dir, "atf/atf.json", '{ "cloud_agent": true }\n');
  const r = init(["--no-install"], { cwd: dir });
  assert.equal(r.code, 0, r.errors.join("\n"));
  assert.ok(r.logs.includes(`  created  ${SETUP_WORKFLOW}: the Copilot cloud agent's setup steps, yours from now on; merge it to the default branch and add the Agents secret ATF_NPM_TOKEN`), r.logs.join("\n"));
  const file = path.join(dir, SETUP_WORKFLOW);
  assert.equal(readFileSync(file, "utf8"), readFileSync(path.join(frameworkRoot, ...SETUP_TEMPLATE.split("/")), "utf8"));
  // the client's from now on: init again leaves their version as it is
  writeFileSync(file, "# ours\n");
  const again = init(["--no-install"], { cwd: dir });
  assert.equal(again.code, 0);
  assert.ok(again.logs.includes(`  present  ${SETUP_WORKFLOW}: left as it is`));
  assert.equal(readFileSync(file, "utf8"), "# ours\n");
  // false: no workflow
  const off = path.join(tempRoot(), "ws");
  put(off, "atf/atf.json", '{ "cloud_agent": false }\n');
  assert.equal(init(["--no-install"], { cwd: off }).code, 0);
  assert.equal(existsSync(path.join(off, SETUP_WORKFLOW)), false);
});

test("init in an opted-in workspace where the package is installed: init writes the workflow, the in-process sync commits the Copilot files, atf check passes", () => {
  const { root, framework } = installedWorkspace();
  put(root, "atf/atf.json", '{ "cloud_agent": true }\n');
  const r = init([], { cwd: root, framework });
  assert.deepEqual(kinds(r.plan), ["init", "sync", "doctor", "say"]);
  assert.equal(r.code, 0, r.errors.join("\n"));
  assert.ok(r.logs.some((l) => l.startsWith(`  created  ${SETUP_WORKFLOW}: `)), "written by init");
  assert.ok(!r.logs.some((l) => l.startsWith(`atf sync: created: ${SETUP_WORKFLOW}`)), "so the sync finds it in place");
  const ignore = readFileSync(path.join(root, ".gitignore"), "utf8");
  assert.ok(ignore.includes("/.claude/agents/orchestrator-agent.md") && !ignore.includes("/.github/"), "the opt-in's block");
  const quiet = { log() {}, error() {} };
  assert.equal(run(plan(["check"], { workspace: root, framework }), { out: quiet }), 0);
});

test("init from npx's cache: npm install in the workspace (its postinstall syncs), then the doctor's base group", () => {
  const cwd = tempRoot();
  const dir = path.join(cwd, "ws");
  const r = init(["ws"], { cwd });
  assert.deepEqual(kinds(r.plan), ["init", "npm install", "doctor", "say"]);
  assert.equal(r.code, 0, r.errors.join("\n"));
  assert.deepEqual(r.calls.map((c) => [c.cmd, c.args.slice(0, 2), c.opts.cwd]), [["npm", ["install"], dir], [process.execPath, ["--input-type=module", "-e"], dir]]);
  assert.deepEqual(r.calls[1].args.slice(2), [DOCTOR_BASE_SCRIPT, dir, FW_PKG.name]);
  assert.ok(existsSync(path.join(dir, "atf/atf.json")), "the marker is in place before the install, so the postinstall finds the workspace");
  assert.ok(!r.logs.some((l) => /\d\. npm install/.test(l)), "no install left to do");

  // Windows: npm through cmd.exe, the doctor's node directly
  const win = init([path.join(cwd, "ws2")], { cwd, platform: "win32" });
  assert.equal(win.calls[0].cmd, "npm install");
  assert.equal(win.calls[0].opts.shell, true);
  assert.equal(win.calls[0].opts.cwd, path.join(cwd, "ws2"));
  assert.equal(win.calls[1].opts.shell, undefined);

  // a failed install stops before the doctor and says what is in place (exit 1, whatever npm's own code)
  const broken = init([path.join(cwd, "ws3")], { cwd, status: () => 7 });
  assert.equal(broken.code, 1);
  assert.equal(broken.calls.length, 1);
  assert.match(broken.errors.at(-1), /^atf init: the workspace files above are in place, but npm install failed, .* run npm install there: its postinstall renders the host files\.$/);
  const missing = init([path.join(cwd, "ws4")], { cwd, spawn: () => ({ error: Object.assign(new Error("spawn npm ENOENT"), { code: "ENOENT" }) }) });
  assert.equal(missing.code, 1);
  assert.deepEqual(missing.errors.slice(0, 1), ["npm not found on PATH"]);
  // a failing check: exit 1 with its note, and no next steps
  const sick = init([path.join(cwd, "ws5")], { cwd, status: (n) => (n === 2 ? 1 : 0) });
  assert.equal(sick.code, 1);
  assert.match(sick.errors.at(-1), /^atf init: the workspace is set up, but the dependency check above found a problem/);
  assert.ok(!sick.logs.includes("Next:"));
});

test("init in a workspace where the package is installed: the sync runs in process, the doctor passes, atf check passes", () => {
  const { root, framework } = installedWorkspace();
  const r = init([], { cwd: root, framework, spawn: (cmd, args, opts) => spawnSync(cmd, args, { ...opts, stdio: "pipe", encoding: "utf8" }) });
  assert.deepEqual(kinds(r.plan), ["init", "sync", "doctor", "say"], "its package.json already has both: no install");
  assert.equal(r.code, 0, r.errors.join("\n"));
  for (const f of [".claude/agents/orchestrator-agent.md", ".github/agents/orchestrator-agent.agent.md", ".mcp.json", ".vscode/hooks/framework-guard.json"])
    assert.ok(existsSync(path.join(root, f)), f);
  const ignore = readFileSync(path.join(root, ".gitignore"), "utf8");
  assert.ok(ignore.indexOf(INIT_BLOCK_START) < ignore.indexOf(SYNC_BLOCK_START) && ignore.includes(SYNC_BLOCK_START), "both blocks, init's first");
  assert.ok(r.logs.includes("  present  package.json: left as it is") && r.logs.includes("  present  config/: left as it is"));
  assert.match(readFileSync(path.join(root, "AGENTS.md"), "utf8"), /`node_modules\/@testagentic\/atf\/docs\/platforms\.md`/);

  // what the doctor's child printed: the base group, all set
  const doctor = spawnSync(process.execPath, ["--input-type=module", "-e", DOCTOR_BASE_SCRIPT, root, FW_PKG.name], { cwd: root, encoding: "utf8" });
  assert.equal(doctor.status, 0, doctor.stdout + doctor.stderr);
  assert.match(doctor.stdout, /^Dependency check for the new workspace/);
  assert.match(doctor.stdout, /\[ ok \] host files in sync with the installed framework/);
  assert.match(doctor.stdout, /All set\.$/m);

  // atf check agrees, and init again leaves everything as it is
  const quiet = { log() {}, error() {} };
  assert.equal(run(plan(["check"], { workspace: root, framework }), { out: quiet }), 0);
  const again = init([], { cwd: root, framework, status: () => 0 });
  assert.equal(again.code, 0);
  assert.ok(again.logs.some((l) => l === "atf sync: the host files are up to date."));
});

test("installed here but package.json lacks a dependency: init adds it and runs npm install too", () => {
  const { root, framework } = installedWorkspace();
  put(root, "package.json", JSON.stringify({ name: "acme-tests", private: true, devDependencies: { [FW_PKG.name]: FW_PKG.version } }, null, 2) + "\n");
  const r = init(["--no-install"], { cwd: root, framework });
  assert.deepEqual(kinds(r.plan), ["init", "sync", "say"], "--no-install: the sync still runs, it installs nothing");
  assert.ok(r.logs.some((l) => /^ {2}\d\. npm install /.test(l)));
  put(root, "package.json", JSON.stringify({ name: "acme-tests", private: true, devDependencies: { [FW_PKG.name]: FW_PKG.version } }, null, 2) + "\n");
  assert.deepEqual(kinds(init([], { cwd: root, framework, status: () => 0 }).plan), ["init", "sync", "npm install", "doctor", "say"]);
});

test("init refuses a folder inside the framework, inside another workspace, holding the source checkout, or a file; usage is strict", () => {
  const err = (argv, cwd = tempRoot()) => plan(["init", ...argv], { cwd, framework: frameworkRoot, env: {} }).error;
  assert.match(err([path.join(frameworkRoot, "ws")]), /^atf init: .* is inside the framework itself \(.*\); create the workspace in a folder of its own$/);
  assert.match(err([frameworkRoot]), /is inside the framework itself/);
  const outer = tempRoot();
  put(outer, "atf/atf.json", "{}");
  assert.match(err(["sub/ws"], outer), new RegExp(`is inside the atf workspace ${outer.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&")} \\(it has atf/atf\\.json\\), and a workspace can't hold another`));
  assert.equal(err(["--no-install"], outer), undefined, "the workspace itself may be initialized again");
  assert.match(err([path.dirname(frameworkRoot)]), /holds the framework's source checkout/);
  const root = tempRoot();
  put(root, "file.txt", "x");
  assert.match(err(["file.txt"], root), /is a file, not a folder/);
  assert.match(err(["a", "b"]), /^atf init: unexpected 'b'$/);
  assert.match(err(["--no-instal"]), /Unknown option '--no-instal'/);
  assert.match(err(["--install"]), /Unknown option '--install'/);
  assert.equal(statSync(root).isDirectory(), true);
});
