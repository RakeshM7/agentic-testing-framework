// src/activate.js on a fake vscode: what activation registers and hands the other owners, the status shown when the
// workspace or the framework is missing, and the terminal lines Basil's commands run.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { CHAT_HINT, CHAT_MODE, CHAT_OPEN, COMMANDS, HOSTS, LOGIN_CHOICES, NEW_PRODUCT_WAYS, STAGES, configArgs, doctorRows, failureReason, hostCliArgs, hostOf, sessionPlan, sessionTitle, start } from "../src/activate.js";
import { fakeContext, fakeVscode } from "./fake-vscode.mjs";

const tmp = () => realpathSync.native(mkdtempSync(path.join(tmpdir(), "atf-vscode-act-")));
const put = (root, rel, text = "") => {
  const f = path.join(root, ...rel.split("/"));
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, text);
};
// a workspace with the framework "installed" (enough for detection) and a product with two environments
function workspace({ marker = true, framework = true, products = true } = {}) {
  const root = tmp();
  if (marker) put(root, "atf/atf.json", "{}");
  if (framework) {
    put(root, "node_modules/@testagentic/atf/package.json", JSON.stringify({ name: "@testagentic/atf", version: "0.1.0" }));
    put(root, "node_modules/@testagentic/atf/bin/atf.mjs", "");
  }
  if (products) {
    put(root, "config/acme.yaml", "product: acme\n");
    put(root, "config/acme-uat.yaml", "product: acme\nenvironment: uat\n");
  }
  return root;
}
function activate(root, opts = {}) {
  const vscode = fakeVscode({ folders: root ? [root] : [], shellIntegration: true, ...opts });
  const ctx = fakeContext(opts.context);
  const got = {};
  const api = start(vscode, ctx, {
    cliOptions: opts.cliOptions,
    env: opts.env ?? {}, // the extension host's: no ATF_NPM_TOKEN unless a test gives one
    ...(opts.now ? { now: opts.now } : {}),
    registerSheets: (context, deps) => {
      got.sheets = { context, deps };
      return { refresh: () => (got.sheetRefreshes = (got.sheetRefreshes ?? 0) + 1) };
    },
    registerReport: (context, deps) => {
      got.report = { context, deps };
      if (opts.reportThrows) throw new Error("report broke");
    },
  });
  const run = (id, ...args) => vscode.commands.executeCommand(id, ...args);
  const lines = () => vscode.rec.terminals.map((t) => t.executed.at(-1));
  return { vscode, ctx, got, api, run, lines };
}

test("activation registers Basil's commands and the Products view, then hands deps to the sheets and the report", () => {
  const root = workspace();
  const { vscode, got, api, ctx } = activate(root);
  for (const id of COMMANDS) assert.ok(vscode.rec.commands.has(id), id);
  assert.deepEqual(vscode.rec.treeViews.map((v) => v.id), ["atf.runs"]);
  for (const g of [got.sheets, got.report]) {
    assert.equal(g.context, ctx);
    assert.deepEqual(Object.keys(g.deps).sort(), ["cli", "output", "vscode", "workspace"]);
    assert.equal(g.deps.output.name, "atf");
    assert.equal(typeof g.deps.cli.runJson, "function");
    assert.equal(typeof g.deps.cli.runInTerminal, "function");
    assert.equal(g.deps.workspace.root, root);
    assert.equal(g.deps.workspace.framework, path.join(root, "node_modules", "@testagentic", "atf"));
  }
  assert.equal(api.workspace.ok, true);
  assert.deepEqual([vscode.rec.context["atf.workspaceState"], vscode.rec.context["atf.active"]], ["ok", true]);
  assert.equal(vscode.rec.statusBar[0].visible, false);
  assert.equal(vscode.rec.messages.length, 0);
});

test("atf.refresh re-detects and refreshes every view, the sheets' included", async () => {
  const { run, got } = activate(workspace());
  await run("atf.refresh");
  await run("atf.refresh");
  assert.equal(got.sheetRefreshes, 2);
});

test("one part failing to load is logged; the rest still loads", () => {
  const { vscode } = activate(workspace(), { reportThrows: true });
  assert.ok(vscode.rec.output.lines.some((l) => l.startsWith("atf: the report failed to load: Error: report broke")));
  assert.ok(vscode.rec.commands.has("atf.run"));
});

test("a missing framework or workspace is said clearly, with the fix", async () => {
  const nofw = activate(workspace({ framework: false }));
  assert.equal(nofw.vscode.rec.context["atf.workspaceState"], "noFramework");
  assert.equal(nofw.vscode.rec.context["atf.active"], false);
  const [kind, msg, actions] = nofw.vscode.rec.messages[0];
  assert.equal(kind, "warning");
  assert.match(msg, /has no @testagentic\/atf installed yet .*Install the framework runs npm install there/);
  assert.deepEqual(actions, ["Install the framework"]);
  assert.equal(nofw.vscode.rec.statusBar[0].visible, true);
  assert.equal(nofw.vscode.rec.statusBar[0].command, "atf.refresh");
  assert.equal(nofw.vscode.rec.treeViews[0].message, undefined, "the Products view's welcome content says it, with its buttons (D-107)");
  await nofw.run("atf.run");
  assert.equal(nofw.vscode.rec.terminals.length, 0, "nothing runs without the framework");

  const nows = activate(workspace({ marker: false }));
  assert.equal(nows.vscode.rec.context["atf.workspaceState"], "noWorkspace");
  assert.match(nows.vscode.rec.messages[0][1], /has @testagentic\/atf installed but is not an atf project yet .*Set up atf in this folder makes it one/);
  assert.deepEqual(nows.vscode.rec.messages[0][2], ["Set up atf in this folder"]);

  // no project, or no folder: the Products view's welcome content has the buttons; no message on top of it
  const nothing = activate(tmp());
  assert.equal(nothing.vscode.rec.context["atf.workspaceState"], "noWorkspace");
  assert.match(nothing.api.workspace.message, /not an atf project .*Create new project… makes one.*Open existing project… opens one/);
  assert.doesNotMatch(nothing.api.workspace.message, /npx|npm install/);
  const noFolder = activate(null);
  assert.equal(noFolder.vscode.rec.context["atf.workspaceState"], "noFolder", "set at activation through a view or a command");
  assert.equal(noFolder.vscode.rec.context["atf.hasProducts"], false);
  await new Promise((r) => setImmediate(r));
  assert.equal(noFolder.vscode.rec.context["atf.registryConnected"], false);
  assert.deepEqual([...nothing.vscode.rec.messages, ...noFolder.vscode.rec.messages], []);
});

test("run and resume (claude, copilot-cli): an editor-area terminal named for the session, the node's product, environment, stage and module, or asked", async () => {
  const root = workspace();
  const pick = (label) => (items) => items.find((i) => (typeof i === "string" ? i : i.label + (i.description ? ` ${i.description}` : "")) === label);
  const a = activate(root, { quickPicks: [pick("acme uat"), pick("explore"), pick("$(list-flat) Every module")], config: { host: "copilot-cli" } });
  await a.run("atf.run", { kind: "product", product: "acme", environment: "default" });
  await a.run("atf.run"); // asked: acme uat
  await a.run("atf.resume", { kind: "stage", product: "acme", environment: "uat", stage: "testcases", module: "contacts" });
  await a.run("atf.resume", { kind: "module", product: "acme", environment: "default", module: "deals" }); // stage asked
  assert.deepEqual(a.lines(), [
    "npx --no atf run acme --host copilot",
    "npx --no atf run acme --env uat --host copilot",
    "npx --no atf resume acme --stage testcases --module contacts --env uat --host copilot",
    "npx --no atf resume acme --stage explore --module deals --host copilot",
  ]);
  assert.deepEqual(a.vscode.rec.terminals.map((t) => t.opts.name), ["atf run acme", "atf run acme (uat)", "atf resume acme (uat) · testcases contacts", "atf resume acme · explore deals"]);
  assert.ok(a.vscode.rec.terminals.every((t) => t.opts.location === a.vscode.TerminalLocation.Editor), "a tab in the editor area");
  assert.ok(a.vscode.rec.quickPicks[0].items.some((i) => i.newProduct), "run offers New product… too");
  assert.deepEqual(a.vscode.rec.quickPicks[1].items, STAGES, "no tree yet: every stage");
  assert.ok(a.vscode.rec.terminals.every((t) => t.opts.cwd === root && t.shown));

  const claude = activate(root, { config: { host: "claude" } });
  await claude.run("atf.run", { kind: "product", product: "acme", environment: "default" });
  assert.deepEqual(claude.lines(), ["npx --no atf run acme"], "claude is the CLI's default host");
  const unset = activate(root);
  await unset.run("atf.run", { kind: "product", product: "acme", environment: "default" });
  assert.deepEqual(unset.lines(), ["npx --no atf run acme"], "claude by default");
});

test("a product node with several environments asks which; run's picker offers New product…", async () => {
  const a = activate(workspace(), { quickPicks: ["uat", (items) => items.find((i) => i.newProduct), (items) => items.find((i) => i.how === "interview")] });
  await a.run("atf.run", { kind: "product", product: "acme" });
  await a.run("atf.run");
  assert.deepEqual(a.lines(), ["npx --no atf run acme --env uat", "npx --no atf interview"]);
  assert.deepEqual(a.vscode.rec.quickPicks[2].items, NEW_PRODUCT_WAYS);
});

// ---- the host setting ------------------------------------------------------------------------------------------------

test("atf.host: claude, copilot-chat or copilot-cli; the old copilot reads as copilot-cli and is rewritten where it is set", async () => {
  assert.deepEqual(HOSTS, ["claude", "copilot-chat", "copilot-cli"]);
  assert.deepEqual([hostOf("copilot"), hostOf("copilot-cli"), hostOf("copilot-chat"), hostOf("claude"), hostOf(undefined), hostOf("nonsense")], ["copilot-cli", "copilot-cli", "copilot-chat", "claude", "claude", "claude"]);
  assert.deepEqual([hostCliArgs("claude"), hostCliArgs("copilot-cli")], [[], ["--host", "copilot"]]);
  const a = activate(workspace(), { config: { host: "copilot" }, inspect: { host: { workspaceValue: "copilot", globalValue: "claude" } } });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(a.vscode.rec.updates, [["host", "copilot-cli", a.vscode.ConfigurationTarget.Workspace]]);
  assert.ok(a.vscode.rec.output.lines.some((l) => l.includes("atf.host setting 'copilot' is now 'copilot-cli'")));
  await a.run("atf.run", { kind: "product", product: "acme", environment: "default" });
  assert.deepEqual(a.lines(), ["npx --no atf run acme --host copilot"]);
  const fresh = activate(workspace(), { inspect: { host: {} } });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(fresh.vscode.rec.updates, [], "nothing to migrate");
});

// ---- New product… and Open config ------------------------------------------------------------------------------------

// A fake `atf config` behind the background runner: steps(child, { argv, write }) plays what the CLI would print and
// write; a cancel (the process group's SIGTERM) closes it.
function fakeAtf(root, steps) {
  const calls = [];
  const killed = [];
  const spawn = (cmd, argv, opts) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.pid = 1000 + calls.length;
    child.kill = () => child.emit("close", null);
    calls.push({ cmd, argv, opts, child });
    setImmediate(() => steps(child, { argv, write: () => put(root, `config/${argv[2]}.yaml`, `product: ${argv[2]}\n`) }));
    return child;
  };
  const killProcess = (pid, sig) => {
    killed.push([pid, sig]);
    calls.find((c) => c.child.pid === -pid)?.child.emit("close", null);
  };
  return { calls, killed, cliOptions: { spawn, platform: "linux", killProcess } };
}
const say = (child, stream, ...lines) => child[stream].emit("data", Buffer.from(lines.map((l) => `${l}\n`).join("")));
const way = (how) => (items) => items.find((i) => i.how === how);
const loginPick = (login) => (items) => items.find((i) => i.login === login);
const BIN = (root) => path.join(root, "node_modules", "@testagentic", "atf", "bin", "atf.mjs");

test("New product…, set up myself, with a login: atf config in the background, its steps in a cancellable notification", async () => {
  const root = workspace({ products: false });
  put(root, "config/acme.yaml", "product: acme\n");
  const atf = fakeAtf(root, (child, { write }) => {
    write();
    say(child, "stdout", "Created config/acme-crm.yaml. Still to fill in by hand: modules, knowledge.references, testcases.output_format.");
    say(child, "stdout", "{", '  "ok": true', "}");
    say(child, "stderr", "Microsoft Edge is open on https://crm.example.com: sign in within 60 seconds. The window closes by itself and saves the session; do not close it yourself.");
    child.emit("close", 0);
  });
  const a = activate(root, { cliOptions: atf.cliOptions, config: { host: "copilot" }, quickPicks: [way("config"), loginPick(true)], inputs: ["acme-crm", " https://crm.example.com "], messageAnswers: ["Start run"] });
  await a.run("atf.newProduct");

  // the boxes check as the human types
  const [name, url] = a.vscode.rec.inputs;
  assert.match(name.validateInput("acme"), /^config\/acme\.yaml already exists/);
  assert.match(name.validateInput("Acme CRM"), /is not a lowercase kebab-case slug/);
  assert.equal(name.validateInput("acme-erp"), null);
  assert.match(name.validateInput("acme-crm"), /already exists/, "now that it is created");
  assert.match(url.validateInput("crm.example.com"), /is not an http\(s\) URL/);
  assert.equal(url.validateInput("https://crm.example.com"), null);
  assert.deepEqual(a.vscode.rec.quickPicks[1].items, LOGIN_CHOICES);
  assert.equal(LOGIN_CHOICES[0].label, "Log in now", "the login is the default");

  // the exact command, in the background: no terminal for it, the workspace's ATF_ENV only
  assert.deepEqual(configArgs("acme-crm", "https://crm.example.com", { login: true }), ["config", "acme-crm", "--url", "https://crm.example.com"]);
  assert.equal(atf.calls.length, 1);
  assert.deepEqual(atf.calls[0].argv, [BIN(root), "config", "acme-crm", "--url", "https://crm.example.com"]);
  assert.deepEqual([atf.calls[0].opts.shell, atf.calls[0].opts.cwd, atf.calls[0].opts.env.ATF_ENV], [false, root, ""]);
  const [progress] = a.vscode.rec.progress;
  assert.deepEqual([progress.opts.location, progress.opts.cancellable, progress.opts.title], [a.vscode.ProgressLocation.Notification, true, "New product acme-crm"]);
  assert.deepEqual(progress.reports, ["Creating config/acme-crm.yaml…", "Opening Microsoft Edge for the login…", "Waiting for you to sign in in Microsoft Edge… It closes by itself when the time is up."]);
  assert.ok(a.vscode.rec.output.lines.some((l) => l.includes("Microsoft Edge is open on")), "the output is in the atf channel");

  // done: the message offers the config and the run; Start run runs atf.run for the new product
  const [kind, msg, actions] = a.vscode.rec.messages[0];
  assert.equal(kind, "info");
  assert.match(msg, /^atf: config\/acme-crm\.yaml is ready, with your login saved\. Fill in its modules/);
  assert.deepEqual(actions, ["Open config", "Start run"]);
  assert.deepEqual(a.lines(), ["npx --no atf run acme-crm --host copilot"], "the run is the only terminal");
});

test("New product… without a login: --no-login, and Open config opens config/<product>.yaml", async () => {
  const root = workspace();
  const atf = fakeAtf(root, (child, { write }) => {
    write();
    say(child, "stdout", "Created config/beta.yaml. Still to fill in by hand: modules.");
    child.emit("close", 0);
  });
  const a = activate(root, { cliOptions: atf.cliOptions, quickPicks: [way("config"), loginPick(false)], inputs: ["beta", "http://localhost:3000"], messageAnswers: ["Open config"] });
  await a.run("atf.newProduct");
  assert.deepEqual(atf.calls[0].argv.slice(1), ["config", "beta", "--url", "http://localhost:3000", "--no-login"]);
  assert.deepEqual(a.vscode.rec.progress[0].reports, ["Creating config/beta.yaml…"]);
  assert.match(a.vscode.rec.messages[0][1], /^atf: config\/beta\.yaml is ready\. Fill in/);
  assert.deepEqual(a.vscode.rec.opened, [[path.join(root, "config", "beta.yaml"), { preview: false }]]);
  assert.equal(a.vscode.rec.terminals.length, 0);
});

test("New product…, the interview: an agent session, opened as atf.run opens one", async () => {
  const picked = activate(workspace(), { quickPicks: [way("interview")], config: { host: "copilot-cli" } });
  await picked.run("atf.newProduct");
  const linked = activate(workspace(), { config: { host: "claude" } });
  await linked.run("atf.newProduct", "interview"); // the welcome view's link: no pick
  assert.deepEqual(picked.lines(), ["npx --no atf interview --host copilot"]);
  assert.deepEqual(linked.lines(), ["npx --no atf interview"], "claude is the CLI's default, as for atf run");
  assert.equal(linked.vscode.rec.quickPicks.length, 0);
  assert.equal(linked.vscode.rec.terminals[0].opts.name, "atf interview");
  assert.equal(linked.vscode.rec.terminals[0].opts.location, linked.vscode.TerminalLocation.Editor);
  // a tree node passed by a menu is not a way: the pick is asked
  const node = activate(workspace(), { quickPicks: [undefined] });
  await node.run("atf.newProduct", { kind: "product", product: "acme" });
  assert.equal(node.vscode.rec.quickPicks.length, 1);
});

test("New product…: cancelling at any step runs nothing", async () => {
  const steps = [
    { quickPicks: [undefined] },
    { quickPicks: [way("config")], inputs: [undefined] },
    { quickPicks: [way("config")], inputs: ["beta", undefined] },
    { quickPicks: [way("config"), undefined], inputs: ["beta", "https://beta.example.com"] },
  ];
  for (const [i, s] of steps.entries()) {
    const root = workspace();
    const atf = fakeAtf(root, (child) => child.emit("close", 0));
    const a = activate(root, { cliOptions: atf.cliOptions, ...s });
    await a.run("atf.newProduct");
    assert.deepEqual([atf.calls.length, a.vscode.rec.terminals.length, a.vscode.rec.messages.length, a.vscode.rec.progress.length], [0, 0, 0, 0], `step ${i + 1}`);
  }
  // an input box left open while the file appeared: refused plainly, nothing run
  const root = workspace();
  const atf = fakeAtf(root, (child) => child.emit("close", 0));
  const late = activate(root, { cliOptions: atf.cliOptions, quickPicks: [way("config"), loginPick(false)], inputs: ["acme", "https://x.example.com"] });
  await late.run("atf.newProduct");
  assert.equal(atf.calls.length, 0);
  assert.match(late.vscode.rec.messages[0][1], /^atf: config\/acme\.yaml already exists/);
});

test("New product…: cancelling the notification kills atf config; a config already written is still offered", async () => {
  let token;
  const root = workspace();
  const atf = fakeAtf(root, (child, { write }) => {
    write();
    say(child, "stdout", "Created config/beta.yaml. Still to fill in by hand: modules.");
    setImmediate(() => token.cancel()); // the human cancels while the login waits
  });
  const a = activate(root, { cliOptions: atf.cliOptions, quickPicks: [way("config"), loginPick(true)], inputs: ["beta", "https://beta.example.com"], onProgress: (_p, t) => (token = t) });
  await a.run("atf.newProduct");
  assert.deepEqual(atf.killed, [[-1000, "SIGTERM"]], "the process group: the login's browser too");
  const [kind, msg, actions] = a.vscode.rec.messages[0];
  assert.equal(kind, "warning");
  assert.equal(msg, "atf: config/beta.yaml is created; the login was cancelled. Log in later with npx atf login beta.");
  assert.deepEqual(actions, ["Open config", "Start run"]);

  let t2;
  const root2 = workspace();
  const early = fakeAtf(root2, () => setImmediate(() => t2.cancel()));
  const b = activate(root2, { cliOptions: early.cliOptions, quickPicks: [way("config"), loginPick(false)], inputs: ["beta", "https://beta.example.com"], onProgress: (_p, t) => (t2 = t) });
  await b.run("atf.newProduct");
  assert.equal(early.killed.length, 1);
  assert.deepEqual(b.vscode.rec.messages, [], "nothing was written: nothing to say");
});

test("New product…: a failure says why, with Show output (and the config when it was written)", async () => {
  const root = workspace();
  const atf = fakeAtf(root, (child, { write }) => {
    write();
    say(child, "stdout", "Created config/beta.yaml. Still to fill in by hand: modules.", "{", '  "errors": [', '    "the browser closed before a session could be saved: run the login again"', "  ]", "}");
    child.emit("close", 1);
  });
  const a = activate(root, { cliOptions: atf.cliOptions, quickPicks: [way("config"), loginPick(true)], inputs: ["beta", "https://beta.example.com"], messageAnswers: ["Show output"] });
  await a.run("atf.newProduct");
  const [kind, msg, actions] = a.vscode.rec.messages[0];
  assert.equal(kind, "error");
  assert.equal(msg, "atf: config/beta.yaml is created, but the login failed: the browser closed before a session could be saved: run the login again");
  assert.deepEqual(actions, ["Open config", "Start run", "Show output"]);
  assert.equal(a.vscode.rec.output.shown, 1);

  const root2 = workspace();
  const refused = fakeAtf(root2, (child) => {
    say(child, "stderr", "--url 'x' must be an http(s) URL");
    child.emit("close", 2);
  });
  const b = activate(root2, { cliOptions: refused.cliOptions, quickPicks: [way("config"), loginPick(false)], inputs: ["beta", "https://beta.example.com"] });
  await b.run("atf.newProduct");
  assert.deepEqual(b.vscode.rec.messages[0], ["error", "atf: atf config beta failed: --url 'x' must be an http(s) URL", ["Show output"]]);
});

test("failureReason: a script's JSON errors, else the last stderr line, else the last stdout line", () => {
  const o = (line) => ({ line, stream: "stdout" });
  const e = (line) => ({ line, stream: "stderr" });
  assert.equal(failureReason([o("{"), o('  "errors": ["a", "b"]'), o("}"), e("noise")]), "a; b");
  assert.equal(failureReason([o("{"), o('  "ok": false'), o("}"), e("why"), e("  ")]), "why");
  assert.equal(failureReason([o("first"), o("last")]), "last");
  assert.equal(failureReason([]), null);
});

test("Open config: the product's run-config, asked among its environments; an environment's own; or offered New product…", async () => {
  const root = workspace();
  put(root, "config/solo.yaml", "product: solo\n");
  mkdirSync(path.join(root, "artifacts", "ghost", "modules"), { recursive: true });
  const a = activate(root, { quickPicks: [(items) => items.find((i) => i.label === "uat"), (items) => items.find((i) => i.label === "solo")], messageAnswers: [undefined] });
  await a.run("atf.openConfig", { kind: "product", product: "acme", environments: ["default", "uat"] });
  assert.deepEqual(a.vscode.rec.quickPicks[0].items.map((i) => [i.label, i.description]), [["default", "config/acme.yaml"], ["uat", "config/acme-uat.yaml"]]);
  await a.run("atf.openConfig", { kind: "environment", product: "acme", environment: "default" });
  await a.run("atf.openConfig", { kind: "product", product: "solo", environment: "default" });
  await a.run("atf.openConfig"); // the palette: every run-config
  assert.deepEqual(a.vscode.rec.quickPicks[1].items.map((i) => [i.label, i.description]), [["acme", "config/acme.yaml"], ["acme", "uat · config/acme-uat.yaml"], ["solo", "config/solo.yaml"]]);
  const f = (rel) => path.join(root, ...rel.split("/"));
  assert.deepEqual(a.vscode.rec.opened.map((o) => o[0]), [f("config/acme-uat.yaml"), f("config/acme.yaml"), f("config/solo.yaml"), f("config/solo.yaml")]);
  await a.run("atf.openConfig", { kind: "product", product: "ghost", environment: "default" });
  assert.deepEqual(a.vscode.rec.messages.at(-1), ["info", "atf: ghost has no run-config in config/.", ["New product…"]]);
});

test("no products yet: run, doctor and resume offer New product…, which starts the flow", async () => {
  const a = activate(workspace({ products: false }), { messageAnswers: ["New product…"], quickPicks: [undefined] });
  await a.run("atf.run");
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(a.vscode.rec.messages[0], ["info", "atf: no products yet. Create one first: its run-config says what to test and where.", ["New product…"]]);
  assert.deepEqual(a.vscode.rec.quickPicks[0].items, NEW_PRODUCT_WAYS);
  assert.equal(a.vscode.rec.terminals.length, 0);
});

// ---- the background commands, the doctor, the chat session and the sweep, over a fake node -----------------------------

// A fake node behind the runner: handle(child, { argv, opts, atf, plan }) plays the process. atf: the atf arguments
// when it runs bin/atf.mjs; plan: the atf arguments a cliPlan child plans. A cliPlan child is answered from plans
// (keyed by the planned argv joined with spaces) unless handle answers it.
const FW_OF = (root) => path.join(root, "node_modules", "@testagentic", "atf");
function fakeNode(root, handle, plans = {}) {
  const calls = [];
  const spawn = (cmd, argv, opts) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.pid = 2000 + calls.length;
    child.kill = () => child.emit("close", null);
    const atf = argv[0] === BIN(root) ? argv.slice(1) : null;
    const plan = argv[0] === "--input-type=module" ? JSON.parse(argv[4]) : null;
    calls.push({ cmd, argv, opts, child, atf, plan });
    setImmediate(() => {
      if (plan && plans[plan.join(" ")]) {
        say(child, "stdout", JSON.stringify(plans[plan.join(" ")]));
        return child.emit("close", 0);
      }
      handle(child, { argv, opts, atf, plan });
    });
    return child;
  };
  return { calls, cliOptions: { spawn, platform: "linux", killProcess: () => {} } };
}
const json = (child, value, code = 0) => {
  say(child, "stdout", ...JSON.stringify(value, null, 2).split("\n"));
  child.emit("close", code);
};

test("sync, check and validate run in the background behind a notification, then say how it went", async () => {
  const root = workspace();
  const node = fakeNode(root, (child, { atf }) => {
    if (atf[0] === "sync") return say(child, "stdout", "atf sync: updated: .claude/settings.json", "atf sync: 1 file(s) updated."), child.emit("close", 0);
    if (atf[0] === "check") return say(child, "stderr", "atf check: out of date: .claude/settings.json", "1 host file(s) out of date with the framework: run npx atf sync."), child.emit("close", 1);
    if (atf[0] === "validate") return json(child, { errors: ["modules: must list at least one module"] }, 1);
  });
  const a = activate(root, { cliOptions: node.cliOptions, messageAnswers: [undefined, "Show output", undefined] });
  await a.run("atf.sync");
  await a.run("atf.check");
  await a.run("atf.validate", { kind: "environment", product: "acme", environment: "uat" });
  assert.deepEqual(node.calls.map((c) => c.atf), [["sync"], ["check"], ["validate", "acme", "--env", "uat"]]);
  assert.ok(node.calls.every((c) => c.opts.env.ATF_ENV === "" && c.opts.shell === false && c.opts.cwd === root));
  assert.deepEqual(a.vscode.rec.progress.map((p) => [p.opts.title, p.opts.cancellable, p.opts.location]), [
    ["atf sync: the host files", true, a.vscode.ProgressLocation.Notification],
    ["atf check: the host files", true, a.vscode.ProgressLocation.Notification],
    ["atf validate acme (uat)", true, a.vscode.ProgressLocation.Notification],
  ]);
  assert.deepEqual(a.vscode.rec.progress[0].reports, ["atf sync: updated: .claude/settings.json", "atf sync: 1 file(s) updated."], "the latest line as it comes");
  assert.deepEqual(a.vscode.rec.messages, [
    ["info", "atf sync: 1 file(s) updated.", ["Show output"]],
    ["error", "atf: atf check failed: 1 host file(s) out of date with the framework: run npx atf sync.", ["Sync now", "Show output"]],
    ["error", "atf: atf validate acme (uat) failed: modules: must list at least one module", ["Show output"]],
  ]);
  assert.equal(a.vscode.rec.output.shown, 1);
  assert.equal(a.vscode.rec.terminals.length, 0, "no terminal");

  // a valid run-config, and a check's "Sync now"
  const ok = fakeNode(root, (child, { atf }) => (atf[0] === "check" ? (say(child, "stderr", "1 host file(s) out of date with the framework: run npx atf sync."), child.emit("close", 1)) : (say(child, "stdout", "{", "}"), child.emit("close", 0))));
  const b = activate(root, { cliOptions: ok.cliOptions, messageAnswers: [undefined, "Sync now", undefined] });
  await b.run("atf.validate", { kind: "product", product: "acme", environment: "default" });
  await b.run("atf.check");
  assert.deepEqual(b.vscode.rec.messages[0], ["info", "atf validate acme: the run-config is valid.", ["Show output"]]);
  assert.deepEqual(ok.calls.map((c) => c.atf), [["validate", "acme"], ["check"], ["sync"]]);
});

test("init runs in the background, in the folder, on the framework installed there; then offers New product…", async () => {
  const root = workspace({ marker: false });
  const node = fakeNode(root, (child, { opts }) => {
    put(opts.cwd, "atf/atf.json", "{}");
    say(child, "stdout", "atf init: " + opts.cwd, "  created atf/atf.json", "Next:", "  1. npx atf config <product> --url <target url>");
    child.emit("close", 0);
  });
  const a = activate(root, { cliOptions: node.cliOptions, messageAnswers: [undefined, "New product…"] });
  assert.equal(a.api.workspace.state, "noWorkspace");
  await a.run("atf.init");
  assert.deepEqual(node.calls.map((c) => [c.atf, c.opts.cwd]), [[["init"], root]]);
  assert.equal(a.vscode.rec.progress[0].opts.title, `atf init in ${path.basename(root)}`);
  assert.equal(a.api.workspace.state, "ok", "detected again");
  const [kind, msg, actions] = a.vscode.rec.messages.at(-1);
  assert.deepEqual([kind, msg, actions], ["info", `atf: the atf workspace is ready in ${root}. Next: create a product (New product…), then start its run.`, ["New product…", "Show output"]]);
  assert.equal(a.vscode.rec.terminals.length, 0);

  assert.equal(node.calls[0].opts.env.ATF_NPM_TOKEN, undefined, "no token, none passed");

  // with a token, init's npm install gets the registry's settings in its environment, the token masked in the log
  const root2 = workspace({ marker: false });
  const node2 = fakeNode(root2, (child, { opts }) => {
    put(opts.cwd, "atf/atf.json", "{}");
    say(child, "stderr", `npm error 401 Unauthorized - GET https://npm.pkg.github.com/@testagentic%2fatf - token ${opts.env.ATF_NPM_TOKEN}`);
    child.emit("close", 1);
  });
  const b = activate(root2, { cliOptions: node2.cliOptions, context: { secrets: { "atf.registryToken": "ghp_secretvalue" } } });
  await b.run("atf.init");
  assert.equal(node2.calls[0].opts.env.ATF_NPM_TOKEN, "ghp_secretvalue");
  assert.equal(node2.calls[0].opts.env["npm_config_@testagentic:registry"], "https://npm.pkg.github.com");
  assert.ok(!b.vscode.rec.output.lines.join("\n").includes("ghp_secretvalue"), "never logged");
  assert.ok(!JSON.stringify(b.vscode.rec.messages).includes("ghp_secretvalue"), "never shown");

  // no package installed: Create new project… instead of a hand install
  const bare = activate(tmp());
  await bare.run("atf.init");
  assert.match(bare.vscode.rec.messages.at(-1)[1], /has no @testagentic\/atf installed\. Create new project… installs it from the registry/);
  assert.deepEqual(bare.vscode.rec.messages.at(-1)[2], ["Create new project…"]);
  assert.equal(bare.vscode.rec.progress.length, 0);
});

test("doctor: the CLI's doctor step with --json, its checks shown one per line with their fixes", async () => {
  const root = workspace();
  const doctorScript = path.join(FW_OF(root), "scripts", "doctor.mjs");
  const checks = [
    { id: "node", group: "base", ok: true, level: "fail", detail: "Node.js v22.1.0" },
    { id: "k6", group: "k6", ok: false, level: "fail", detail: "k6 is not installed", fix: "brew install k6" },
    { id: "plugin-enabled", group: "base", ok: true, level: "warn", detail: ".claude/settings.json does not enable the plugin", fix: "npx atf sync" },
  ];
  const plans = { "doctor acme --env uat": { steps: [{ script: doctorScript, args: ["config/acme-uat.yaml", "--fix"], env: { ATF_ENV: "uat" } }] }, "doctor acme": { steps: [{ script: doctorScript, args: ["config/acme.yaml", "--fix"], env: {} }] } };
  let healthy = false;
  const node = fakeNode(
    root,
    (child) => {
      say(child, "stdout", "Fixing: npm install  (in /x)", "added 3 packages");
      json(child, { scope: "every chosen stage", checks: healthy ? checks.slice(0, 1) : checks, fixed: healthy ? [] : ["npm install"] }, healthy ? 0 : 1);
    },
    plans,
  );
  const a = activate(root, { cliOptions: node.cliOptions, quickPicks: [(items) => items.at(-1)] });
  await a.run("atf.doctor", { kind: "environment", product: "acme", environment: "uat" });
  assert.deepEqual(node.calls[0].plan, ["doctor", "acme", "--env", "uat"], "the CLI's own plan first");
  assert.deepEqual([node.calls[0].opts.env.ATF_WORKSPACE, node.calls[0].opts.env.ATF_ENV], [root, ""]);
  assert.deepEqual(node.calls[1].argv, [doctorScript, "config/acme-uat.yaml", "--fix", "--json"]);
  assert.equal(node.calls[1].opts.env.ATF_ENV, "uat");
  const [shown] = a.vscode.rec.quickPicks;
  assert.equal(shown.opts.title, "atf doctor acme (uat): 1 blocking problem, 1 warning");
  assert.match(shown.opts.placeHolder, /It ran: npm install\./);
  assert.deepEqual(
    shown.items.map((i) => [i.label, i.description, i.detail]),
    [
      ["$(error) k6 is not installed", "fail", "fix: brew install k6"],
      ["$(warning) .claude/settings.json does not enable the plugin", "warn", "fix: npx atf sync"],
      ["$(pass) Node.js v22.1.0", "ok", undefined],
      ["$(output) Show output", "the doctor's full output, in the atf channel", undefined],
    ],
  );
  assert.equal(a.vscode.rec.output.shown, 1, "Show output picked");

  healthy = true;
  const b = activate(root, { cliOptions: node.cliOptions, messageAnswers: [undefined] });
  await b.run("atf.doctor", { kind: "environment", product: "acme", environment: "default" });
  assert.deepEqual(b.vscode.rec.messages.at(-1), ["info", "atf: atf doctor acme: all set for every chosen stage (1 check).", ["Show checks"]]);
  assert.equal(b.vscode.rec.quickPicks.length, 0);

  // the CLI's own refusal (no run-config), said as it is
  const none = fakeNode(root, (child) => json(child, { error: "No config/ghost.yaml" }));
  const c = activate(root, { cliOptions: none.cliOptions });
  await c.run("atf.doctor", { kind: "environment", product: "ghost", environment: "default" });
  assert.deepEqual(c.vscode.rec.messages.at(-1), ["error", "atf: No config/ghost.yaml", []]);
  assert.equal(none.calls.length, 1);
  assert.deepEqual(doctorRows([{ ok: false, level: "warn", detail: "x" }])[0].status, "warn", "a failed warning does not block");
});

test("copilot-chat: the CLI's pre-check, then its first prompt in VS Code Chat with the orchestrator-agent, never sent", async () => {
  const root = workspace();
  const doctorScript = path.join(FW_OF(root), "scripts", "doctor.mjs");
  const PROMPT = "Start or resume the run for config/acme.yaml: node node_modules/@testagentic/atf/scripts/run.mjs init config/acme.yaml (add --resume when a run is active), then follow run.mjs next. Finished stages stay done.";
  const plans = { "run acme --host copilot": { steps: [{ script: doctorScript, args: ["config/acme.yaml", "--fix", "--warn-only"], env: {} }, { agent: true, prompt: PROMPT }] } };
  const chats = [];
  const node = fakeNode(root, (child) => (say(child, "stdout", "Dependency check for every chosen stage:", "  [FAIL] k6 is not installed", "Blocked until fixed: k6."), child.emit("close", 0)), plans);
  const a = activate(root, { cliOptions: node.cliOptions, config: { host: "copilot-chat" }, external: [CHAT_OPEN], onExternal: (id, args) => void chats.push(args) });
  await a.run("atf.run", { kind: "product", product: "acme", environment: "default" });
  assert.deepEqual(node.calls.map((c) => c.plan ?? c.argv), [["run", "acme", "--host", "copilot"], [doctorScript, "config/acme.yaml", "--fix", "--warn-only"]], "the plan, then its pre-check");
  assert.equal(a.vscode.rec.progress[0].opts.title, "atf run acme: checking what it needs");
  assert.deepEqual(chats, [{ query: PROMPT, isPartialQuery: true, mode: CHAT_MODE }], "the CLI's prompt, put in the chat, not sent");
  assert.equal(CHAT_MODE, "orchestrator-agent");
  assert.deepEqual(a.vscode.rec.messages.map((m) => m.slice(0, 2)), [
    ["warning", "atf: atf run acme: Blocked until fixed: k6. The run's stage gate stops exactly those stages."],
    ["info", CHAT_HINT],
  ]);
  assert.equal(CHAT_HINT, "Choose orchestrator-agent in the chat's Agent dropdown, then press Enter.");
  assert.equal(a.vscode.rec.terminals.length, 0);

  // `mode` refused: the chat opens without it
  const tried = [];
  const b = activate(root, { cliOptions: node.cliOptions, config: { host: "copilot-chat" }, external: [CHAT_OPEN], onExternal: (id, args) => { tried.push(args); if (args.mode) throw new Error("unknown property mode"); } });
  await b.run("atf.run", { kind: "product", product: "acme", environment: "default" });
  assert.deepEqual(tried, [{ query: PROMPT, isPartialQuery: true, mode: CHAT_MODE }, { query: PROMPT, isPartialQuery: true }]);
  assert.equal(b.vscode.rec.messages.at(-1)[1], CHAT_HINT);
  assert.ok(b.vscode.rec.output.lines.some((l) => l.includes("opening the chat without it")));

  // the pre-check fails (resume's doctor has no --warn-only): no chat
  const resumePlan = { "resume acme --stage explore --host copilot": { steps: [{ script: doctorScript, args: ["config/acme.yaml", "--fix", "--stage", "explore"], env: {} }, { agent: true, prompt: "Resume…" }] } };
  const failing = fakeNode(root, (child) => (say(child, "stdout", "  [FAIL] Playwright's Chromium is not installed", "Blocked until fixed: explore."), child.emit("close", 1)), resumePlan);
  const c = activate(root, { cliOptions: failing.cliOptions, config: { host: "copilot-chat" }, external: [CHAT_OPEN], onExternal: (id, args) => void chats.push(args) });
  await c.run("atf.resume", { kind: "stage", product: "acme", environment: "default", stage: "explore" });
  assert.equal(chats.length, 1, "no new chat");
  assert.deepEqual(c.vscode.rec.messages.at(-1), ["error", "atf: atf resume acme · explore (its check) failed: Blocked until fixed: explore.", ["Show output"]]);
});

test("copilot-chat without VS Code Chat says so and offers a terminal host; another environment is offered Copilot CLI", async () => {
  const root = workspace();
  const node = fakeNode(root, () => assert.fail("nothing runs before the chat is known to exist"));
  const a = activate(root, { cliOptions: node.cliOptions, config: { host: "copilot-chat" }, messageAnswers: ["Use Copilot CLI"] });
  await a.run("atf.run", { kind: "product", product: "acme", environment: "default" });
  const [kind, msg, actions] = a.vscode.rec.messages[0];
  assert.equal(kind, "warning");
  assert.match(msg, /^atf: VS Code Chat is not available here \(no workbench\.action\.chat\.open\): install or enable GitHub Copilot Chat/);
  assert.deepEqual(actions, ["Use Claude Code", "Use Copilot CLI"]);
  assert.deepEqual(a.vscode.rec.updates, [["host", "copilot-cli", a.vscode.ConfigurationTarget.Workspace]]);
  assert.deepEqual(a.lines(), ["npx --no atf run acme --host copilot"]);

  const b = activate(root, { cliOptions: node.cliOptions, config: { host: "copilot-chat" }, external: [CHAT_OPEN], messageAnswers: ["Open in Copilot CLI"] });
  await b.run("atf.run", { kind: "environment", product: "acme", environment: "uat" });
  assert.match(b.vscode.rec.messages[0][1], /^atf: VS Code Chat can't give its session ATF_ENV=uat/);
  assert.equal(b.vscode.rec.messages[0][2][0].modal, true);
  assert.deepEqual(b.lines(), ["npx --no atf run acme --env uat --host copilot"]);
  assert.equal(node.calls.length, 0);
});

test("sessionTitle and sessionPlan: the tab's name, and the CLI's plan as a pre-check and a prompt", () => {
  assert.equal(sessionTitle(["run", "acme"]), "atf run acme");
  assert.equal(sessionTitle(["run", "acme", "--env", "uat"]), "atf run acme (uat)");
  assert.equal(sessionTitle(["resume", "acme", "--stage", "testcases", "--module", "contacts"]), "atf resume acme · testcases contacts");
  assert.equal(sessionTitle(["interview"]), "atf interview");
  assert.deepEqual(sessionPlan({ error: "No config/x.yaml" }), { error: "No config/x.yaml" });
  assert.deepEqual(sessionPlan({ steps: [{ script: "d.mjs", args: [], env: {} }, { agent: true, prompt: "p" }] }), { pre: [{ script: "d.mjs", args: [], env: {} }], prompt: "p" });
  assert.match(sessionPlan({ steps: [{ script: "d.mjs", args: [] }] }).error, /no agent session/);
  assert.match(sessionPlan({ steps: [{ other: "sync" }, { agent: true, prompt: "p" }] }).error, /can't run \(sync\)/);
});

// ---- the sweep --------------------------------------------------------------------------------------------------------

const DRY = {
  dryRun: true,
  deleted: [],
  failed: [],
  manual: [{ runId: "acme-run-1", type: "contact", ref: "c-9", module: "contacts", reason: "no cleanup recipe was recorded with it" }],
  wouldDelete: [
    { runId: "acme-run-1", type: "contact", ref: "42", label: "Test Co", module: "contacts", method: "DELETE", url: "https://api.acme.test/v1/contacts/42" },
    { runId: "acme-run-2", type: "contact", ref: "43", module: "contacts", method: "DELETE", url: "https://api.acme.test/v1/contacts/43" },
  ],
};
const LEDGER = (root) => path.join(FW_OF(root), "scripts", "ledger.mjs");

test("sweep: the dry run listed, a modal warning, the product slug typed, then the sweep through its one-time confirmation", async () => {
  const root = workspace();
  put(root, "artifacts/acme/state/run.json", "{}");
  const confirm = path.join(root, "artifacts", "acme", "state", "sweep-confirm.json");
  let body;
  const node = fakeNode(root, (child, { argv }) => {
    if (argv[0] !== LEDGER(root)) return json(child, { errors: ["not this test's"] }, 1); // the Runs view's own reads
    if (argv.includes("--dry-run")) return json(child, DRY);
    body = JSON.parse(readFileSync(argv[argv.indexOf("--confirm-file") + 1], "utf8"));
    json(child, { dryRun: false, deleted: [{ ...DRY.wouldDelete[0], status: 204 }], failed: [], manual: DRY.manual });
  });
  const a = activate(root, { cliOptions: node.cliOptions, quickPicks: [(items) => items.find((i) => i.run === "acme-run-1")], messageAnswers: ["Continue…", undefined], inputs: ["acme"] });
  await a.run("atf.sweep", { kind: "product", product: "acme", environment: "default" });

  // 1. the dry run, in the background, listed with what must be cleaned by hand
  const ledger = node.calls.filter((c) => c.argv[0] === LEDGER(root));
  assert.deepEqual(ledger[0].argv, [LEDGER(root), "sweep", "acme", "--dry-run"]);
  assert.equal(ledger[0].opts.env.ATF_ENV, "");
  const [list] = a.vscode.rec.quickPicks;
  assert.equal(list.opts.title, "atf sweep acme: 2 to delete, 1 by hand");
  assert.deepEqual(list.items.map((i) => i.label), [
    "$(trash) Delete all 2…",
    "$(trash) Delete run acme-run-1's 1…",
    "$(trash) Delete run acme-run-2's 1…",
    "Would be deleted",
    "$(trash) contact Test Co",
    "$(trash) contact 43",
    "Left for you to clean up by hand",
    "$(tools) contact c-9",
  ]);
  assert.equal(list.items[3].kind, a.vscode.QuickPickItemKind.Separator);
  assert.equal(list.items[4].detail, "DELETE https://api.acme.test/v1/contacts/42");
  assert.equal(list.items[7].detail, "clean up by hand: no cleanup recipe was recorded with it");
  // 2. the modal warning names the target
  const [, warn, warnActions] = a.vscode.rec.messages[0];
  assert.equal(warn, "atf: this deletes live data in api.acme.test.");
  assert.equal(warnActions[0].modal, true);
  assert.match(warnActions[0].detail, /^1 entity that ended runs of acme left \(run acme-run-1\) will be deleted/);
  assert.deepEqual(warnActions.slice(1), ["Continue…"]);
  // 3. the typed slug, exact
  const [box] = a.vscode.rec.inputs;
  assert.equal(box.prompt, "Type the product slug acme to delete these 1 entity");
  for (const wrong of ["", "Acme", "acme ", "contacts"]) assert.equal(box.validateInput(wrong), "Type acme exactly to confirm");
  assert.equal(box.validateInput("acme"), null);
  // 4. the sweep with --run and the confirmation, which is gone afterwards
  assert.deepEqual(ledger[1].argv, [LEDGER(root), "sweep", "acme", "--run", "acme-run-1", "--confirm-file", confirm]);
  assert.deepEqual([body.action, body.product, body.environment, body.typed, body.module], ["sweep", "acme", "default", "acme", undefined]);
  assert.equal(existsSync(confirm), false);
  // 5. the result
  assert.deepEqual(a.vscode.rec.messages[1], ["info", "atf: atf sweep acme: deleted 1, 1 to clean up by hand.", ["Show output"]]);
  assert.ok(a.vscode.rec.output.lines.some((l) => l.includes("contact Test Co (contacts · run acme-run-1): DELETE https://api.acme.test/v1/contacts/42")));
});

test("sweep: nothing to delete asks nothing; a refusal, a cancel or a wrong slug runs nothing", async () => {
  const root = workspace();
  put(root, "artifacts/acme/state/run.json", "{}");
  put(root, "artifacts/acme/envs/uat/state/run.json", "{}");
  const confirm = path.join(root, "artifacts", "acme", "state", "sweep-confirm.json");
  const dry = (answer, code = 0) => {
    const n = fakeNode(root, (child, { argv }) => (argv[0] !== LEDGER(root) ? json(child, { errors: ["not this test's"] }, 1) : argv.includes("--dry-run") ? json(child, answer, code) : json(child, { errors: ["only the dry run may run"] }, 1)));
    n.ledger = () => n.calls.filter((c) => c.argv[0] === LEDGER(root));
    return n;
  };
  const target = { kind: "product", product: "acme", environment: "default" };

  const manualOnly = dry({ ...DRY, wouldDelete: [] });
  const a = activate(root, { cliOptions: manualOnly.cliOptions, messageAnswers: [undefined] });
  await a.run("atf.sweep", target);
  assert.deepEqual(a.vscode.rec.messages, [["info", "atf: atf sweep acme: nothing to delete. 1 entity must be cleaned up by hand.", ["Show the list"]]]);
  assert.deepEqual([a.vscode.rec.inputs.length, manualOnly.ledger().length], [0, 1]);

  const nothing = dry({ ...DRY, wouldDelete: [], manual: [] });
  const b = activate(root, { cliOptions: nothing.cliOptions });
  await b.run("atf.sweep", { kind: "environment", product: "acme", environment: "uat" });
  assert.deepEqual(b.vscode.rec.messages, [["info", "atf: atf sweep acme (uat): nothing is left over from ended runs.", []]]);
  assert.equal(nothing.ledger()[0].opts.env.ATF_ENV, "uat");

  const refused = dry({ errors: ["a run is active for 'acme': end it first (node node_modules/@testagentic/atf/scripts/run.mjs end acme); the sweep never races a run's own cleanup"] }, 1);
  const c = activate(root, { cliOptions: refused.cliOptions });
  await c.run("atf.sweep", target);
  assert.deepEqual(c.vscode.rec.messages.map((m) => m.slice(0, 2)), [["warning", "atf: atf sweep acme: a run is active for 'acme': end it first (node node_modules/@testagentic/atf/scripts/run.mjs end acme); the sweep never races a run's own cleanup"]]);

  for (const [i, opts] of [
    { quickPicks: [undefined] },
    { quickPicks: [(items) => items.find((x) => x.label === "$(trash) contact 43")] }, // a listed entity is not an action
    { quickPicks: [(items) => items[0]], messageAnswers: [undefined] },
    { quickPicks: [(items) => items[0]], messageAnswers: ["Continue…"], inputs: [undefined] },
    { quickPicks: [(items) => items[0]], messageAnswers: ["Continue…"], inputs: ["Acme"] },
  ].entries()) {
    const n = dry(DRY);
    const d = activate(root, { cliOptions: n.cliOptions, ...opts });
    await d.run("atf.sweep", target);
    assert.deepEqual(n.ledger().map((c) => c.argv.includes("--dry-run")), [true], `case ${i}: the dry run only`);
    assert.equal(existsSync(confirm), false, `case ${i}: no confirmation written`);
  }
});
