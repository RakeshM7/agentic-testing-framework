// src/runs.js: the Runs tree's model over real `run.mjs status` JSON and the read-only next() (runs started in temp
// workspaces with the framework's own test helpers), its tree items, the change filter, the loader through the real
// CLI on an installed copy of the framework, and the view's registration on a fake vscode.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { createCli } from "../src/cli.js";
import { NEXT_MODULE, WATCH_GLOBS, buildRunTree, debounce, loadSnapshot, readHistory, registerRuns, relevantChange, stageState, toTreeItem } from "../src/runs.js";
import { fakeContext, fakeVscode } from "./fake-vscode.mjs";

const CORE = path.resolve(import.meta.dirname, "..", "..", "core", "scripts");
const core = (rel) => import(pathToFileURL(path.join(CORE, rel)).href);
const { endRun, next, status } = await core("run.mjs");
const { installedWorkspace, startRun, writeProductKnowledge } = await core("test-helpers.mjs");
const { paths, stageKey } = await core("lib/contract.mjs");

const editRun = (root, fn) => {
  const f = paths("acme", root).runFile;
  const run = JSON.parse(readFileSync(f, "utf8"));
  fn(run);
  writeFileSync(f, JSON.stringify(run, null, 2));
};
const find = (nodes, pred) => {
  for (const n of nodes) {
    if (pred(n)) return n;
    const hit = n.children && find(n.children, pred);
    if (hit) return hit;
  }
  return null;
};
const all = (nodes, pred, out = []) => {
  for (const n of nodes) {
    if (pred(n)) out.push(n);
    if (n.children) all(n.children, pred, out);
  }
  return out;
};
const one = (env) => [{ product: "acme", environments: [{ name: "default", config: "config/acme.yaml", history: [], reports: {}, ...env }] }];

test("a fresh run: the product, its active run, what starts next, and per-module stages", async () => {
  const { root } = startRun({ extra: ["steps: [explore, testcases]"] });
  const st = await status("acme", { root });
  const nx = await next("acme", { root });
  const [product] = buildRunTree(one({ status: st, next: nx }));
  assert.deepEqual([product.kind, product.contextValue, product.label, product.environment], ["product", "atf.product", "acme", "default"]);
  assert.equal(product.description, "acme-run-1");
  const [run] = product.children;
  assert.deepEqual([run.kind, run.contextValue, run.runId, run.active, run.product, run.environment], ["run", "atf.run", "acme-run-1", true, "acme", "default"]);
  assert.match(run.description, /^active · readonly · 0\/\d+ done$/);
  assert.match(run.tooltip, /guard not verified yet|mode: readonly/);

  // next: the knowledge pass, shown first and marked on its stage
  const nextItems = run.children.filter((n) => n.kind === "next");
  assert.deepEqual(nextItems.map((n) => n.label), ["Next: knowledge"]);
  assert.equal(nextItems[0].description, "knowledge-generator");
  const knowledge = find(run.children, (n) => n.kind === "stage" && n.stage === "knowledge");
  assert.deepEqual([knowledge.state, knowledge.next, knowledge.description, knowledge.icon[0]], ["pending", true, "pending · next", "arrow-circle-right"]);

  // modules hold their own stages; stages the run's steps don't choose are not-chosen
  const modules = run.children.filter((n) => n.kind === "module");
  assert.deepEqual(modules.map((m) => [m.label, m.contextValue, m.module, m.runId, m.product]), [["contacts", "atf.module", "contacts", "acme-run-1", "acme"], ["deals", "atf.module", "deals", "acme-run-1", "acme"]]);
  const contacts = modules[0];
  assert.ok(contacts.children.every((s) => s.kind === "stage" && s.module === "contacts" && s.contextValue === "atf.stage"));
  const k6 = contacts.children.find((s) => s.stage === "k6");
  assert.deepEqual([k6.state, k6.icon[0]], ["not-chosen", "circle-slash"]);
  assert.equal(contacts.children.find((s) => s.stage === "explore").state, "pending");
  assert.ok(!run.children.some((n) => n.kind === "stage" && n.module), "module stages sit under their module");
  // the ids are unique (VS Code keeps expansion by id)
  const ids = all([product], () => true).map((n) => n.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("done, running, failed, blocked and unverified stages, and a run waiting on a running stage", async () => {
  const { root } = startRun();
  writeProductKnowledge(root);
  editRun(root, (run) => {
    run.stages[stageKey("knowledge")] = { status: "done", attempts: 1 };
    run.stages[stageKey("module-knowledge", "contacts")] = { status: "running", attempts: 1 };
    run.stages[stageKey("module-knowledge", "deals")] = { status: "failed", attempts: 2, error: "boom" };
    run.stages[stageKey("playwright-repo")] = { status: "done", attempts: 1 }; // its outputs don't exist
  });
  const st = await status("acme", { root });
  const nx = await next("acme", { root });
  // marked done with outputs that don't verify: offered again
  assert.deepEqual(nx.map((a) => [a.stage, a.attempt, a.retry]), [["playwright-repo", 2, true]]);
  const tree = buildRunTree(one({ status: st, next: nx }));
  const stage = (s, m = null) => find(tree, (n) => n.kind === "stage" && n.stage === s && n.module === m);
  assert.equal(stage("knowledge").state, "done");
  assert.equal(stage("module-knowledge", "contacts").state, "running");
  const failed = stage("module-knowledge", "deals");
  assert.deepEqual([failed.state, failed.description], ["failed", "failed · attempt 2, final"]);
  assert.match(failed.tooltip, /error: boom/);
  assert.equal(stage("explore", "deals").state, "blocked");
  const repo = stage("playwright-repo");
  assert.deepEqual([repo.state, repo.next, repo.description], ["unverified", true, "done, outputs don't verify · next (attempt 2)"]);
  assert.ok(repo.tooltip.split("\n").some((l) => l.startsWith("- ")), "the output problems are listed");
  assert.ok(find(tree, (n) => n.label === "Next: playwright-repo" && n.description === "pw-repo-owner · attempt 2"));
  // nothing ready while a stage runs
  assert.ok(find(buildRunTree(one({ status: st, next: [] })), (n) => n.label === "Waiting for 1 running stage(s)"));
  const deals = find(tree, (n) => n.kind === "module" && n.module === "deals");
  assert.match(deals.description, /^0\/\d+ done · failed$/);
  assert.equal(deals.expanded, true);
  assert.equal(find(tree, (n) => n.kind === "module" && n.module === "contacts").icon[0], "sync~spin");
});

test("an ended run: no active run, the history with its outcome, stages and report", async () => {
  const { root } = startRun();
  const summary = await endRun("acme", { root, abandon: true });
  const st = await status("acme", { root });
  const history = readHistory(paths("acme", root).state);
  assert.deepEqual(history.map((h) => h.runId), [summary.runId]);
  const report = path.join(root, "artifacts", "acme", "results", "acme-run-1", "report", "index.html");
  const [product] = buildRunTree(one({ status: st, next: null, history, reports: { "acme-run-1": report } }));
  assert.equal(product.description, "no active run");
  const [idle, hist] = product.children;
  assert.deepEqual([idle.kind, idle.label, idle.description, idle.command.command], ["message", "No active run", "last: acme-run-1", "atf.run"]);
  assert.deepEqual([hist.kind, hist.label, hist.description], ["history", "Ended runs", "1"]);
  const [ended] = hist.children;
  assert.deepEqual([ended.kind, ended.contextValue, ended.active, ended.outcome, ended.report], ["run", "atf.run", false, "abandoned", report]);
  assert.match(ended.description, /^abandoned · \d{4}-\d\d-\d\d \d\d:\d\d$/);
  const rep = ended.children[0];
  assert.deepEqual([rep.kind, rep.command.command, rep.command.arguments[0].runId, rep.command.arguments[0].product], ["report", "atf.openReport", "acme-run-1", "acme"]);
  assert.ok(ended.children.some((n) => n.kind === "module" && n.contextValue === "atf.module" && n.active === false));
  assert.ok(find(ended.children, (n) => n.kind === "stage" && n.stage === "knowledge").state === "pending");
});

test("several environments get their own level; no run and errors are messages", () => {
  const tree = buildRunTree([
    {
      product: "acme",
      environments: [
        { name: "default", config: "config/acme.yaml", status: null, statusError: "no run state for product 'acme' (run.mjs init first)", history: [] },
        { name: "uat", config: null, status: null, statusError: "atf status acme: timed out", history: [] },
      ],
    },
    { product: "legacy", environments: [{ name: "default", config: null, state: null, status: null, history: [] }] },
  ]);
  const [acme, legacy] = tree;
  assert.equal(acme.description, "2 environments");
  assert.deepEqual(acme.children.map((e) => [e.kind, e.contextValue, e.label, e.environment, e.description]), [
    ["environment", "atf.environment", "default", "default", "no run yet"],
    ["environment", "atf.environment", "uat", "uat", "status unavailable"],
  ]);
  const none = acme.children[0].children[0];
  assert.deepEqual([none.label, none.command.command, none.command.arguments[0]], ["No run yet", "atf.run", { kind: "environment", product: "acme", environment: "default" }]);
  assert.equal(acme.children[1].children[0].label, "Status unavailable");
  assert.equal(legacy.children[0].description, "npx atf config legacy --url <url>", "no config: how to make one");
  assert.equal(legacy.children[0].command, undefined);
});

test("stageState covers status rows and ended runs' summary rows", () => {
  assert.equal(stageState({ status: "not-chosen", notChosen: true }), "not-chosen");
  assert.equal(stageState({ status: "not-chosen" }), "not-chosen");
  assert.equal(stageState({ status: "awaiting-approval", awaitingApproval: true }), "awaiting-approval");
  assert.equal(stageState({ status: "done", complete: true }), "done");
  assert.equal(stageState({ status: "done", complete: false }), "unverified");
  assert.equal(stageState({ status: "pending", blocked: true }), "blocked");
  assert.equal(stageState({ status: "failed", blocked: false }), "failed");
  assert.equal(stageState({ status: "pending" }), "pending");
});

test("tree items carry the id, context value, icon and command", () => {
  const vscode = fakeVscode();
  const [product] = buildRunTree(one({ status: null, statusError: "no run state" }));
  const item = toTreeItem(product, vscode);
  assert.deepEqual([item.label, item.id, item.contextValue, item.collapsibleState, item.iconPath.id], ["acme", "p/acme", "atf.product", 2, "package"]);
  const msg = toTreeItem(product.children[0], vscode);
  assert.deepEqual([msg.collapsibleState, msg.command.command], [0, "atf.run"]);
  const failed = toTreeItem({ id: "x", label: "explore", contextValue: "atf.stage", icon: ["error", "testing.iconFailed"] }, vscode);
  assert.equal(failed.iconPath.color.id, "testing.iconFailed");
});

test("only changes that alter the view refresh it", () => {
  const root = path.resolve("ws");
  const at = (rel) => path.join(root, ...rel.split("/"));
  for (const rel of ["artifacts/acme/state/run.json", "artifacts/acme/state/lock.json", "artifacts/acme/state/history/acme-1.json", "artifacts/acme/envs/uat/state/run.json", "artifacts/acme/results/acme-1/report/index.html", "config/acme.yaml"])
    assert.equal(relevantChange(root, at(rel)), true, rel);
  for (const rel of ["artifacts/acme/state/telemetry.jsonl", "artifacts/acme/state/run.json.lock", "artifacts/acme/state/orchestration/k6-contacts.json", "artifacts/acme/modules/contacts/clarifications.csv", "config/sub/x.yaml"])
    assert.equal(relevantChange(root, at(rel)), false, rel);
  assert.deepEqual(WATCH_GLOBS, ["artifacts/*/state/**", "artifacts/*/envs/*/state/**", "artifacts/*/results/*/report/index.html", "config/*.yaml"]);
});

test("debounce runs once after the burst", async () => {
  let n = 0;
  const d = debounce(() => n++, 10);
  d.trigger();
  d.trigger();
  d.trigger();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(n, 1);
  d.trigger();
  d.dispose();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(n, 1);
});

test("the loader, through the real atf CLI of an installed framework: status, next, history and reports", async () => {
  const { root, framework } = installedWorkspace();
  const { initRun } = await import(pathToFileURL(path.join(framework, "scripts", "run.mjs")).href);
  const r = initRun(path.join(root, "config", "acme.yaml"), { root, framework, runId: "acme-run-1", env: {} });
  assert.ok(!r.errors, r.errors?.join("\n"));
  // an ended run in history, with a rendered report; and a config for another environment, never run
  const hist = path.join(root, "artifacts", "acme", "state", "history");
  mkdirSync(hist, { recursive: true });
  writeFileSync(path.join(hist, "acme-run-0.json"), JSON.stringify({ runId: "acme-run-0", outcome: "completed", endedAt: "2026-10-01T10:00:00Z", stages: [] }));
  writeFileSync(path.join(hist, "broken.json"), "{");
  mkdirSync(path.join(root, "artifacts", "acme", "results", "acme-run-0", "report"), { recursive: true });
  writeFileSync(path.join(root, "artifacts", "acme", "results", "acme-run-0", "report", "index.html"), "<html></html>");
  writeFileSync(path.join(root, "config", "acme-uat.yaml"), "product: acme\nenvironment: uat\n");

  const vscode = fakeVscode({ config: { nodePath: process.execPath } });
  const output = vscode.window.createOutputChannel("atf");
  const workspace = { ok: true, root, framework };
  const cli = createCli({ vscode, workspace, output, env: { ...process.env, ATF_ENV: "uat" } });
  const snap = await loadSnapshot({ workspace, cli });
  assert.deepEqual(snap.map((p) => [p.product, p.environments.map((e) => e.name)]), [["acme", ["default", "uat"]]]);
  const [def, uat] = snap[0].environments;
  assert.equal(def.statusError, null, def.statusError);
  assert.deepEqual([def.status.product, def.status.runId, def.status.active], ["acme", "acme-run-1", true], "ATF_ENV is reset for default");
  assert.deepEqual(def.next.map((a) => a.stage), ["knowledge"]);
  assert.deepEqual(def.history.map((h) => h.runId), ["acme-run-0"]);
  assert.deepEqual(Object.keys(def.reports), ["acme-run-0"]);
  assert.deepEqual([uat.status, uat.next], [null, null], "no state: nothing to ask");
  assert.ok(output.lines.some((l) => l.includes("status acme")));

  const tree = buildRunTree(snap);
  assert.equal(tree[0].description, "2 environments");
  assert.ok(find(tree, (n) => n.label === "Next: knowledge"));
  assert.ok(find(tree, (n) => n.kind === "report" && n.runId === "acme-run-0"));
});

test("NEXT_MODULE prints null for a framework without the read-only next()", async () => {
  const { root, framework } = installedWorkspace();
  writeFileSync(path.join(framework, "scripts", "run.mjs"), "export const x = 1;\n");
  const vscode = fakeVscode({ config: { nodePath: process.execPath } });
  const cli = createCli({ vscode, workspace: { root, framework }, output: vscode.window.createOutputChannel("atf") });
  assert.equal(await cli.runJson(["acme", root, framework], { eval: NEXT_MODULE }), null);
});

test("the view: registered as atf.runs, loaded from the snapshot, refreshed on onDidRefresh and watched", async () => {
  const { root } = startRun();
  const st = await status("acme", { root });
  const vscode = fakeVscode();
  const refreshEmitter = new vscode.EventEmitter();
  const workspace = { ok: true, root, framework: "/fw", message: null, onDidRefresh: refreshEmitter.event };
  const asked = [];
  const cli = {
    runJson: async (args, opts) => {
      asked.push([args, opts]);
      return opts.eval ? [] : st;
    },
  };
  const ctx = fakeContext();
  const runs = registerRuns(ctx, { vscode, workspace, cli, output: vscode.window.createOutputChannel("atf") });
  const [view] = vscode.rec.treeViews;
  assert.equal(view.id, "atf.runs");
  const roots = await view.opts.treeDataProvider.getChildren();
  assert.deepEqual(roots.map((n) => n.label), ["acme"]);
  assert.equal(asked.length, 2, "status and next");
  assert.deepEqual(asked[0][0], ["status", "acme"]);
  assert.equal(asked[0][1].env.ATF_ENV, "");
  assert.equal(asked[1][1].eval, NEXT_MODULE);
  assert.deepEqual(await view.opts.treeDataProvider.getChildren(roots[0]), roots[0].children);
  assert.deepEqual(vscode.rec.watchers.map((w) => w.pattern.pattern), WATCH_GLOBS);
  assert.ok(vscode.rec.watchers.every((w) => w.pattern.base.fsPath === path.resolve(root)));

  refreshEmitter.fire();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(asked.length, 4, "atf.refresh reloads");
  // a telemetry write doesn't reload; a run.json write does, after the debounce
  vscode.rec.watchers[0].change.fire(vscode.Uri.file(path.join(root, "artifacts", "acme", "state", "telemetry.jsonl")));
  vscode.rec.watchers[0].change.fire(vscode.Uri.file(path.join(root, "artifacts", "acme", "state", "run.json")));
  await new Promise((r) => setTimeout(r, 900));
  assert.equal(asked.length, 6);
  assert.equal(runs.nodes()[0].label, "acme");
  for (const d of ctx.subscriptions) d.dispose?.();
});

test("no workspace: an empty tree and no view message, so the welcome content for the state (with its buttons) shows", async () => {
  for (const state of ["noFolder", "noWorkspace", "noFramework", "badMarker"]) {
    const vscode = fakeVscode();
    const refreshEmitter = new vscode.EventEmitter();
    const workspace = { ok: false, state, root: state === "noFolder" ? null : "/w", message: `atf: ${state}`, onDidRefresh: refreshEmitter.event };
    const asked = [];
    const cli = { runJson: async (args) => (asked.push(args), {}) };
    const ctx = fakeContext();
    registerRuns(ctx, { vscode, workspace, cli, output: vscode.window.createOutputChannel("atf") });
    const [view] = vscode.rec.treeViews;
    assert.equal(view.message, undefined, state);
    assert.deepEqual(await view.opts.treeDataProvider.getChildren(), [], state);
    refreshEmitter.fire();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(view.message, undefined, `${state}: a refresh sets none either`);
    assert.deepEqual(asked, [], `${state}: nothing is asked of the CLI`);
    for (const d of ctx.subscriptions) d.dispose?.();
  }
});
