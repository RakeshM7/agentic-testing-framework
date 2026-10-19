import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { carryForward, endInfo, endRun, initRun, makeRunId, next, nextStep, setStage, stagePrompt, status, validateProduct } from "./run.mjs";
import { loadJson, paths } from "./lib/contract.mjs";
import { collect } from "./report-data.mjs";
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

// ---- G10: run.mjs next returns agent + prompt; knowledge reuse, retry policy, report-and-end, review failure, carry-forward ----

test("next returns each ready stage's agent and exact prompt (run id, mode, module, format), and how many modules may run at once", async () => {
  const { root } = startRun();
  const r = await nextStep("acme", { root });
  assert.deepEqual(r.actions.map((a) => [a.stage, a.agent, a.prompt]).sort(), [
    ["knowledge", "knowledge-generator", "product=acme pass=product"],
    ["playwright-repo", "pw-repo-owner", "product=acme task=skeleton"],
  ]);
  assert.deepEqual(r.concurrency, { modules: 1 });
  assert.equal(r.end, undefined, "something to start: no end");
  const ctx = { product: "acme", runId: "acme-run-1", run: { mode: "full-run" }, testcasesFormat: "gherkin" };
  assert.equal(stagePrompt(ctx, "module-knowledge", "deals").prompt, "product=acme pass=module module=deals");
  assert.equal(stagePrompt(ctx, "explore", "deals").prompt, "product=acme module=deals mode=full-run");
  assert.deepEqual(stagePrompt(ctx, "clarifications", "deals"), { agent: "clarification-orchestrator", prompt: "product=acme module=deals run=acme-run-1 mode=full-run" });
  assert.equal(stagePrompt(ctx, "testcases", "deals").prompt, "product=acme module=deals run=acme-run-1 format=gherkin");
  assert.deepEqual(stagePrompt(ctx, "playwright-ui", "deals"), { agent: "playwright-ui-orchestrator", prompt: "product=acme module=deals run=acme-run-1 mode=full-run" });
  assert.equal(stagePrompt(ctx, "k6", "deals").prompt, "product=acme module=deals run=acme-run-1 mode=full-run");
  assert.deepEqual(stagePrompt(ctx, "report", null), { agent: "report-generator", prompt: "product=acme run=acme-run-1" });
});

test("next marks reusable knowledge done itself (reused) and offers only what must be generated", async () => {
  const { root } = startRun();
  writeProductKnowledge(root);
  await setStage("acme", "knowledge", undefined, "done", undefined, { root });
  writeModuleKnowledge(root, "contacts");
  await setStage("acme", "module-knowledge", "contacts", "done", undefined, { root });
  await endRun("acme", { root });
  const again = initRun(path.join(root, "config", "acme.yaml"), { root, runId: "acme-run-2", env: { CLAUDECODE: "1" } });
  assert.equal(again.run.runId, "acme-run-2");
  const r = await nextStep("acme", { root });
  const stages = loadJson(paths("acme", root).runFile).stages;
  assert.deepEqual([stages["_product/knowledge"].status, stages["_product/knowledge"].reused], ["done", true]);
  assert.deepEqual([stages["contacts/module-knowledge"].status, stages["contacts/module-knowledge"].reused], ["done", true]);
  assert.equal(stages["deals/module-knowledge"], undefined, "no knowledge for deals: generated, not reused");
  assert.deepEqual(r.actions.map((a) => `${a.module ?? ""}/${a.stage}`).sort(), ["/playwright-repo", "contacts/explore", "deals/module-knowledge"]);
  assert.equal(r.actions.find((a) => a.stage === "module-knowledge").prompt, "product=acme pass=module module=deals");
  assert.equal(stages["_product/knowledge"].attempts, undefined, "reuse spends no attempt");
});

test("a refused done gets one retry with the problems; the second refusal fails the stage itself (D-011); the clarification gate is exempt", async () => {
  const { root } = startRun();
  const first = await setStage("acme", "explore", "contacts", "done", undefined, { root });
  assert.match(first.errors.join("\n"), /sitemap.json: missing/);
  assert.equal(first.retry.agent, "module-explorer");
  assert.match(first.retry.prompt, /^product=acme module=contacts mode=readonly problems="artifacts\/acme\/modules\/contacts\/explore\/sitemap\.json: missing or empty/);
  assert.equal(first.failed, undefined);
  const second = await setStage("acme", "explore", "contacts", "done", undefined, { root });
  assert.equal(second.failed, true);
  assert.equal(second.status, "failed");
  assert.match(loadJson(paths("acme", root).runFile).stages["contacts/explore"].error, /^done refused twice; outputs incomplete: /);
  // the human's gate: refused again and again while rows wait for answers, never retried or failed
  put(root, "artifacts/acme/modules/contacts/clarifications.csv", CSV_HEADER + "contacts-1,contacts,Q?,1. Open Contacts,,,acme-run-1\r\n");
  put(root, "artifacts/acme/modules/contacts/clarifications-summary.md", "# s");
  for (let i = 0; i < 3; i++) {
    const r = await setStage("acme", "clarifications", "contacts", "done", undefined, { root });
    assert.ok(r.errors && !r.retry && !r.failed);
  }
  assert.equal(loadJson(paths("acme", root).runFile).stages["contacts/clarifications"], undefined);
});

test("a review that used up its rounds fails the stage with its open findings and blocks every dependant at once, also testcases", async () => {
  const { root } = startRun();
  const p = paths("acme", root);
  const finding = { n: 1, severity: "major", rule: "correctness", problem: "TC-contacts-1: expects the wrong result" };
  put(root, "artifacts/acme/state/orchestration/testcases-contacts.json", JSON.stringify({
    runId: "acme-run-1", domain: "testcases", module: "contacts", rounds: { review: 3, heal: 0 }, notes: [],
    steps: { review: { status: "failed", note: "3 review rounds used and findings remain" } },
    reviewFailure: { rounds: 3, file: "artifacts/acme/results/acme-run-1/contacts/testcases/review-findings.md", total: 1, findings: [finding] },
  }));
  // the outputs alone would pass: the failed review still wins
  put(root, "artifacts/acme/modules/contacts/testcases/testcases-summary.md", "Total test cases: 1\n");
  const r = await setStage("acme", "testcases", "contacts", "done", undefined, { root });
  assert.equal(r.status, "failed");
  assert.equal(r.reviewFailed, true);
  assert.match(r.errors[0], /^review failed: 3 review rounds used and 1 blocker\/major finding\(s\) still open \(artifacts\/acme\/results\/acme-run-1\/contacts\/testcases\/review-findings\.md\)/);
  assert.deepEqual(loadJson(p.runFile).stages["contacts/testcases"].findings, [finding]);
  const st = await status("acme", { root });
  const row = (stage, module = "contacts") => st.stages.find((x) => x.stage === stage && x.module === module);
  assert.deepEqual([row("testcases").exhausted, row("testcases").reviewFailed, row("testcases").findings], [true, true, [finding]]);
  for (const stage of ["playwright-ui", "playwright-api", "k6"]) assert.equal(row(stage).blocked, true, `${stage} is blocked`);
  assert.equal(row("playwright-ui", "deals").blocked, false, "another module is not");
  assert.match((await setStage("acme", "testcases", "contacts", "start", undefined, { root })).errors[0], /failed its review this run/);
  const report = collect("acme", { root });
  assert.deepEqual(report.failedStages.map((s) => [s.key, s.reviewFailed, s.findings]), [["contacts/testcases", true, [finding]]], "the report data lists the failed stage with its findings");
});

test("with only sign-off-blocked work left, next offers the report and then ends awaiting-approval with the sheets to review; a new run continues at the approved cases", async () => {
  const { root } = startRun();
  const p = paths("acme", root);
  // contacts is at the human's sign-off; every other row is settled (here: exhausted), so only report is left to start
  put(root, "artifacts/acme/modules/contacts/testcases/contacts-testcases.feature", "Feature: C\n  @TC-contacts-1 @p1 @functional\n  Scenario: list\n    Given x\n");
  put(root, "artifacts/acme/modules/contacts/testcases/testcases-summary.md", "Total test cases: 1\n");
  await renderFoundation(root, ["repo"]);
  markApproved(root, []);
  const run = loadJson(p.runFile);
  run.stages["contacts/testcases"] = { status: "done", attempts: 1 };
  run.stages["_product/playwright-repo"] = { status: "done", attempts: 1 };
  for (const k of ["_product/knowledge", "contacts/module-knowledge", "contacts/explore", "contacts/clarifications", "deals/module-knowledge", "deals/explore", "deals/clarifications", "deals/testcases"]) run.stages[k] = { status: "failed", attempts: 2, error: "x" };
  writeFileSync(p.runFile, JSON.stringify(run));
  const r = await nextStep("acme", { root });
  assert.deepEqual(r.actions.map((a) => [a.stage, a.agent, a.prompt]), [["report", "report-generator", "product=acme run=acme-run-1"]]);

  // the report done, nothing left: the run ends awaiting-approval with the sheet to review
  const info = endInfo(await status("acme", { root }), { p, root });
  assert.equal(info.outcome, "incomplete", "here other stages failed, so not awaiting-approval");
  assert.deepEqual(info.sheets, [{ module: "contacts", file: "artifacts/acme/modules/contacts/testcases/approval.csv", built: true, awaiting: 0, approved: 0 }]);
  const st = { stages: [{ stage: "knowledge", complete: true }, { stage: "report", complete: true }, { stage: "playwright-ui", module: "contacts", awaitingApproval: true }, { stage: "k6", module: "contacts", awaitingApproval: true }] };
  const awaiting = endInfo(st, { p, root });
  assert.equal(awaiting.outcome, "awaiting-approval");
  assert.deepEqual(awaiting.sheets.map((s) => [s.module, s.file]), [["contacts", "artifacts/acme/modules/contacts/testcases/approval.csv"]]);
  const summary = await endRun("acme", { root });
  assert.equal(summary.sheets[0].file, "artifacts/acme/modules/contacts/testcases/approval.csv", "the end summary lists the sheet");
  assert.equal(summary.failed.length, 8);
});

test("a run after one that ended awaiting-approval adopts its verified product-level stages and continues; any other predecessor adopts nothing", async () => {
  const { root } = startRun();
  const p = paths("acme", root);
  writeProductKnowledge(root);
  await setStage("acme", "knowledge", undefined, "done", undefined, { root });
  writeModuleKnowledge(root, "contacts");
  await setStage("acme", "module-knowledge", "contacts", "done", undefined, { root });
  await endRun("acme", { root });
  const hist = path.join(p.historyDir, "acme-run-1.json");
  const cfg = path.join(root, "config", "acme.yaml");

  initRun(cfg, { root, runId: "acme-run-2", env: { CLAUDECODE: "1" } });
  assert.deepEqual(await carryForward("acme", { root }), { carried: [] }, "the last run was incomplete");
  await endRun("acme", { root, abandon: true });

  const h = loadJson(hist);
  writeFileSync(hist, JSON.stringify({ ...h, outcome: "awaiting-approval", endedAt: "2999-01-01T00:00:00.000Z" }));
  initRun(cfg, { root, runId: "acme-run-3", env: { CLAUDECODE: "1" } });
  const c = await carryForward("acme", { root });
  assert.equal(c.from, "acme-run-1");
  assert.deepEqual(c.carried.sort(), ["_product/knowledge", "contacts/module-knowledge"]);
  const stages = loadJson(p.runFile).stages;
  assert.deepEqual([stages["_product/knowledge"].status, stages["_product/knowledge"].carriedFrom], ["done", "acme-run-1"]);
  assert.equal(stages["deals/module-knowledge"], undefined);
  assert.deepEqual((await validateProduct("acme", { root })), [], "the run schema accepts the new fields");
  assert.ok((await ready("acme", root)).includes("contacts/explore"), "the run continues after the carried stages");
});

test("carry-forward does not adopt knowledge whose run-config inputs changed (plan says generate)", async () => {
  const { root } = startRun();
  const p = paths("acme", root);
  writeProductKnowledge(root);
  await setStage("acme", "knowledge", undefined, "done", undefined, { root });
  writeModuleKnowledge(root, "contacts");
  await setStage("acme", "module-knowledge", "contacts", "done", undefined, { root });
  await endRun("acme", { root });
  const hist = path.join(p.historyDir, "acme-run-1.json");
  writeFileSync(hist, JSON.stringify({ ...loadJson(hist), outcome: "awaiting-approval" }));
  const cfg = path.join(root, "config", "acme.yaml");
  const before = readFileSync(cfg, "utf8");
  assert.ok(before.includes("https://app.acme.test/contacts"));
  writeFileSync(cfg, before.replace("https://app.acme.test/contacts", "https://app.acme.test/contacts-v2"));
  initRun(cfg, { root, runId: "acme-run-2", env: { CLAUDECODE: "1" } });
  const c = await carryForward("acme", { root });
  assert.ok(!c.carried.includes("contacts/module-knowledge"), "changed module inputs: not carried");
  assert.equal(loadJson(p.runFile).stages["contacts/module-knowledge"], undefined);
});
