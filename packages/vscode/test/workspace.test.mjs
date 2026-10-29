// src/workspace.js: finding the atf workspace among the window's folders and the installed framework, the messages for
// what is missing, and the products and environments the layout holds. Real temp dirs, no VS Code.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createWorkspace, detectWorkspace, envArgs, findFramework, findWorkspaceRoot, listModules, listProducts, reportFile, stateDir, topLevelScalar } from "../src/workspace.js";
import { fakeVscode } from "./fake-vscode.mjs";

const tmp = () => realpathSync.native(mkdtempSync(path.join(tmpdir(), "atf-vscode-ws-")));
const put = (root, rel, text = "") => {
  const f = path.join(root, ...rel.split("/"));
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, text);
};
const install = (dir, { name = "@testagentic/atf", version = "0.1.0", bin = true } = {}) => {
  put(dir, "node_modules/@testagentic/atf/package.json", JSON.stringify({ name, version }));
  if (bin) put(dir, "node_modules/@testagentic/atf/bin/atf.mjs", "");
};

test("the workspace is the first folder holding atf/atf.json, among several", () => {
  const [a, b, c] = [tmp(), tmp(), tmp()];
  put(b, "atf/atf.json", "{}");
  put(c, "atf/atf.json", "{}");
  assert.deepEqual(findWorkspaceRoot([a, b, c]), { root: b, folder: b });
  assert.equal(findWorkspaceRoot([a]), null);
});

test("a folder inside a workspace finds it above, as the CLI does", () => {
  const ws = tmp();
  put(ws, "atf/atf.json", "{}");
  const inner = path.join(ws, "playwright-tests", "acme");
  mkdirSync(inner, { recursive: true });
  assert.deepEqual(findWorkspaceRoot([inner]), { root: ws, folder: inner });
});

test("the framework is node_modules/@testagentic/atf with bin/atf.mjs, here or above (hoisted)", () => {
  const top = tmp();
  const ws = path.join(top, "client");
  mkdirSync(ws);
  assert.equal(findFramework(ws), null);
  install(top);
  assert.deepEqual(findFramework(ws), { dir: path.join(top, "node_modules", "@testagentic", "atf"), version: "0.1.0" });
  install(ws, { version: "0.2.0" });
  assert.equal(findFramework(ws).version, "0.2.0", "the nearest wins");
});

test("another package, or one without bin/atf.mjs, is not the framework", () => {
  const a = tmp();
  install(a, { name: "atf" });
  assert.equal(findFramework(a), null);
  const b = tmp();
  install(b, { bin: false });
  assert.equal(findFramework(b), null);
});

test("detection says what is missing and how to get it", () => {
  assert.equal(detectWorkspace([]).state, "noFolder");

  const empty = tmp();
  const none = detectWorkspace([empty]);
  assert.equal(none.state, "noWorkspace");
  assert.match(none.message, /npm install --save-dev @testagentic\/atf/);
  assert.match(none.message, /npx atf init/);

  const installed = tmp();
  install(installed);
  const init = detectWorkspace([empty, installed]);
  assert.equal(init.state, "noWorkspace");
  assert.equal(init.folder, installed, "the folder atf init would run in");
  assert.match(init.message, /Run npx atf init in/);

  const ws = tmp();
  put(ws, "atf/atf.json", "{}");
  const nofw = detectWorkspace([ws]);
  assert.equal(nofw.state, "noFramework");
  assert.equal(nofw.root, ws);
  assert.match(nofw.message, /has no @testagentic\/atf installed\. Run npm install there/);

  install(ws);
  const ok = detectWorkspace([ws]);
  assert.deepEqual([ok.state, ok.root, ok.framework, ok.frameworkVersion, ok.message], ["ok", ws, path.join(ws, "node_modules", "@testagentic", "atf"), "0.1.0", null]);

  put(ws, "atf/atf.json", "﻿{}");
  assert.equal(detectWorkspace([ws]).state, "ok", "a BOM is not a broken marker");
  put(ws, "atf/atf.json", "{ nope");
  const bad = detectWorkspace([ws]);
  assert.equal(bad.state, "badMarker");
  assert.match(bad.message, /can't be read/);
});

test("a run-config's product and environment are read without a YAML parser", () => {
  const text = "# comment\nproduct: acme-crm   # the slug\nenvironment: 'staging'\ntarget:\n  product: nested\n";
  assert.equal(topLevelScalar(text, "product"), "acme-crm");
  assert.equal(topLevelScalar(text, "environment"), "staging");
  assert.equal(topLevelScalar('product: "q"\n', "product"), "q");
  assert.equal(topLevelScalar("modules:\n  - x\n", "product"), null);
  assert.equal(topLevelScalar("product: {a: 1}\n", "product"), null);
});

test("products and environments come from config/ and artifacts/", () => {
  const ws = tmp();
  put(ws, "config/acme.yaml", "product: acme\n");
  put(ws, "config/acme-staging.yaml", "product: acme\nenvironment: staging\n");
  put(ws, "config/permissions.yaml", "agents: {}\n");
  put(ws, "config/broken.yaml", "product: Not A Slug\n");
  mkdirSync(path.join(ws, "artifacts", "acme", "state"), { recursive: true });
  mkdirSync(path.join(ws, "artifacts", "acme", "envs", "uat", "state"), { recursive: true });
  mkdirSync(path.join(ws, "artifacts", "acme", "envs", "empty"), { recursive: true });
  mkdirSync(path.join(ws, "artifacts", "legacy", "modules", "contacts"), { recursive: true });
  mkdirSync(path.join(ws, "artifacts", "acme", "modules", "deals"), { recursive: true });
  mkdirSync(path.join(ws, "artifacts", "acme", "modules", "contacts"), { recursive: true });
  put(ws, "artifacts/hook-errors.jsonl", "");
  assert.deepEqual(listProducts(ws), [
    {
      product: "acme",
      environments: [
        { name: "default", config: "config/acme.yaml", state: path.join(ws, "artifacts", "acme", "state") },
        { name: "staging", config: "config/acme-staging.yaml", state: null },
        { name: "uat", config: null, state: path.join(ws, "artifacts", "acme", "envs", "uat", "state") },
      ],
    },
    { product: "legacy", environments: [{ name: "default", config: null, state: null }] },
  ]);
  assert.deepEqual(listModules(ws, "acme"), ["contacts", "deals"]);
  assert.deepEqual(listProducts(tmp()), []);
});

test("artifact paths follow the contract's environments", () => {
  const ws = tmp();
  assert.equal(stateDir(ws, "acme"), path.join(ws, "artifacts", "acme", "state"));
  assert.equal(stateDir(ws, "acme", "uat"), path.join(ws, "artifacts", "acme", "envs", "uat", "state"));
  assert.equal(reportFile(ws, "acme", "acme-1"), path.join(ws, "artifacts", "acme", "results", "acme-1", "report", "index.html"));
  assert.deepEqual(envArgs("default"), []);
  assert.deepEqual(envArgs(undefined), []);
  assert.deepEqual(envArgs("uat"), ["--env", "uat"]);
});

test("createWorkspace sets the context keys and fires onDidRefresh when the detection changes", () => {
  const ws = tmp();
  put(ws, "atf/atf.json", "{}");
  const vscode = fakeVscode({ folders: [ws] });
  const w = createWorkspace(vscode);
  assert.equal(w.state, "noFramework");
  assert.equal(w.ok, false);
  assert.equal(vscode.rec.context["atf.workspaceState"], "noFramework");
  assert.equal(vscode.rec.context["atf.active"], false);
  let fired = 0;
  w.onDidRefresh(() => fired++);
  w.detect();
  assert.equal(fired, 0, "nothing changed");
  install(ws);
  w.detect();
  assert.equal(fired, 1);
  assert.equal(w.ok, true);
  assert.equal(vscode.rec.context["atf.active"], true);
  w.detect({ fire: true });
  assert.equal(fired, 2, "atf.refresh always fires");
  assert.equal(w.uri("config").fsPath, path.join(ws, "config"));
});
