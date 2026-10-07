import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { build, toolsFor } from "./build-agents.mjs";
import { round, show, step } from "./orchestration.mjs";
import { fromK6, fromPlaywright, record } from "./results.mjs";
import { collect } from "./report-data.mjs";
import { next, setStage, status } from "./run.mjs";
import { checkTestcases } from "./lib/testcases.mjs";
import { loadJson, paths, repoRoot, validateData } from "./lib/contract.mjs";
import { resolvePermissions } from "./lib/permissions.mjs";
import { append } from "./lib/clarifications.mjs";
import { put, startRun } from "./test-helpers.mjs";

const perms = resolvePermissions(yaml.load(readFileSync(path.join(repoRoot, "config", "permissions.yaml"), "utf8"))).resolved;

test("every agent in the repo is built from its permissions row and matches (build-agents --check)", () => {
  const { errors, changed } = build({ check: true });
  assert.deepEqual(errors, []);
  assert.deepEqual(changed, []);
});

test("tools follow permissions: workers cannot spawn, read-only browser gets no typing tools", () => {
  const w = toolsFor(perms.agents["pw-ui-tests-writer"]);
  assert.ok(!w.some((t) => t.startsWith("Agent")));
  assert.ok(!w.some((t) => t.startsWith("mcp__")));
  const kg = toolsFor(perms.agents["knowledge-generator"]);
  assert.ok(kg.includes("mcp__playwright__browser_snapshot"));
  assert.ok(!kg.includes("mcp__playwright__browser_type"));
  assert.ok(toolsFor(perms.agents["clarification-explorer"]).includes("mcp__playwright__browser_fill_form"));
  assert.ok(toolsFor(perms.agents["orchestrator-agent"]).includes("AskUserQuestion"));
  assert.ok(!toolsFor(perms.agents["question-writer"]).includes("Write"), "CSV is script-only");
});

test("build-agents reports missing and stray agent files", () => {
  const root = path.join(startRun().root, "b");
  mkdirSync(path.join(root, ".claude", "agents"), { recursive: true });
  cpSync(path.join(repoRoot, "config"), path.join(root, "config"), { recursive: true });
  writeFileSync(path.join(root, ".claude", "agents", "rogue.md"), "---\nname: rogue\ndescription: x\n---\n");
  const { errors } = build({ check: true, root });
  assert.ok(errors.some((e) => /rogue\.md: not in config\/permissions\.yaml/.test(e)));
  assert.ok(errors.some((e) => /orchestrator-agent\.md: missing/.test(e)));
});

test("orchestration rounds are bounded by the run-config limits and reset for a new run", () => {
  const { root } = startRun();
  for (let i = 1; i <= 3; i++) assert.deepEqual(round("acme", "playwright-ui", "contacts", "review", { root }), { round: i, limit: 3, allowed: true });
  assert.equal(round("acme", "playwright-ui", "contacts", "review", { root }).allowed, false);
  assert.equal(round("acme", "playwright-ui", "contacts", "heal", { root }).round, 1, "heal rounds are counted separately");
  step("acme", "playwright-ui", "contacts", "tests", "done", "12 specs", { root });
  assert.equal(show("acme", "playwright-ui", "contacts", { root }).steps.tests.status, "done");
  const p = paths("acme", root);
  const run = loadJson(p.runFile);
  writeFileSync(p.runFile, JSON.stringify({ ...run, runId: "acme-run-2" }));
  assert.deepEqual(show("acme", "playwright-ui", "contacts", { root }).rounds, { review: 0, heal: 0 });
  assert.throws(() => round("acme", "reports", "contacts", "review", { root }), /domain must be/);
});

test("Playwright and k6 outputs normalize into schema-valid results", async () => {
  const pw = fromPlaywright({
    stats: { duration: 1234.5 },
    suites: [{ title: "contacts.spec.ts", file: "tests/ui/contacts/contacts.spec.ts", specs: [
      { title: "TC-contacts-1 lists contacts", tests: [{ status: "expected", results: [{ duration: 10 }] }] },
      { title: "TC-contacts-2 creates @mutates", tests: [{ status: "skipped", results: [] }] },
    ], suites: [{ title: "filters", specs: [{ title: "TC-contacts-3 filters", tests: [{ status: "unexpected", results: [{ duration: 5, error: { message: "locator not found" } }] }] }] }] }],
  });
  assert.deepEqual(pw.totals, { total: 3, passed: 1, failed: 1, flaky: 0, skipped: 1 });
  assert.equal(pw.items[2].error, "locator not found");
  const k6 = fromK6([{ name: "contacts-list", data: { state: { testRunDurationMs: 30000 }, metrics: {
    http_req_duration: { values: { "p(95)": 420 }, thresholds: { "p(95)<500": { ok: true } } },
    http_req_failed: { values: { rate: 0.02 }, thresholds: { "rate<0.01": { ok: false } } },
    checks: { values: { passes: 98, fails: 2 } },
  } } }]);
  assert.equal(k6.items[0].status, "failed");
  assert.match(k6.items[0].error, /http_req_failed rate<0.01/);

  const { root } = startRun();
  const r = record("acme", "contacts", "playwright-ui", { status: "ran", ...pw }, { root });
  assert.deepEqual(await validateData("results", r), []);
  const nr = record("acme", "contacts", "k6", { status: "not-run", reason: "readonly", totals: { total: 0, passed: 0, failed: 0, flaky: 0, skipped: 0 }, durationMs: 0, items: [] }, { root });
  assert.deepEqual(await validateData("results", nr), []);
});

test("testcases stage: the summary total must match the cases in the configured format", () => {
  const { root } = startRun();
  const dir = "artifacts/acme/modules/contacts/testcases";
  put(root, `${dir}/contacts-testcases.feature`, "Feature: Contacts\n  @TC-contacts-1 @p1 @functional\n  Scenario: List\n  @TC-contacts-2 @p2 @negative\n  Scenario Outline: Invalid\n");
  put(root, `${dir}/testcases-summary.md`, "# Summary\n\nTotal test cases: 2\n");
  const summary = path.join(root, dir, "testcases-summary.md");
  assert.deepEqual(checkTestcases(summary, { module: "contacts", testcasesFormat: "gherkin" }), []);
  put(root, `${dir}/testcases-summary.md`, "Total test cases: 3\n");
  assert.match(checkTestcases(summary, { module: "contacts", testcasesFormat: "gherkin" })[0], /says 3 .* has 2/);
  assert.match(checkTestcases(summary, { module: "contacts", testcasesFormat: "csv" })[0], /missing/);
});

test("report data counts what exists, from files, per module", () => {
  const { root } = startRun();
  const p = paths("acme", root);
  put(root, "artifacts/acme/modules/contacts/explore/sitemap.json", JSON.stringify([{ url: "u", slug: "list", title: "List" }]));
  append(path.join(p.module("contacts"), "clarifications.csv"), "contacts", "acme-run-1", [{ question: "q1?", steps: "1." }, { question: "q2?", steps: "1." }]);
  put(root, "artifacts/acme/modules/contacts/testcases/testcases-summary.md", "Total test cases: 7\n");
  put(root, "playwright-tests/acme/tests/ui/contacts/a.spec.ts", "");
  put(root, "playwright-tests/acme/tests/ui/contacts/b.spec.ts", "");
  put(root, "playwright-tests/acme/tests/api/contacts/c.spec.ts", "");
  put(root, "k6-tests/acme/scripts/contacts-list.js", "");
  put(root, "k6-tests/acme/scripts/deals-list.js", "");
  record("acme", "contacts", "playwright-ui", { status: "ran", totals: { total: 5, passed: 4, failed: 1, flaky: 0, skipped: 0 }, durationMs: 9, items: [] }, { root });
  const d = collect("acme", { root });
  assert.equal(d.totals.modulesExplored, 1);
  assert.deepEqual(d.totals.clarifications, { total: 2, answered: 0, unconfirmed: 2 });
  assert.equal(d.totals.testcases, 7);
  assert.equal(d.totals.playwrightUiSpecs, 2);
  assert.equal(d.totals.playwrightApiSpecs, 1);
  assert.equal(d.totals.k6Scripts, 2);
  assert.equal(d.totals.execution["playwright-ui"].failed, 1);
  assert.equal(d.totals.execution["playwright-ui"].modulesRun, 1);
});

test("init creates a header-only clarifications.csv per module", () => {
  const { root } = startRun();
  const csv = readFileSync(path.join(paths("acme", root).module("deals"), "clarifications.csv"), "utf8");
  assert.equal(csv.trim(), "ID,Module,Question,Steps to execute,Answer,Clarification agent notes,Run ID");
});

test("a stage failing twice is exhausted, its dependents are blocked, and the report still becomes ready", async () => {
  const { root } = startRun();
  const fail = async (stage, module) => {
    await setStage("acme", stage, module, "start", undefined, { root });
    await setStage("acme", stage, module, "fail", "boom", { root });
  };
  await fail("knowledge");
  assert.ok((await next("acme", { root })).some((s) => s.stage === "knowledge" && s.retry && s.attempt === 2));
  await fail("knowledge");
  assert.match((await setStage("acme", "knowledge", undefined, "start", undefined, { root })).errors[0], /failed 2 times/);
  const st = await status("acme", { root });
  assert.ok(st.stages.filter((s) => s.module === "contacts").every((s) => s.blocked), "everything downstream of knowledge is blocked");
  await fail("playwright-repo");
  await fail("playwright-repo");
  assert.deepEqual((await next("acme", { root })).map((s) => s.stage), ["report"]);
});
