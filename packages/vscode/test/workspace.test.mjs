// src/workspace.js: finding the atf workspace among the window's folders and the installed framework, the messages for
// what is missing, and the products and environments the layout holds. Real temp dirs, no VS Code.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { URL_RE, approvalEnvironment, configFileOf, createWorkspace, detectWorkspace, envArgs, findFramework, findWorkspaceRoot, listModules, listProducts, productNameProblem, reportFile, stateDir, targetUrlProblem, topLevelScalar } from "../src/workspace.js";
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
  // the messages point at the extension's own buttons (D-107), never at a terminal command
  const nofolder = detectWorkspace([]);
  assert.equal(nofolder.state, "noFolder");
  assert.match(nofolder.message, /Create new project… makes one; Open existing project… opens one you have/);

  const empty = tmp();
  const none = detectWorkspace([empty]);
  assert.equal(none.state, "noWorkspace");
  assert.match(none.message, /not an atf project .*Create new project… makes one.*Open existing project…/);
  for (const d of [nofolder, none]) assert.doesNotMatch(d.message, /npx|npm install/);

  const installed = tmp();
  install(installed);
  const init = detectWorkspace([empty, installed]);
  assert.equal(init.state, "noWorkspace");
  assert.equal(init.folder, installed, "the folder atf init would run in");
  assert.match(init.message, /Set up atf in this folder makes it one/);

  const ws = tmp();
  put(ws, "atf/atf.json", "{}");
  const nofw = detectWorkspace([ws]);
  assert.equal(nofw.state, "noFramework");
  assert.equal(nofw.root, ws);
  assert.match(nofw.message, /has no @testagentic\/atf installed yet .*Install the framework runs npm install there/);

  install(ws);
  const ok = detectWorkspace([ws]);
  assert.deepEqual([ok.state, ok.root, ok.framework, ok.frameworkVersion, ok.hasProducts, ok.message], ["ok", ws, path.join(ws, "node_modules", "@testagentic", "atf"), "0.1.0", false, null]);
  put(ws, "config/acme.yaml", "product: acme\n");
  assert.equal(detectWorkspace([ws]).hasProducts, true, "a product: atf.hasProducts");
  assert.equal(nofw.hasProducts, false);

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

test("approve's environment: the first, default first, whose last run lists the module; else default", () => {
  const ws = tmp();
  put(ws, "config/acme.yaml", "product: acme\n");
  put(ws, "config/acme-uat.yaml", "product: acme\nenvironment: uat\n");
  assert.equal(approvalEnvironment(ws, "acme", "contacts"), "default", "no run anywhere");
  put(ws, "artifacts/acme/envs/uat/state/run.json", JSON.stringify({ modules: ["contacts"] }));
  put(ws, "artifacts/acme/state/run.json", JSON.stringify({ modules: ["deals"] }));
  assert.equal(approvalEnvironment(ws, "acme", "contacts"), "uat");
  put(ws, "artifacts/acme/state/run.json", JSON.stringify({ modules: ["deals", "contacts"] }));
  assert.equal(approvalEnvironment(ws, "acme", "contacts"), "default");
  put(ws, "artifacts/acme/state/run.json", "{ broken");
  assert.equal(approvalEnvironment(ws, "acme", "contacts"), "uat", "an unreadable run is skipped");
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
  assert.equal(vscode.rec.context["atf.hasProducts"], false);
  put(ws, "config/acme.yaml", "product: acme\n");
  w.detect();
  assert.equal(fired, 3, "the first product is a change");
  assert.equal(vscode.rec.context["atf.hasProducts"], true);
  assert.equal(w.uri("config").fsPath, path.join(ws, "config"));
});

test("New product…: the name is a kebab-case slug with no config/<name>.yaml yet, the URL an http(s) one", async () => {
  const ws = tmp();
  put(ws, "config/acme.yaml", "product: acme\n");
  put(ws, "config/beta-uat.yaml", "product: beta\nenvironment: uat\n");
  assert.equal(configFileOf("acme-crm"), "config/acme-crm.yaml");
  for (const ok of ["acme-crm", "a1", "crm2-eu", " beta "]) assert.equal(productNameProblem(ws, ok), null, ok);
  assert.match(productNameProblem(ws, ""), /lowercase kebab-case slug/);
  assert.match(productNameProblem(ws, "   "), /lowercase kebab-case slug/);
  for (const bad of ["Acme", "acme_crm", "acme--crm", "-acme", "acme-", "acme crm", "../x", "acme.yaml"]) assert.match(productNameProblem(ws, bad), /is not a lowercase kebab-case slug/, bad);
  assert.match(productNameProblem(ws, "acme"), /^config\/acme\.yaml already exists: open it from the product in the Products view/);
  assert.match(productNameProblem(ws, " acme "), /already exists/, "trimmed, as the command passes it");
  assert.equal(productNameProblem(ws, "beta"), null, "only config/<name>.yaml counts, as in atf config");
  assert.equal(productNameProblem(null, "acme"), null, "no workspace: only the slug is checked");

  for (const ok of ["https://crm.example.com", "http://localhost:3000/app?x=1", "HTTPS://X.EXAMPLE.COM", " https://a.b "]) assert.equal(targetUrlProblem(ok), null, ok);
  assert.match(targetUrlProblem(""), /The target's URL/);
  for (const bad of ["crm.example.com", "ftp://x", "https://", "https://a b", "javascript:alert(1)"]) assert.match(targetUrlProblem(bad), /is not an http\(s\) URL/, bad);
  // the CLI's own test, word for word (scripts/lib/cli.mjs), so the box and the command agree
  const { readFileSync } = await import("node:fs");
  const cliSrc = readFileSync(path.resolve(import.meta.dirname, "..", "..", "core", "scripts", "lib", "cli.mjs"), "utf8");
  assert.ok(cliSrc.includes(`if (!${URL_RE}.test(v.url))`), "URL_RE drifted from atf config's");
});
