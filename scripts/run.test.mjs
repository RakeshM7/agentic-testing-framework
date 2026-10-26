import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { carryForward, diffRuns, endInfo, endRun, initRun, makeRunId, next, nextStep, setStage, stagePrompt, status, validateProduct } from "./run.mjs";
import { loadJson, paths, frameworkRoot } from "./lib/contract.mjs";
import { GROUPS, recordDoctor } from "./lib/doctor.mjs";
import { recordCanary } from "./lib/guard-check.mjs";
import { collect } from "./report-data.mjs";
import { buildCatalogue, markApproved, put, renderFoundation, startRun, tempRoot, writeConfig, writeModuleKnowledge, writeProductKnowledge } from "./test-helpers.mjs";
import { append, read as readLedger } from "./lib/ledger.mjs";

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
  assert.match(initRun(cfg, { root, framework: root }).errors[0], /is active/);
  assert.equal(initRun(cfg, { root, framework: root, resume: true }).run.runId, "acme-run-1");
  const summary = await endRun("acme", { root });
  assert.equal(summary.outcome, "incomplete");
  assert.ok(existsSync(path.join(paths("acme", root).historyDir, "acme-run-1.json")));
  assert.ok(!existsSync(paths("acme", root).lockFile));
  const again = initRun(cfg, { root, framework: root, runId: "acme-run-1" });
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
  await buildCatalogue(root); // the endpoint catalogue the API tests and k6 need (the api-discovery stage)
  const run = loadJson(p.runFile);
  run.stages["contacts/testcases"] = { status: "done", attempts: 1 };
  run.stages["contacts/api-discovery"] = { status: "done", attempts: 1 };
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
  assert.match((await setStage("acme", "playwright-ui", "contacts", "start", undefined, { root })).errors[0], /no UI test case of contacts is approved by a human yet \(testcases\/approval\.csv/, "built: a human approves");
  markApproved(root, ["TC-contacts-1"]);
  // each automation stage waits for an approved case of its own type (B4): a UI case starts only the UI tests
  assert.deepEqual((await ready("acme", root)).filter((x) => x.startsWith("contacts/")), ["contacts/playwright-ui"]);
  assert.equal((await setStage("acme", "playwright-ui", "contacts", "start", undefined, { root })).attempts, 1);
  assert.match((await setStage("acme", "playwright-api", "contacts", "start", undefined, { root })).errors[0], /no @api test case of contacts is approved/);
  assert.equal((await row("k6")).awaitingApproval, true, "k6 needs an approved @performance case; it no longer waits for the API tests");
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
  assert.match(initRun(writeConfig(root), { root, framework: root }).errors.join("\n"), /cannot spawn|unknown agent/);
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
  const again = initRun(path.join(root, "config", "acme.yaml"), { root, framework: root, runId: "acme-run-2", env: { CLAUDECODE: "1" } });
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
  const report = await collect("acme", { root });
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

  initRun(cfg, { root, framework: root, runId: "acme-run-2", env: { CLAUDECODE: "1" } });
  assert.deepEqual(await carryForward("acme", { root }), { carried: [] }, "the last run was incomplete");
  await endRun("acme", { root, abandon: true });

  const h = loadJson(hist);
  writeFileSync(hist, JSON.stringify({ ...h, outcome: "awaiting-approval", endedAt: "2999-01-01T00:00:00.000Z" }));
  initRun(cfg, { root, framework: root, runId: "acme-run-3", env: { CLAUDECODE: "1" } });
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
  initRun(cfg, { root, framework: root, runId: "acme-run-2", env: { CLAUDECODE: "1" } });
  const c = await carryForward("acme", { root });
  assert.ok(!c.carried.includes("contacts/module-knowledge"), "changed module inputs: not carried");
  assert.equal(loadJson(p.runFile).stages["contacts/module-knowledge"], undefined);
});

// ---- selectable steps: the chosen stage set, not-chosen stages, the prerequisite check and the gap menu ----
import { chosenStages, deriveCaseTypes, stageNeeds, validateData } from "./lib/contract.mjs";
import { changeSteps, prereqs } from "./run.mjs";
import { renderDeck } from "./lib/report.mjs";
import { buildCases } from "./test-helpers.mjs";

const stagesOf = (run) => [...chosenStages(run)].sort();

test("the stage set of a run: its steps, what they need automatically, and the report; case types come from the steps", () => {
  assert.deepEqual(stagesOf({ steps: ["explore"] }), ["explore", "knowledge", "module-knowledge", "report"]);
  assert.deepEqual(stagesOf({ steps: ["k6"] }), ["api-discovery", "k6", "report"], "no knowledge, no shared repo");
  assert.deepEqual(stagesOf({ steps: ["playwright-ui"] }), ["playwright-repo", "playwright-ui", "report"]);
  assert.ok(!chosenStages({ steps: ["testcases"], caseTypes: ["ui"] }).has("api-discovery"));
  assert.ok(chosenStages({ steps: ["testcases"], caseTypes: ["ui", "api"] }).has("api-discovery"), "testcases writing @api cases needs the catalogue");
  assert.equal(chosenStages({}).size, 11, "a run.json from before steps chose everything");
  assert.deepEqual(deriveCaseTypes(["explore", "testcases"]), ["ui"]);
  assert.deepEqual(deriveCaseTypes(["testcases"], ["performance"]), ["ui", "performance"]);
  assert.deepEqual(deriveCaseTypes(["playwright-api", "k6"]), ["ui", "api", "performance"]);
  assert.deepEqual(stageNeeds("testcases", { steps: ["testcases"], caseTypes: ["ui"] }), ["explore"], "clarifications is no longer a hard need");
  assert.deepEqual(stageNeeds("testcases", {}), ["explore", "api-discovery"]);
  assert.deepEqual(stageNeeds("k6", {}), ["testcases", "api-discovery"], "k6 no longer needs playwright-api");
  assert.deepEqual(stageNeeds("playwright-api", {}), ["testcases", "playwright-repo", "api-discovery"]);
});

test("init freezes the config's steps and their case types into run.json; absent steps are all six", () => {
  const all = startRun().run;
  assert.deepEqual([all.steps, all.caseTypes], [["explore", "clarifications", "testcases", "playwright-ui", "playwright-api", "k6"], ["ui", "api", "performance"]]);
  const { root, run } = startRun({ extra: ["steps: [playwright-ui, explore]"] });
  assert.deepEqual([run.steps, run.caseTypes], [["explore", "playwright-ui"], ["ui"]]);
  assert.deepEqual(loadJson(paths("acme", root).runFile).steps, ["explore", "playwright-ui"]);
  assert.match(initRun(writeConfig(tempRoot(), { extra: ["steps: [explore, load]"] }), { root, framework: root }).errors.join("\n"), /steps: unknown step 'load'/);
});

test("stages not chosen are never offered or started, never failed or blocked, and never make the run incomplete", async () => {
  const { root } = startRun({ extra: ["steps: [explore]"] });
  const p = paths("acme", root);
  assert.deepEqual(await ready("acme", root), ["knowledge"], "no shared repo: no Playwright step was chosen");
  const st = await status("acme", { root });
  const k6 = st.stages.find((r) => r.stage === "k6" && r.module === "contacts");
  assert.deepEqual([k6.status, k6.notChosen, k6.satisfied, !!k6.blocked, k6.complete], ["not-chosen", true, false, false, false]);
  assert.match((await setStage("acme", "k6", "contacts", "start", undefined, { root })).errors[0], /^contacts\/k6 is not chosen for this run \(steps: explore\): it is never started; to run it, add the step: node scripts\/run\.mjs steps acme --add k6\. No attempt was spent\./);
  assert.match((await setStage("acme", "playwright-repo", undefined, "start", undefined, { root })).errors[0], /^_product\/playwright-repo is not chosen for this run \(steps: explore\): it is never started\. No attempt/);
  assert.equal(loadJson(p.runFile).stages["contacts/k6"], undefined, "no attempt recorded");

  const row = (stage, extra = {}) => ({ stage, module: "contacts", complete: false, ...extra });
  const settledRun = { stages: [row("explore", { complete: true }), row("report", { complete: true }), row("k6", { notChosen: true }), row("playwright-ui", { notChosen: true })] };
  assert.deepEqual(endInfo(settledRun, { p, root }), { outcome: "completed", notChosen: ["k6", "playwright-ui"] });
  assert.equal(endInfo({ stages: [...settledRun.stages, row("testcases", { awaitingApproval: true })] }, { p, root }).outcome, "awaiting-approval");
  const summary = await endRun("acme", { root });
  assert.equal(summary.outcome, "incomplete", "knowledge and explore are still pending");
  assert.equal(summary.blocked, undefined, "a not-chosen stage is never blocked");
  assert.ok(summary.notChosen.includes("k6") && !summary.notChosen.includes("explore"));
});

test("the report shows each step chosen or not; a not-chosen stage is never failed, blocked or incomplete", async () => {
  const { root } = startRun({ extra: ["steps: [explore, testcases]"] });
  const r = await collect("acme", { root });
  assert.deepEqual(await validateData("report", r), []);
  assert.deepEqual(r.steps.filter((s) => !s.chosen).map((s) => s.step), ["clarifications", "playwright-ui", "playwright-api", "k6"]);
  assert.ok(r.notChosenStages.some((s) => s.key === "contacts/k6") && r.notChosenStages.some((s) => s.key === "_product/playwright-repo"));
  assert.ok(!r.incompleteStages.some((s) => ["k6", "playwright-ui", "clarifications", "api-discovery"].includes(s.stage)));
  assert.equal(r.totals.stages.notChosen, r.notChosenStages.length);
  const html = renderDeck(r);
  assert.match(html, /Not chosen for this run: clarifications, playwright-ui, playwright-api, k6/);
  assert.match(html, /<td><code>k6<\/code><\/td><td>Not chosen for this run<\/td>/);
});

test("api-discovery is its own stage: done needs the verified catalogue; the API tests and k6 need it, not each other", async () => {
  const { root } = startRun();
  const first = await setStage("acme", "api-discovery", "contacts", "done", undefined, { root });
  assert.match(first.errors.join("\n"), /api\/discovered-endpoints\.json: missing or empty/);
  assert.equal(first.retry.agent, "api-discoverer");
  assert.equal(first.retry.prompt.split(" problems=")[0], "product=acme module=contacts run=acme-run-1 mode=readonly");
  await buildCatalogue(root);
  assert.equal((await setStage("acme", "api-discovery", "contacts", "done", undefined, { root })).status, "done");
  const ap = path.join(root, "artifacts/acme/modules/contacts/api/discovered-endpoints.json");
  writeFileSync(ap, JSON.stringify(JSON.parse(readFileSync(ap, "utf8")).map((e) => ({ ...e, id: "EP-contacts-99" }))));
  assert.match((await status("acme", { root })).stages.find((r) => r.stage === "api-discovery" && r.module === "contacts").problems.join("\n"), /does not match registry\.json/, "the endpoints.mjs check runs on the stage's outputs");
});

test("a need on a stage not chosen is met by an earlier run's verified outputs, else its dependants are blocked (unmet)", async () => {
  const { root } = startRun({ extra: ["steps: [playwright-ui]"] });
  await buildCases(root, { cases: [{ key: "list" }] }); // contacts has test cases from an earlier run; deals has none
  const st = await status("acme", { root });
  const row = (stage, module) => st.stages.find((r) => r.stage === stage && r.module === module);
  assert.deepEqual([row("testcases", "contacts").satisfied, row("testcases", "contacts").satisfiedBy], [true, "earlier-run"]);
  assert.equal(row("testcases", "deals").satisfied, false);
  assert.deepEqual([row("playwright-ui", "deals").blocked, row("playwright-ui", "deals").unmet], [true, ["testcases"]]);
  assert.deepEqual([row("playwright-ui", "contacts").blocked, row("playwright-ui", "contacts").status], [false, "pending"], "waits for the shared repo only");
});

test("prereqs: per module and chosen step, ok, missing (with the gap menu) or awaiting-approval; the gap menu's answer changes the run's steps", async () => {
  const { root } = startRun({ extra: ["steps: [playwright-ui]"] });
  await buildCases(root, { cases: [{ key: "list" }] });
  let r = await prereqs("acme", { root });
  assert.equal(r.ok, false);
  assert.deepEqual(r.gaps.map((g) => [g.module, g.need, g.steps]), [["contacts", "explore", ["playwright-ui"]], ["deals", "explore", ["playwright-ui"]], ["deals", "testcases", ["playwright-ui"]]]);
  const tcGap = r.gaps.find((g) => g.need === "testcases");
  assert.match(tcGap.what, /^deals has no test cases/);
  assert.deepEqual(tcGap.options.map((o) => [o.id, o.label, o.adds ?? o.removes]), [
    ["testcases", "Generate test cases", ["testcases"]],
    ["clarifications", "Ask clarification questions", ["clarifications", "testcases"]],
    ["scenarios", "Describe scenarios to explore", ["explore", "testcases"]],
    ["import", "Use my test case file", []],
    ["skip", "Skip this step for this run", ["playwright-ui"]],
  ]);
  assert.deepEqual(r.gaps[0].options.map((o) => o.id), ["explore", "scenarios", "skip"]);
  assert.deepEqual(r.modules.deals[0].missing.map((m) => m.need), ["explore", "testcases"]);

  assert.deepEqual(changeSteps("acme", { add: ["explore"], root }).stages, ["knowledge", "module-knowledge", "explore", "playwright-repo", "playwright-ui", "report"]);
  r = await prereqs("acme", { root });
  assert.deepEqual(r.modules.contacts, [{ step: "explore", status: "ok" }, { step: "playwright-ui", status: "awaiting-approval", awaiting: { type: "ui", cases: 1 } }], "cases exist, none approved: not a gap");
  assert.deepEqual(r.gaps.map((g) => [g.module, g.need]), [["deals", "testcases"]]);
  const added = changeSteps("acme", { add: ["testcases"], root });
  assert.deepEqual([added.steps, added.caseTypes], [["explore", "testcases", "playwright-ui"], ["ui"]]);
  r = await prereqs("acme", { root });
  assert.deepEqual([r.ok, r.gaps, r.modules.deals.map((x) => x.status)], [true, [], ["ok", "ok", "ok"]], "produced by a step chosen in this run");

  assert.match(changeSteps("acme", { add: ["smoke"], root }).errors[0], /unknown step\(s\) smoke/);
  await setStage("acme", "knowledge", undefined, "start", undefined, { root });
  assert.match(changeSteps("acme", { remove: ["explore", "testcases"], root }).errors[0], /cannot remove: _product\/knowledge already started this run/);
  assert.deepEqual(changeSteps("acme", { remove: ["testcases"], root }).steps, ["explore", "playwright-ui"], "knowledge stays for explore");
  assert.match(changeSteps("acme", { remove: ["explore", "playwright-ui"], root }).errors[0], /at least one step/);
});

import { main as testcasesMain } from "./testcases.mjs";
import { importCovers, scenarios } from "./run.mjs";

test("an imported test case file stands in for a testcases stage not chosen; its UI cases need links to exploration states", async () => {
  const { root } = startRun({ extra: ["steps: [playwright-ui]"] });
  put(root, "data/deals.feature", ["Feature: Deals", "  @TC-1 @p1", "  Scenario: The deal list opens", "    When the user opens Deals", "    Then the deal list is shown", ""].join("\n"));
  const imp = await testcasesMain(["import", "acme", "deals", "--file", "data/deals.feature"], { root });
  assert.equal(imp.out.imported, 1, JSON.stringify(imp.out));
  const row = async (stage, module) => (await status("acme", { root })).stages.find((r) => r.stage === stage && r.module === module);
  assert.deepEqual([(await row("testcases", "deals")).satisfied, (await row("testcases", "deals")).satisfiedBy], [true, "import"]);
  const r = await prereqs("acme", { root });
  const link = r.modules.deals[0].missing.find((m) => m.link);
  assert.deepEqual(link.link, imp.out.ids);
  assert.equal(link.need, "link");
  assert.match(link.what, /not linked to the explored screens/);
  // its own option (V-2): the testcases stage in import mode for deals only
  const gap = r.gaps.find((g) => g.need === "link");
  assert.deepEqual(gap.options.map((o) => [o.id, o.label, o.args]), [["link", "Link my imported cases to the explored screens", "--import-mode deals"], ["skip", "Skip this step for this run", "--remove playwright-ui"]]);
  // the build on disk must be from exactly that import: a later change to the cases makes it no import any more
  const productDir = path.join(root, "artifacts/acme");
  assert.equal(importCovers(productDir, "deals"), true);
  writeFileSync(path.join(productDir, "modules/deals/testcases/cases.json"), JSON.stringify({ cases: [] }));
  assert.equal(importCovers(productDir, "deals"), false, "cases.json changed after the build");
  assert.equal(importCovers(productDir, "contacts"), false, "nothing imported");
});

test("import mode (D-066): the link option runs the testcases stage for that module only; an approved but unlinked case gets its own start message", async () => {
  const { root } = startRun({ extra: ["steps: [explore, playwright-ui]"] });
  put(root, "data/deals.feature", ["Feature: Deals", "  @TC-1 @p1", "  Scenario: The deal list opens", "    When the user opens Deals", "    Then the deal list is shown", ""].join("\n"));
  const imp = await testcasesMain(["import", "acme", "deals", "--file", "data/deals.feature"], { root });
  markApproved(root, imp.out.ids, { module: "deals" });
  for (const s of ["knowledge", "playwright-repo"]) await setStage("acme", s, undefined, "start", undefined, { root });
  // V-2: approved, only unlinked -> not "no case is approved"
  const tcPath = path.join(root, "artifacts/acme/modules/deals/testcases/coverage.json");
  const st0 = (await status("acme", { root })).stages.find((r) => r.stage === "playwright-ui" && r.module === "deals");
  assert.equal(st0.status, "pending", "waits for the shared repo");
  await renderFoundation(root, ["repo"]);
  assert.equal((await setStage("acme", "playwright-repo", undefined, "done", undefined, { root })).status, "done");
  assert.ok(existsSync(tcPath));
  const startUi = await setStage("acme", "playwright-ui", "deals", "start", undefined, { root });
  assert.match(startUi.errors[0], new RegExp(`approved imported UI case\\(s\\) of deals \\(${imp.out.ids[0]}\\) are not linked to the explored screens`));
  assert.match(startUi.errors[0], /Link my imported cases to the explored screens.*--import-mode deals/);
  assert.doesNotMatch(startUi.errors[0], /no UI test case of deals is approved/);

  const r = changeSteps("acme", { importMode: ["deals"], root });
  assert.deepEqual([r.steps, r.testcasesMode, r.configChanged], [["explore", "playwright-ui"], { deals: "import" }, false], "the run's steps are unchanged; no regeneration for contacts");
  const st = await status("acme", { root });
  const row = (stage, m) => st.stages.find((x) => x.stage === stage && x.module === m);
  assert.deepEqual([row("testcases", "deals").notChosen, row("testcases", "deals").status], [undefined, "pending"], "deals' testcases stage runs (import mode)");
  assert.equal(row("testcases", "contacts").notChosen, true, "contacts is unaffected");
  assert.equal((await setStage("acme", "testcases", "contacts", "start", undefined, { root })).errors[0].includes("is not chosen for this run"), true);
  assert.equal((await prereqs("acme", { root })).gaps.filter((g) => g.module === "deals" && g.need === "link").length, 0, "the stage this run links them");
  assert.equal(row("testcases", "deals").blocked, false, "it waits for deals' exploration, chosen this run");
  // adding the testcases step later makes it generate (every module), and sends a completed import-mode stage back
  const run2 = loadJson(paths("acme", root).runFile);
  run2.stages["deals/testcases"] = { status: "done" };
  writeFileSync(paths("acme", root).runFile, JSON.stringify(run2));
  const added = changeSteps("acme", { add: ["testcases"], root });
  assert.deepEqual([added.testcasesMode, added.reopened], [{ contacts: "generate", deals: "generate" }, ["deals/testcases"]]);
  assert.match(loadJson(paths("acme", root).runFile).stages["deals/testcases"].reopened, /import mode becomes generate/);
});

test("V-4: a step added after testcases completed without its case type is a gap; its option reopens the stage, keeping sign-offs", async () => {
  const { root } = startRun({ extra: ["steps: [explore, testcases, playwright-ui]"] });
  await buildCases(root, { cases: [{ key: "list" }] });
  const run = loadJson(paths("acme", root).runFile);
  run.stages["contacts/testcases"] = { status: "done", attempts: 1 };
  writeFileSync(paths("acme", root).runFile, JSON.stringify(run));
  put(root, "artifacts/acme/state/orchestration/testcases-contacts.json", JSON.stringify({ runId: "acme-run-1" }));
  changeSteps("acme", { add: ["k6"], root });
  const r = await prereqs("acme", { root });
  const gap = r.gaps.find((g) => g.module === "contacts" && g.need === "testcases");
  assert.match(gap.what, /generated this run without @performance cases/);
  assert.deepEqual(gap.options.map((o) => [o.id, o.label, o.args]), [["types", "Generate @performance cases", "--add testcases --reopen contacts"], ["skip", "Skip this step for this run", "--remove k6"]]);
  const re = changeSteps("acme", { add: ["testcases"], reopen: ["contacts"], root });
  assert.deepEqual(re.reopened, ["contacts/testcases"]);
  assert.equal(loadJson(paths("acme", root).runFile).stages["contacts/testcases"].status, "pending");
  assert.ok(!existsSync(path.join(root, "artifacts/acme/state/orchestration/testcases-contacts.json")), "the domain loop starts again");
  assert.ok(!(await prereqs("acme", { root })).gaps.some((g) => g.module === "contacts" && g.need === "testcases"), "the reopened stage generates them this run");
  assert.match(changeSteps("acme", { reopen: ["billing"], root }).errors[0], /unknown module/);
});

test("V-5: after a skip, an add keeps the config's own steps plus the added one (a skip never leaves the config)", async () => {
  const { root } = startRun({ extra: ["steps: [explore, testcases, playwright-ui]"] });
  const skip = changeSteps("acme", { remove: ["playwright-ui"], root });
  assert.deepEqual([skip.steps, skip.configSteps, skip.configChanged], [["explore", "testcases"], ["explore", "testcases", "playwright-ui"], false]);
  const add = changeSteps("acme", { add: ["k6"], root });
  assert.deepEqual([add.steps, add.configSteps, add.configChanged], [["explore", "testcases", "k6"], ["explore", "testcases", "playwright-ui", "k6"], true]);
});

test("scenarios: the interview's answers become each module's scenarios.json with stable SC ids; bad answers write nothing", async () => {
  const { root } = startRun({ extra: ["steps: [explore, testcases]"] });
  const answers = (modules) => put(root, "artifacts/acme/state/scenario-answers.json", JSON.stringify({ modules }));
  const file = path.join(root, "artifacts/acme/modules/contacts/scenarios.json");
  answers({ contacts: [{ title: "Create a contact", goal: "a new contact is listed", start: "the contact list", steps: "1. New contact\n2. Fill the name\n3. Save" }, { title: "Search", goal: "find by name", start: "/contacts", steps: ["Type a name"] }] });
  let r = await scenarios("acme", { root });
  assert.deepEqual(r.written, { contacts: ["SC-contacts-1", "SC-contacts-2"] });
  assert.deepEqual(loadJson(file).scenarios[0].steps, ["New contact", "Fill the name", "Save"]);
  answers({ contacts: [{ title: "Search", goal: "find by name", start: "/contacts", steps: ["Type a name"] }] });
  r = await scenarios("acme", { root });
  assert.deepEqual(r.written.contacts, ["SC-contacts-2"], "the same scenario keeps its id");
  answers({ contacts: [{ title: "", goal: "x", start: "y", steps: [] }], billing: [] });
  r = await scenarios("acme", { root });
  assert.match(r.problems.join("\n"), /modules\.contacts\[0\]: needs a title/);
  assert.match(r.problems.join("\n"), /modules\.contacts\[0\]: needs its key steps/);
  assert.match(r.problems.join("\n"), /modules\.billing: not a module of this run/);
  assert.equal(loadJson(file).scenarios.length, 1, "nothing written");
  answers({ contacts: [] });
  assert.deepEqual((await scenarios("acme", { root })).removed, ["contacts"]);
  assert.ok(!existsSync(file), "back to a whole-module exploration");
});

test("resume after a crash: a stage left running becomes an interrupted failed attempt that next offers again; a second interruption exhausts it (D-071)", async () => {
  const { root } = startRun();
  const cfg = path.join(root, "config", "acme.yaml");
  const resume = () => {
    const r = initRun(cfg, { root, framework: root, resume: true });
    recordCanary("acme", root, { host: "claude-code", agent: "orchestrator-agent" });
    recordDoctor("acme", root, { groups: GROUPS, checks: [] });
    return r;
  };
  assert.equal((await setStage("acme", "knowledge", undefined, "start", undefined, { root })).status, "running");
  assert.ok(!(await ready("acme", root)).includes("knowledge"), "a running stage is not offered while its session lives");
  const first = resume();
  assert.deepEqual(first.interrupted, ["_product/knowledge"]);
  const rec = loadJson(paths("acme", root).runFile).stages["_product/knowledge"];
  assert.deepEqual([rec.status, rec.interrupted, rec.attempts], ["failed", true, 1]);
  assert.match(rec.error, /^interrupted: /);
  assert.deepEqual(await validateProduct("acme", { root }), [], "run.json with an interrupted stage passes its schema");
  const offered = (await next("acme", { root })).find((s) => s.stage === "knowledge");
  assert.deepEqual([offered.attempt, offered.retry], [2, true]);
  assert.equal(resume().interrupted, undefined, "nothing running, nothing interrupted");
  assert.equal((await setStage("acme", "knowledge", undefined, "start", undefined, { root })).attempts, 2);
  resume();
  const st = await status("acme", { root });
  assert.equal(st.stages.find((r) => r.stage === "knowledge").exhausted, true, "interrupted attempts count toward the two attempts (D-011)");
  assert.ok(st.stages.filter((r) => r.stage === "module-knowledge").every((r) => r.blocked));
});

test("run.json updates from parallel processes are never lost: each holds the run lock (D-072)", async () => {
  const { root } = startRun();
  const run = pathToFileURL(path.join(frameworkRoot, "scripts", "run.mjs")).href;
  // six processes record a failure on six different stages at once; without the lock one write overwrites another
  const calls = [["explore", "contacts"], ["explore", "deals"], ["clarifications", "contacts"], ["clarifications", "deals"], ["testcases", "contacts"], ["testcases", "deals"]];
  const codes = await Promise.all(calls.map(([stage, module]) => new Promise((resolve, reject) => {
    const code = `import { setStage } from ${JSON.stringify(run)}; await setStage("acme", ${JSON.stringify(stage)}, ${JSON.stringify(module)}, "fail", "x", { root: ${JSON.stringify(root)} });`;
    const child = spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: "ignore" });
    child.on("error", reject);
    child.on("close", resolve);
  })));
  assert.deepEqual(codes, calls.map(() => 0));
  const stages = loadJson(paths("acme", root).runFile).stages;
  for (const [stage, module] of calls) assert.equal(stages[`${module}/${stage}`]?.status, "failed", `${module}/${stage}`);
  assert.ok(!existsSync(`${paths("acme", root).runFile}.lock`), "the lock is released");
});

test("init records what the run is made with: framework commit, browser server, models, templates digest, Node.js (D-077)", async () => {
  const { collectProvenance } = await import("./lib/provenance.mjs");
  const here = collectProvenance(frameworkRoot);
  assert.match(here.framework.commit, /^[0-9a-f]{40}$/);
  assert.equal(typeof here.framework.dirty, "boolean");
  assert.match(here.browserServer, /^@playwright\/mcp@/);
  assert.ok(here.models.default.claude, "the configured default model");
  assert.match(here.templates, /^[0-9a-f]{64}$/);
  assert.equal(here.node, process.version);
  const { root, run } = startRun();
  assert.deepEqual(Object.keys(run.provenance).sort(), ["browserServer", "framework", "models", "node", "templates"]);
  assert.equal(run.provenance.framework, null, "not a git checkout: unknown, never guessed");
  assert.deepEqual(await validateProduct("acme", { root }), []);
  const { renderDeck } = await import("./lib/report.mjs");
  const report = await collect("acme", { root });
  assert.deepEqual(report.provenance, run.provenance);
  assert.match(renderDeck({ ...report, provenance: here }), new RegExp(`Made with framework <code>${here.framework.commit.slice(0, 10)}</code>`));
});

test("end keeps a manifest of what the run left behind, and diff compares two ended runs, never reading a secret (D-078)", async () => {
  const { root } = startRun();
  const cfg = path.join(root, "config", "acme.yaml");
  put(root, "artifacts/acme/modules/contacts/explore/model.json", "{\"v\":1}");
  put(root, "artifacts/acme/knowledge/overview.md", "# A");
  put(root, "playwright-tests/acme/tests/ui/contacts/cases.spec.ts", "// one");
  put(root, "playwright-tests/acme/.auth/state.json", "{\"cookies\":[]}");
  put(root, "playwright-tests/acme/.env", "API_TOKEN=s3cret");
  put(root, "playwright-tests/acme/node_modules/x/index.js", "x");
  const first = await endRun("acme", { root });
  assert.deepEqual(first.manifest, { file: "artifacts/acme/results/acme-run-1/manifest.json", files: 5 }, "the three above and the two header-only CSVs init writes");
  const m = loadJson(path.join(root, first.manifest.file));
  assert.deepEqual(Object.keys(m.files).filter((f) => !f.endsWith("clarifications.csv")).sort(), ["artifacts/acme/knowledge/overview.md", "artifacts/acme/modules/contacts/explore/model.json", "playwright-tests/acme/tests/ui/contacts/cases.spec.ts"], "no .auth, .env or node_modules file");
  assert.match(m.files["artifacts/acme/knowledge/overview.md"].sha256, /^[0-9a-f]{64}$/);

  initRun(cfg, { root, framework: root, runId: "acme-run-2" });
  put(root, "artifacts/acme/modules/contacts/explore/model.json", "{\"v\":2}");
  put(root, "playwright-tests/acme/tests/ui/contacts/more.spec.ts", "// two");
  rmSync(path.join(root, "artifacts/acme/knowledge/overview.md"));
  assert.match(diffRuns("acme", undefined, undefined, { root }).errors[0], /has 1 ended run\(s\): a diff needs two/);
  await endRun("acme", { root });
  const d = diffRuns("acme", undefined, undefined, { root });
  assert.deepEqual([d.from, d.to, d.totals], ["acme-run-1", "acme-run-2", { added: 1, removed: 1, changed: 1, unchanged: 3 }]);
  assert.deepEqual(d.areas, {
    modules: { added: [], removed: [], changed: ["artifacts/acme/modules/contacts/explore/model.json"] },
    playwright: { added: ["playwright-tests/acme/tests/ui/contacts/more.spec.ts"], removed: [], changed: [] },
    knowledge: { added: [], removed: ["artifacts/acme/knowledge/overview.md"], changed: [] },
  });
  assert.deepEqual(diffRuns("acme", "acme-run-2", "acme-run-1", { root }).totals, { added: 1, removed: 1, changed: 1, unchanged: 3 });
  assert.match(diffRuns("acme", "acme-run-1", "acme-run-9", { root }).errors[0], /acme-run-9 has no manifest/);
  assert.match(diffRuns("acme", "acme-run-1", undefined, { root }).errors[0], /two run ids, or none/);
});

test("environments (D-081): each has its own lock, run state, ledger and history; knowledge and modules are shared; the session's ATF_ENV must match the config", async () => {
  const root = tempRoot();
  const staging = writeConfig(root, { product: "acme", extra: ["environment: staging"] });
  const stagingFile = path.join(root, "config", "acme-staging.yaml");
  writeFileSync(stagingFile, readFileSync(staging, "utf8"));
  const prodCfg = writeConfig(root, { product: "acme" });
  assert.match(initRun(stagingFile, { root, framework: root, env: {} }).errors[0], /is for environment 'staging', but this session's is 'default' \(ATF_ENV\): start the session with ATF_ENV=staging \(make run PRODUCT=acme ENV=staging\)/);
  assert.match(initRun(stagingFile, { root, framework: root, env: { ATF_ENV: "Bad Env" } }).errors[0], /ATF_ENV 'Bad Env' must be/);

  const saved = process.env.ATF_ENV;
  try {
    process.env.ATF_ENV = "staging";
    const s = initRun(stagingFile, { root, framework: root, env: process.env, runId: undefined });
    assert.match(s.run.runId, /^acme-staging-\d{8}-\d{4}$/);
    assert.equal(s.run.environment, "staging");
    const ps = paths("acme", root);
    assert.equal(path.relative(root, ps.state).replaceAll("\\", "/"), "artifacts/acme/envs/staging/state");
    assert.ok(existsSync(ps.lockFile) && existsSync(ps.runFile));
    assert.equal(path.relative(root, ps.results(s.run.runId)).replaceAll("\\", "/"), `artifacts/acme/results/${s.run.runId}`, "results stay product-level: the run id names the environment");
    append(ps.ledgerFile, { runId: s.run.runId, event: "created", type: "contact", ref: "1", module: "contacts", stage: "explore", agent: "module-explorer" });

    delete process.env.ATF_ENV;
    const d = initRun(prodCfg, { root, framework: root, env: {} });
    assert.ok(!d.errors, "the default environment runs beside staging: its own lock");
    const pd = paths("acme", root);
    assert.equal(path.relative(root, pd.state).replaceAll("\\", "/"), "artifacts/acme/state", "default keeps the layout before D-081");
    assert.deepEqual(readLedger(pd.ledgerFile), [], "staging's ledger is not default's");
    assert.equal(pd.knowledge, ps.knowledge);
    assert.equal(pd.module("contacts"), ps.module("contacts"));

    const { findActiveRuns } = await import("./lib/guard.mjs");
    assert.deepEqual(findActiveRuns(root).map((r) => [r.environment, r.runId === s.run.runId || r.runId === d.run.runId]).sort(), [["default", true], ["staging", true]]);
    // the guard expands ${state} with each run's own folder: the orchestrator writes its notes in staging's state
    const { checkTool } = await import("./lib/guard.mjs");
    const { normalize } = await import("./hooks/hosts/claude.mjs");
    const write = (rel) => checkTool(normalize({ agent_type: "orchestrator-agent", tool_name: "Write", tool_input: { file_path: path.join(root, rel) } }, { env: { CLAUDE_PROJECT_DIR: root }, host: "claude-code" }), root, {}, { framework: root }).allowed;
    assert.equal(write("artifacts/acme/envs/staging/state/notes.md"), true);
    assert.equal(write("artifacts/acme/envs/staging/state/run.json"), false);
  } finally {
    if (saved === undefined) delete process.env.ATF_ENV;
    else process.env.ATF_ENV = saved;
  }
});

test("framework issues (D-083): agents record them during the run, deduped; end writes one feedback file per reporting agent in the feedback format", async () => {
  const { main: issues } = await import("./framework-issues.mjs");
  const { parseFrontmatter } = await import("./lib/feedback.mjs");
  const { root } = startRun();
  const add = (from, extra = {}) => issues(["add", "acme", "--from", from, "--kind", "prompt", "--target", "agents/module-explorer.md", "--summary", "Step 3 names a flag explore.mjs refuses", "--evidence", "explore.mjs state: unknown option --via-item", ...Object.entries(extra).flatMap(([k, v]) => [`--${k}`, v])], { root });
  const first = add("module-explorer", { fix: "use --item", severity: "high" });
  assert.deepEqual([first.code, first.out.added, /^FI-[0-9a-f]{8}$/.test(first.out.id)], [0, true, true]);
  assert.deepEqual(add("clarification-explorer").out, { id: first.out.id, duplicate: true }, "the same issue from another agent is one issue");
  assert.match(issues(["add", "acme", "--from", "module-explorer", "--kind", "bug", "--target", "/etc/passwd", "--summary", "x"], { root }).out.errors.join("\n"), /kind must be one of[\s\S]*target is required[\s\S]*evidence is required/);
  issues(["add", "acme", "--from", "pw-ui-pom-writer", "--kind", "script", "--target", "scripts/lib/ui-code.mjs", "--summary", "check rejects a valid getByLabel", "--evidence", "ui-code.mjs check: locator not grounded for 'Email *'"], { root });
  const listed = issues(["list", "acme"], { root }).out.issues;
  assert.deepEqual(listed.map((i) => [i.from, i.reporters]), [["module-explorer", ["module-explorer", "clarification-explorer"]], ["pw-ui-pom-writer", ["pw-ui-pom-writer"]]]);

  const end = await endRun("acme", { root });
  assert.deepEqual(end.feedback.map((f) => f.replace(/\d{4}-\d{2}-\d{2}/, "D")), ["feedback/run-acme-run-1/D-module-explorer.md", "feedback/run-acme-run-1/D-pw-ui-pom-writer.md"]);
  const text = readFileSync(path.join(root, end.feedback[0]), "utf8");
  const doc = parseFrontmatter(text);
  assert.deepEqual(doc.problems, [], "a valid feedback file, ready for feedback-implementor-agent");
  assert.deepEqual([doc.front.source_agent, doc.front.target, doc.front.related_files, doc.front.severity], ["module-explorer", "framework", ["agents/module-explorer.md"], "high"]);
  assert.match(text, /## Finding 1: Step 3 names a flag explore\.mjs refuses\n\*\*Summary:\*\* .*also reported by clarification-explorer\)\n\*\*Evidence:\*\* explore\.mjs state: unknown option --via-item\n\*\*Suggested fix:\*\* use --item/);
  assert.equal((await endRun("acme", { root })).errors?.length, 1, "nothing to write twice: the run has ended");
});
