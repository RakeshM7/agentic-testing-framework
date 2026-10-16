// `orchestration.mjs next` drives each domain's loop from its flow and what is on disk, the way a domain
// orchestrator uses it: ask next, start the agent, mark the step, repeat. Gate compile commands are skipped here.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { next, show, step } from "./orchestration.mjs";
import { append, csvPath, record } from "./lib/clarifications.mjs";
import { paths } from "./lib/contract.mjs";
import { put, startRun } from "./test-helpers.mjs";

const RESULTS = "artifacts/acme/results/acme-run-1/contacts";
const go = (root, domain, opts = {}) => next("acme", domain, "contacts", { root, compile: false, ...opts });
// Start the single returned action, let `work` produce its files, mark it done; returns the action.
function perform(root, domain, expect, work = () => {}) {
  const r = go(root, domain);
  assert.equal(r.actions.length, 1, `expected one action, got ${JSON.stringify(r)}`);
  const [a] = r.actions;
  assert.deepEqual({ step: a.step, agent: a.agent }, expect);
  step("acme", domain, "contacts", a.step, "start", undefined, { root });
  work(a);
  step("acme", domain, "contacts", a.step, "done", undefined, { root });
  return a;
}
const uiCases = (root) => {
  put(root, "artifacts/acme/modules/contacts/testcases/contacts-testcases.feature", "Feature: C\n  @TC-contacts-1 @p1 @functional\n  Scenario: list\n    Given x\n");
  put(root, "artifacts/acme/modules/contacts/testcases/testcases-summary.md", "Total test cases: 1\n");
};
const goodSpec = (root) => put(root, "playwright-tests/acme/tests/ui/contacts/c.spec.ts", "test('TC-contacts-1 lists @p1', async () => {});\n");
const verdict = (root, v) => put(root, `${RESULTS}/playwright-ui/review-findings.md`, `# Review\nVerdict: ${v}\n| # | Severity | File | Line | Rule | Problem | Required fix |\n|---|---|---|---|---|---|---|\n`);
const triage = (root, framework, healable) =>
  put(root, `${RESULTS}/${framework}/triage.md`, ["# Triage", "| Test | File | Classification | Healable | Evidence | Suggested action |", "|---|---|---|---|---|---|", ...(healable ? ["| TC-contacts-1 | c.spec.ts | test-bug | yes | x | fix locator |"] : []), ""].join("\n"));

test("Playwright UI: build, a failing gate goes straight to the fixer, review, run, heal, re-run, done", () => {
  const { root } = startRun();
  uiCases(root);
  perform(root, "playwright-ui", { step: "scaffold", agent: "pw-ui-scaffolder" });
  perform(root, "playwright-ui", { step: "pages", agent: "pw-ui-pom-writer" });
  perform(root, "playwright-ui", { step: "tests", agent: "pw-ui-tests-writer" }, () =>
    put(root, "playwright-tests/acme/tests/ui/contacts/c.spec.ts", "test('TC-contacts-1 lists @p1', async ({ page }) => { await page.waitForTimeout(9); });\n"));

  const fix = perform(root, "playwright-ui", { step: "fix-1", agent: "pw-ui-fixer" }, () => goodSpec(root));
  assert.equal(fix.prompt, `product=acme module=contacts findings=${RESULTS}/playwright-ui/gate-findings.md`, "gate findings go to the fixer; no reviewer started");
  assert.equal(show("acme", "playwright-ui", "contacts", { root }).steps["gate-1"].note, "changes-required");

  const review = perform(root, "playwright-ui", { step: "review-2", agent: "pw-ui-reviewer" }, () => verdict(root, "changes-required"));
  assert.equal(review.prompt, "product=acme module=contacts run=acme-run-1 round=2");
  perform(root, "playwright-ui", { step: "fix-2", agent: "pw-ui-fixer" });
  perform(root, "playwright-ui", { step: "review-3", agent: "pw-ui-reviewer" }, () => verdict(root, "pass"));

  const run = perform(root, "playwright-ui", { step: "run-1", agent: "pw-ui-test-runner-triager" }, () => triage(root, "playwright-ui", true));
  assert.equal(run.prompt, "product=acme module=contacts run=acme-run-1 mode=readonly round=1");
  const heal = perform(root, "playwright-ui", { step: "heal-1", agent: "pw-ui-fixer" });
  assert.equal(heal.prompt, `product=acme module=contacts triage=${RESULTS}/playwright-ui/triage.md`);
  perform(root, "playwright-ui", { step: "run-2", agent: "pw-ui-test-runner-triager" }, () => triage(root, "playwright-ui", false));

  const done = go(root, "playwright-ui");
  assert.deepEqual(done.actions, []);
  assert.equal(done.done.outcome, "complete");
  assert.equal(done.done.review.note, "passed in round 3");
  assert.deepEqual(go(root, "playwright-ui").done.outcome, "complete", "asking again after the end is stable");
});

test("an interrupted step is offered again, and an existing foundation is skipped", () => {
  const { root } = startRun();
  for (const f of ["config/ui/settings.ts", "fixtures/ui/index.ts", "fixtures/ui/auth.setup.ts"]) put(root, `playwright-tests/acme/${f}`, "export {};\n");
  const r = go(root, "playwright-ui");
  assert.equal(r.actions[0].step, "pages");
  assert.equal(show("acme", "playwright-ui", "contacts", { root }).steps.scaffold.status, "skipped");
  step("acme", "playwright-ui", "contacts", "pages", "start", undefined, { root });
  assert.equal(go(root, "playwright-ui").actions[0].step, "pages", "a step left running (crash) is resumed");
  step("acme", "playwright-ui", "contacts", "pages", "fail", "pom-writer could not ground locators", { root });
  assert.deepEqual(go(root, "playwright-ui").done, { outcome: "failed", failedStep: "pages", note: "pom-writer could not ground locators" });
});

test("review rounds are bounded: test cases end review-failed; automation still runs the suite", () => {
  const { root } = startRun();
  perform(root, "testcases", { step: "write", agent: "testcase-writer" }); // no test cases written: the gate keeps failing
  for (const n of [1, 2, 3]) {
    const a = perform(root, "testcases", { step: `fix-${n}`, agent: "testcase-writer" });
    assert.match(a.prompt, /format=gherkin$/);
  }
  const done = go(root, "testcases");
  assert.equal(done.done.outcome, "review-failed");
  assert.match(done.done.review.note, /3 review rounds used/);

  const ui = startRun();
  uiCases(ui.root);
  for (const s of ["scaffold", "pages", "tests"]) step("acme", "playwright-ui", "contacts", s, "done", undefined, { root: ui.root });
  for (const n of [1, 2, 3]) perform(ui.root, "playwright-ui", { step: `fix-${n}`, agent: "pw-ui-fixer" }); // no spec: gate fails
  perform(ui.root, "playwright-ui", { step: "run-1", agent: "pw-ui-test-runner-triager" });
});

test("heal rounds are bounded by limits.heal_rounds", () => {
  const { root } = startRun();
  uiCases(root);
  goodSpec(root);
  for (const s of ["scaffold", "pages", "tests"]) step("acme", "playwright-ui", "contacts", s, "done", undefined, { root });
  perform(root, "playwright-ui", { step: "review-1", agent: "pw-ui-reviewer" }, () => verdict(root, "pass"));
  for (const n of [1, 2, 3]) {
    perform(root, "playwright-ui", { step: `run-${n}`, agent: "pw-ui-test-runner-triager" }, () => triage(root, "playwright-ui", true));
    perform(root, "playwright-ui", { step: `heal-${n}`, agent: "pw-ui-fixer" });
  }
  perform(root, "playwright-ui", { step: "run-4", agent: "pw-ui-test-runner-triager" });
  const done = go(root, "playwright-ui");
  assert.equal(done.done.outcome, "heal-limit");
  assert.match(done.done.run.note, /1 healable failure\(s\) left after 3 heal rounds/);
});

test("Playwright API with no API surface skips the build and review and goes to the runner", () => {
  const { root } = startRun();
  perform(root, "playwright-api", { step: "discover", agent: "api-discoverer" }, () => put(root, "artifacts/acme/modules/contacts/api/discovered-endpoints.json", "[]"));
  perform(root, "playwright-api", { step: "run-1", agent: "pw-api-test-runner-triager" });
  const s = show("acme", "playwright-api", "contacts", { root }).steps;
  assert.deepEqual(["plan", "scaffold", "clients", "tests", "review"].map((k) => [s[k].status, s[k].note]), Array(5).fill(["skipped", "no API surface found"]));
});

test("clarifications: open rows come in batches of --max, then the summary is rendered", () => {
  const { root } = startRun();
  const file = csvPath(paths("acme", root).productDir, "contacts");
  append(file, "contacts", "acme-run-1", [1, 2, 3].map((n) => ({ question: `Q${n}?`, steps: "1. Sign in." })));
  record(file, "contacts-2", { answer: "Yes", runId: "acme-run-1" });
  const r = go(root, "clarifications", { max: 5 });
  assert.deepEqual(r.actions.map((a) => [a.step, a.agent, a.prompt]), [
    ["explore-contacts-1", "clarification-explorer", "product=acme module=contacts id=contacts-1 mode=readonly"],
    ["explore-contacts-3", "clarification-explorer", "product=acme module=contacts id=contacts-3 mode=readonly"],
  ]);
  for (const a of r.actions) step("acme", "clarifications", "contacts", a.step, "done", undefined, { root });
  const done = go(root, "clarifications");
  assert.equal(done.done.outcome, "complete");
  assert.deepEqual([done.done.summary.answered, done.done.summary.total], [1, 3]);
  assert.ok(existsSync(path.join(root, done.done.summary.file)));
});
