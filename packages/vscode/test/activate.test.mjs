// src/activate.js on a fake vscode: what activation registers and hands the other owners, the status shown when the
// workspace or the framework is missing, and the terminal lines Basil's commands run.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { COMMANDS, STAGES, start } from "../src/activate.js";
import { fakeContext, fakeVscode } from "./fake-vscode.mjs";

const tmp = () => realpathSync.native(mkdtempSync(path.join(tmpdir(), "atf-vscode-act-")));
const put = (root, rel, text = "") => {
  const f = path.join(root, ...rel.split("/"));
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, text);
};
// a workspace with the framework "installed" (enough for detection) and a product with two environments
function workspace({ marker = true, framework = true } = {}) {
  const root = tmp();
  if (marker) put(root, "atf/atf.json", "{}");
  if (framework) {
    put(root, "node_modules/@testagentic/atf/package.json", JSON.stringify({ name: "@testagentic/atf", version: "0.1.0" }));
    put(root, "node_modules/@testagentic/atf/bin/atf.mjs", "");
  }
  put(root, "config/acme.yaml", "product: acme\n");
  put(root, "config/acme-uat.yaml", "product: acme\nenvironment: uat\n");
  return root;
}
function activate(root, opts = {}) {
  const vscode = fakeVscode({ folders: root ? [root] : [], shellIntegration: true, ...opts });
  const ctx = fakeContext();
  const got = {};
  const api = start(vscode, ctx, {
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

test("activation registers Basil's commands and the Runs view, then hands deps to the sheets and the report", () => {
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
  assert.match(msg, /has no @testagentic\/atf installed\. Run npm install there/);
  assert.deepEqual(actions, ["Check again"]);
  assert.equal(nofw.vscode.rec.statusBar[0].visible, true);
  assert.equal(nofw.vscode.rec.statusBar[0].command, "atf.refresh");
  assert.equal(nofw.vscode.rec.treeViews[0].message, msg);
  await nofw.run("atf.run");
  assert.equal(nofw.vscode.rec.terminals.length, 0, "nothing runs without the framework");

  const nows = activate(workspace({ marker: false }));
  assert.equal(nows.vscode.rec.context["atf.workspaceState"], "noWorkspace");
  assert.match(nows.vscode.rec.messages[0][1], /Run npx atf init in/);
  assert.deepEqual(nows.vscode.rec.messages[0][2], ["Create workspace (init)"]);

  const nothing = activate(tmp());
  assert.match(nothing.vscode.rec.messages[0][1], /Install npm install --save-dev @testagentic\/atf .*then run npx atf init there/);
});

test("init runs npx --no atf init in a terminal, in the folder, only with the package there", async () => {
  const fresh = activate(workspace({ marker: false }));
  await fresh.run("atf.init");
  assert.deepEqual(fresh.lines(), ["npx --no atf init"]);
  assert.equal(fresh.vscode.rec.terminals[0].opts.cwd, fresh.api.workspace.folder);

  const bare = activate(tmp());
  await bare.run("atf.init");
  assert.equal(bare.vscode.rec.terminals.length, 0);
  assert.match(bare.vscode.rec.messages.at(-1)[1], /has no @testagentic\/atf installed\. Install it first/);
});

test("run, doctor, resume, sync and check: the node's product, environment, stage and module, or asked", async () => {
  const root = workspace();
  const pick = (label) => (items) => items.find((i) => (typeof i === "string" ? i : i.label + (i.description ? ` ${i.description}` : "")) === label);
  const a = activate(root, { quickPicks: [pick("acme uat"), pick("acme"), pick("explore"), pick("$(list-flat) Every module")], config: { host: "copilot" } });
  await a.run("atf.run", { kind: "product", product: "acme", environment: "default" });
  await a.run("atf.run"); // asked: acme uat
  await a.run("atf.doctor"); // asked: acme (default)
  await a.run("atf.resume", { kind: "stage", product: "acme", environment: "uat", stage: "testcases", module: "contacts" });
  await a.run("atf.resume", { kind: "module", product: "acme", environment: "default", module: "deals" }); // stage asked
  await a.run("atf.sync");
  await a.run("atf.check");
  assert.deepEqual(a.lines(), [
    "npx --no atf run acme --host copilot",
    "npx --no atf run acme --env uat --host copilot",
    "npx --no atf doctor acme",
    "npx --no atf resume acme --stage testcases --module contacts --env uat --host copilot",
    "npx --no atf resume acme --stage explore --module deals --host copilot",
    "npx --no atf sync",
    "npx --no atf check",
  ]);
  assert.ok(a.vscode.rec.quickPicks[0].items.some((i) => i.interview), "run offers the interview too");
  assert.deepEqual(a.vscode.rec.quickPicks[2].items, STAGES, "no tree yet: every stage");
  assert.ok(a.vscode.rec.terminals.every((t) => t.opts.cwd === root && t.shown));
});

test("a product node with several environments asks which; the interview is atf interview", async () => {
  const a = activate(workspace(), { quickPicks: ["uat", (items) => items.find((i) => i.interview)] });
  await a.run("atf.doctor", { kind: "product", product: "acme" });
  await a.run("atf.run");
  assert.deepEqual(a.lines(), ["npx --no atf doctor acme --env uat", "npx --no atf interview"]);
});
