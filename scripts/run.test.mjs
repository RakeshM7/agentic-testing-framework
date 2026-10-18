import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { endRun, initRun, makeRunId, next, setStage, status, validateProduct } from "./run.mjs";
import { loadJson, paths } from "./lib/contract.mjs";
import { markApproved, put, renderFoundation, startRun, tempRoot, writeConfig, writeModuleKnowledge, writeProductKnowledge } from "./test-helpers.mjs";

const SITEMAP = JSON.stringify([{ url: "https://app.acme.test/contacts", slug: "contacts-list", title: "Contacts" }]);
const CSV_HEADER = "ID,Module,Question,Steps to execute,Answer,Clarification agent notes,Run ID\r\n";
const ready = async (product, root) => (await next(product, { root })).map((s) => (s.module ? `${s.module}/${s.stage}` : s.stage)).sort();

test("run id carries the product and a timestamp, no personal data", () => {
  assert.equal(makeRunId("acme", new Date("2026-10-07T12:30:00Z")), "acme-20261007-1230");
});

test("init writes product-level state, freezes permissions, takes the lock; no run-id directory", () => {
  const { root, run } = startRun();
  const p = paths("acme", root);
  for (const f of [p.runFile, p.lockFile, p.configFile, p.permissionsFile]) assert.ok(existsSync(f), f);
  assert.ok(existsSync(p.results(run.runId)));
  assert.ok(!existsSync(path.join(root, "artifacts", run.runId)));
  assert.deepEqual(run.modules, ["contacts", "deals"]);
  assert.equal(loadJson(p.permissionsFile).agents["pw-repo-owner"].layer, 2);
});

test("one active run per product: second init refused, --resume returns it, end releases the lock", async () => {
  const { root } = startRun();
  const cfg = path.join(root, "config", "acme.yaml");
  assert.match(initRun(cfg, { root }).errors[0], /is active/);
  assert.equal(initRun(cfg, { root, resume: true }).run.runId, "acme-run-1");
  const summary = await endRun("acme", { root });
  assert.equal(summary.outcome, "incomplete");
  assert.ok(existsSync(path.join(paths("acme", root).historyDir, "acme-run-1.json")));
  assert.ok(!existsSync(paths("acme", root).lockFile));
  const again = initRun(cfg, { root, runId: "acme-run-1" });
  assert.equal(again.run.runId, "acme-run-1-2", "a reused run id gets a suffix instead of clobbering history");
});

test("stage graph: product knowledge and the shared repo first, then per-module knowledge, then exploration", async () => {
  const { root } = startRun();
  assert.deepEqual(await ready("acme", root), ["knowledge", "playwright-repo"]);
  writeProductKnowledge(root);
  assert.equal((await setStage("acme", "knowledge", undefined, "done", undefined, { root })).status, "done");
  assert.deepEqual(await ready("acme", root), ["contacts/module-knowledge", "deals/module-knowledge", "playwright-repo"]);
  writeModuleKnowledge(root, "contacts");
  assert.equal((await setStage("acme", "module-knowledge", "contacts", "done", undefined, { root })).status, "done");
  assert.deepEqual(await ready("acme", root), ["contacts/explore", "deals/module-knowledge", "playwright-repo"]);
});

test("done is refused until declared outputs exist and validate", async () => {
  const { root } = startRun();
  const refused = await setStage("acme", "explore", "contacts", "done", undefined, { root });
  assert.match(refused.errors.join("\n"), /sitemap.json: missing/);
  put(root, "artifacts/acme/modules/contacts/explore/sitemap.json", JSON.stringify([{ url: "x" }]));
  put(root, "artifacts/acme/modules/contacts/explore/module-summary.md", "# s");
  assert.match((await setStage("acme", "explore", "contacts", "done", undefined, { root })).errors.join("\n"), /slug|title/);
  put(root, "artifacts/acme/modules/contacts/explore/sitemap.json", SITEMAP);
  // a valid sitemap is not enough: the exploration must have passed explore.mjs check (D-052; explore.test.mjs)
  assert.match((await setStage("acme", "explore", "contacts", "done", undefined, { root })).errors.join("\n"), /no verified stamp/);
  assert.ok(!(await ready("acme", root)).includes("contacts/clarifications"));
});

test("clarifications stage: policy stop needs every Answer; continue-flagged needs notes", async () => {
  for (const [policy, row, ok] of [
    ["stop", "contacts-1,contacts,Q?,1. Open Contacts,,,acme-run-1\r\n", false],
    ["stop", "contacts-1,contacts,Q?,1. Open Contacts,Yes,,acme-run-1\r\n", true],
    ["continue-flagged", "contacts-1,contacts,Q?,1. Open Contacts,,,acme-run-1\r\n", false],
    ["continue-flagged", "contacts-1,contacts,Q?,1. Open Contacts,,could not reproduce,acme-run-1\r\n", true],
  ]) {
    const { root } = startRun({ policy });
    put(root, "artifacts/acme/modules/contacts/clarifications.csv", CSV_HEADER + row);
    put(root, "artifacts/acme/modules/contacts/clarifications-summary.md", "# s");
    const r = await setStage("acme", "clarifications", "contacts", "done", undefined, { root });
    assert.equal(!r.errors, ok, `${policy}: ${JSON.stringify(r.errors)}`);
  }
});

test("a done stage whose output later disappears is offered again", async () => {
  const { root } = startRun();
  writeProductKnowledge(root);
  await setStage("acme", "knowledge", undefined, "done", undefined, { root });
  put(root, "artifacts/acme/knowledge/overview.md", "");
  assert.equal((await status("acme", { root })).stages.find((s) => s.stage === "knowledge").complete, false);
  assert.ok((await ready("acme", root)).includes("knowledge"));
});

test("awaiting-approval: with no human-approved test case the automation stages wait, spend no attempt, and run once cases are approved (D-053)", async () => {
  const { root } = startRun();
  const p = paths("acme", root);
  // contacts' test cases are written and reviewed, and the shared repo exists
  put(root, "artifacts/acme/modules/contacts/testcases/contacts-testcases.feature", "Feature: C\n  @TC-contacts-1 @p1 @functional\n  Scenario: list\n    Given x\n");
  put(root, "artifacts/acme/modules/contacts/testcases/testcases-summary.md", "Total test cases: 1\n");
  await renderFoundation(root, ["repo"]); // the shared files, rendered from templates/ and checked (D-054)
  const run = loadJson(p.runFile);
  run.stages["contacts/testcases"] = { status: "done", attempts: 1 };
  run.stages["_product/playwright-repo"] = { status: "done", attempts: 1 };
  writeFileSync(p.runFile, JSON.stringify(run));

  const row = async (stage, module = "contacts") => (await status("acme", { root })).stages.find((r) => r.stage === stage && r.module === module);
  for (const stage of ["playwright-ui", "playwright-api", "k6"]) {
    const r = await row(stage);
    assert.equal(r.status, "awaiting-approval", stage);
    assert.equal(r.awaitingApproval, true, stage);
    assert.equal(r.blocked, false, stage);
  }
  assert.ok(!(await ready("acme", root)).some((x) => x.startsWith("contacts/playwright") || x === "contacts/k6"), "never offered");
  const refused = await setStage("acme", "playwright-ui", "contacts", "start", undefined, { root });
  assert.match(refused.errors[0], /awaiting approval: the test cases of contacts predate scripts\/testcases\.mjs, so none can be approved: rebuild them.*No attempt was spent/, "hand-written cases: rebuild first");
  assert.equal(loadJson(p.runFile).stages["contacts/playwright-ui"], undefined, "no attempt recorded");
  assert.equal((await row("playwright-ui", "deals")).awaitingApproval, false, "a module whose test cases are not done yet is just pending");

  markApproved(root, []);
  assert.match((await setStage("acme", "playwright-ui", "contacts", "start", undefined, { root })).errors[0], /no test case of contacts is approved by a human yet \(testcases\/approval\.csv/, "built: a human approves");
  markApproved(root, ["TC-contacts-1"]);
  assert.deepEqual((await ready("acme", root)).filter((x) => x.startsWith("contacts/")), ["contacts/playwright-api", "contacts/playwright-ui"]);
  assert.equal((await setStage("acme", "playwright-ui", "contacts", "start", undefined, { root })).attempts, 1);
  assert.equal((await row("k6")).awaitingApproval, false);
});

test("an ended run accepts no stage changes and offers nothing", async () => {
  const { root } = startRun();
  await endRun("acme", { root, abandon: true });
  assert.deepEqual(await next("acme", { root }), []);
  assert.match((await setStage("acme", "knowledge", undefined, "start", undefined, { root })).errors[0], /has ended/);
});

test("validate passes on a fresh run and flags a malformed CSV", async () => {
  const { root } = startRun();
  assert.deepEqual(await validateProduct("acme", { root }), []);
  put(root, "artifacts/acme/modules/contacts/clarifications.csv", "Wrong,Header\r\n");
  assert.match((await validateProduct("acme", { root })).join("\n"), /header must be exactly/);
});

test("init rejects an invalid permissions file", () => {
  const root = tempRoot();
  put(root, "config/permissions.yaml", "agents:\n  a: {layer: 2, spawns: [b]}\n");
  assert.match(initRun(writeConfig(root), { root }).errors.join("\n"), /cannot spawn|unknown agent/);
});
