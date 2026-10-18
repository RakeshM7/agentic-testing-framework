// `orchestration.mjs next` drives each domain's loop from its flow and what is on disk, the way a domain
// orchestrator uses it: ask next, start the agent, mark the step, repeat. Gate compile commands are skipped here.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { next, show, step } from "./orchestration.mjs";
import { append, csvPath, readRows, record, recordOutcome } from "./lib/clarifications.mjs";
import { paths } from "./lib/contract.mjs";
import { buildCases, humanEdit, put, renderFoundation, scaffoldUiCode, startRun } from "./test-helpers.mjs";

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
// An approved case and the UI foundation, then the UI code the way the writers make it (ui-code.mjs build + check, D-055).
const uiCases = (root) => buildCases(root, { cases: [{ key: "list" }], approve: ["list"] });
async function uiCode(root) {
  await uiCases(root);
  await renderFoundation(root, ["repo", "ui"]);
  await scaffoldUiCode(root);
}
const SPEC = "playwright-tests/acme/tests/ui/contacts/cases.spec.ts";
const editSpec = (root, from, to) => put(root, SPEC, readFileSync(path.join(root, SPEC), "utf8").replace(from, to));
const verdict = (root, v) => put(root, `${RESULTS}/playwright-ui/review-findings.md`, `# Review\nVerdict: ${v}\n| # | Severity | File | Line | Rule | Problem | Required fix |\n|---|---|---|---|---|---|---|\n`);
const triage = (root, framework, healable) =>
  put(root, `${RESULTS}/${framework}/triage.md`, ["# Triage", "| Test | File | Classification | Healable | Evidence | Suggested action |", "|---|---|---|---|---|---|", ...(healable ? ["| TC-contacts-1 | c.spec.ts | test-bug | yes | x | fix locator |"] : []), ""].join("\n"));
// The single returned action, started; `work` (async) produces its files; then marked done.
async function performAsync(root, domain, expect, work) {
  const [a] = go(root, domain).actions;
  assert.deepEqual({ step: a?.step, agent: a?.agent }, expect);
  step("acme", domain, "contacts", a.step, "start", undefined, { root });
  await work(a);
  step("acme", domain, "contacts", a.step, "done", undefined, { root });
  return a;
}

test("Playwright UI: build (verified by ui-code.mjs check), review, a failing gate goes straight to the fixer, run, heal, re-run, done", async () => {
  const { root } = startRun();
  await uiCases(root);
  // the scaffolder renders and checks the UI foundation (D-054); its done step counts only with the verified stamp
  await performAsync(root, "playwright-ui", { step: "scaffold", agent: "pw-ui-scaffolder" }, () => renderFoundation(root, ["repo", "ui"]));
  // the writers' done steps count only with ui-code.mjs check's stamps (D-055)
  await performAsync(root, "playwright-ui", { step: "pages", agent: "pw-ui-pom-writer" }, () => scaffoldUiCode(root, { scope: "pages" }));
  await performAsync(root, "playwright-ui", { step: "tests", agent: "pw-ui-tests-writer" }, () => scaffoldUiCode(root));

  const review = perform(root, "playwright-ui", { step: "review-1", agent: "pw-ui-reviewer" }, () => verdict(root, "changes-required"));
  assert.equal(review.prompt, "product=acme module=contacts run=acme-run-1 round=1");
  assert.equal(show("acme", "playwright-ui", "contacts", { root }).steps.tests.verified, true, "verified once, when first seen done");
  // the fixer's edit makes the stamps stale: the gate, not the build step, judges it from here on
  perform(root, "playwright-ui", { step: "fix-1", agent: "pw-ui-fixer" }, () => editSpec(root, "await page.goto('/');", "await page.waitForTimeout(9);"));
  const fix = perform(root, "playwright-ui", { step: "fix-2", agent: "pw-ui-fixer" }, () => editSpec(root, "await page.waitForTimeout(9);", "await page.goto('/');"));
  assert.equal(fix.prompt, `product=acme module=contacts findings=${RESULTS}/playwright-ui/gate-findings.md`, "gate findings go to the fixer; no reviewer started");
  assert.equal(show("acme", "playwright-ui", "contacts", { root }).steps["gate-2"].note, "changes-required");
  assert.equal(show("acme", "playwright-ui", "contacts", { root }).steps["review-2"], undefined);
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

test("Playwright UI: a pages or tests step that never passed ui-code.mjs check ends the domain failed; all-@api approvals skip the UI build", async () => {
  const { root } = startRun();
  await uiCases(root);
  await renderFoundation(root, ["repo", "ui"]);
  perform(root, "playwright-ui", { step: "pages", agent: "pw-ui-pom-writer" }); // nothing built
  let done = go(root, "playwright-ui");
  assert.deepEqual([done.done.outcome, done.done.failedStep], ["failed", "pages"]);
  assert.match(done.done.note, /ui-code\/coverage\.json is missing/);

  const again = startRun();
  await uiCases(again.root);
  await renderFoundation(again.root, ["repo", "ui"]);
  await performAsync(again.root, "playwright-ui", { step: "pages", agent: "pw-ui-pom-writer" }, () => scaffoldUiCode(again.root, { scope: "pages" }));
  perform(again.root, "playwright-ui", { step: "tests", agent: "pw-ui-tests-writer" }); // built, but no step filled or checked
  done = go(again.root, "playwright-ui");
  assert.deepEqual([done.done.outcome, done.done.failedStep], ["failed", "tests"]);
  assert.match(done.done.note, /the tests never passed ui-code\.mjs check acme contacts/);

  const api = startRun();
  await buildCases(api.root, { cases: [{ key: "endpoint", api: true }], approve: ["endpoint"] });
  await renderFoundation(api.root, ["repo", "ui"]);
  perform(api.root, "playwright-ui", { step: "run-1", agent: "pw-ui-test-runner-triager" });
  assert.match(show("acme", "playwright-ui", "contacts", { root: api.root }).steps.pages.note, /every approved test case is @api/);
});

test("an interrupted step is offered again, and a verified foundation is skipped", async () => {
  const { root } = startRun();
  // files that merely exist are no foundation: only foundation.mjs check's current stamp is (D-054)
  for (const f of ["config/ui/settings.ts", "fixtures/ui/auth.setup.ts"]) put(root, `playwright-tests/acme/${f}`, "export {};\n");
  assert.equal(go(root, "playwright-ui").actions[0].step, "scaffold");
  await renderFoundation(root, ["repo", "ui"]);
  const r = go(root, "playwright-ui");
  assert.equal(r.actions[0].step, "pages");
  assert.equal(show("acme", "playwright-ui", "contacts", { root }).steps.scaffold.status, "skipped");
  assert.match(show("acme", "playwright-ui", "contacts", { root }).steps.scaffold.note, /the UI foundation is verified/);
  step("acme", "playwright-ui", "contacts", "pages", "start", undefined, { root });
  assert.equal(go(root, "playwright-ui").actions[0].step, "pages", "a step left running (crash) is resumed");
  step("acme", "playwright-ui", "contacts", "pages", "fail", "pom-writer could not ground locators", { root });
  assert.deepEqual(go(root, "playwright-ui").done, { outcome: "failed", failedStep: "pages", note: "pom-writer could not ground locators" });
});

// The reviewer's per-case verdicts for round n (D-053): every case of the module, with `finding` for the ones listed.
const versions = (root) => new Map(JSON.parse(readFileSync(path.join(root, "artifacts/acme/modules/contacts/testcases/coverage.json"), "utf8")).cases.map((c) => [c.id, c.version]));
const review = (root, n, ids, findings = [], v = versions(root)) =>
  put(root, `${RESULTS}/testcases/review.json`, JSON.stringify({ module: "contacts", round: n, cases: Object.fromEntries(ids.map((id) => [id, findings.includes(id) ? { verdict: "finding", version: v.get(id), findings: [{ severity: "major", rule: "correctness", problem: `${id} expects the wrong result`, fix: "quote the observed message" }] } : { verdict: "ok", version: v.get(id) }])) }));

test("test cases: a write step that never passed testcases.mjs check ends the domain failed", () => {
  const { root } = startRun();
  const a = perform(root, "testcases", { step: "write", agent: "testcase-writer" }); // nothing built
  assert.equal(a.prompt, "product=acme module=contacts", "no format argument: the script knows it");
  const done = go(root, "testcases");
  assert.equal(done.done.outcome, "failed");
  assert.equal(done.done.failedStep, "write");
  assert.match(done.done.note, /coverage\.json is missing/);
  assert.deepEqual(done.done.summary, { total: 0, assumption: 0, items: null, approvals: { approved: 0, rejected: 0, changes: 0, awaiting: 0, invalidated: 0 }, unresolved: [] });
});

test("test cases: the review verdict is derived from per-case verdicts; rounds are bounded; done reports totals, approvals and what is unresolved", async () => {
  const { root } = startRun();
  let ids;
  perform(root, "testcases", { step: "write", agent: "testcase-writer" });
  ids = [...(await buildCases(root, { cases: [{ key: "list" }, { key: "create", mutates: true }], approve: ["list"] })).values()];
  for (const n of [1, 2, 3]) {
    const r = perform(root, "testcases", { step: `review-${n}`, agent: "testcase-reviewer" }, () => review(root, n, ids, [ids[1]]));
    assert.equal(r.prompt, `product=acme module=contacts run=acme-run-1 round=${n}`);
    perform(root, "testcases", { step: `fix-${n}`, agent: "testcase-writer" });
  }
  const done = go(root, "testcases");
  assert.equal(done.done.outcome, "review-failed");
  assert.match(done.done.review.note, /3 review rounds used/);
  assert.equal(done.done.summary.total, 2);
  assert.deepEqual(done.done.summary.approvals, { approved: 1, rejected: 0, changes: 0, awaiting: 1, invalidated: 0 });
  assert.deepEqual(done.done.summary.unresolved.map((f) => [f.severity, f.rule]), [["major", "correctness"]]);
  assert.match(done.done.summary.unresolved[0].problem, new RegExp(`${ids[1]}: ${ids[1]} expects the wrong result`));
});

test("test cases: a review missing a verdict for a case, or from another round, fails the step; a clean one passes", async () => {
  const { root } = startRun();
  perform(root, "testcases", { step: "write", agent: "testcase-writer" });
  const ids = [...(await buildCases(root, { cases: [{ key: "list" }, { key: "create" }] })).values()];
  perform(root, "testcases", { step: "review-1", agent: "testcase-reviewer" }, () => review(root, 1, ids.slice(0, 1)));
  let done = go(root, "testcases");
  assert.equal(done.done.outcome, "failed");
  assert.match(done.done.note, new RegExp(`${ids[1]}: no verdict in this round`));

  const again = startRun();
  perform(again.root, "testcases", { step: "write", agent: "testcase-writer" });
  const ids2 = [...(await buildCases(again.root, { cases: [{ key: "list" }] })).values()];
  perform(again.root, "testcases", { step: "review-1", agent: "testcase-reviewer" }, () => {
    review(again.root, 1, ids2);
    // a typed verdict line is never trusted: the derived one replaces it
    put(again.root, `${RESULTS}/testcases/review-findings.md`, "Verdict: changes-required\n");
  });
  done = go(again.root, "testcases");
  assert.equal(done.done.outcome, "complete");
  assert.match(readFileSync(path.join(again.root, RESULTS, "testcases/review-findings.md"), "utf8"), /^Verdict: pass$/m);
});

test("review rounds are bounded: automation still runs the suite", async () => {
  const ui = startRun();
  await uiCode(ui.root);
  for (const s of ["scaffold", "pages", "tests"]) step("acme", "playwright-ui", "contacts", s, "done", undefined, { root: ui.root });
  for (const n of [1, 2, 3]) {
    perform(ui.root, "playwright-ui", { step: `review-${n}`, agent: "pw-ui-reviewer" }, () => verdict(ui.root, "changes-required"));
    perform(ui.root, "playwright-ui", { step: `fix-${n}`, agent: "pw-ui-fixer" });
  }
  perform(ui.root, "playwright-ui", { step: "run-1", agent: "pw-ui-test-runner-triager" });
});

test("heal rounds are bounded by limits.heal_rounds", async () => {
  const { root } = startRun();
  await uiCode(root);
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

// What a clarification-explorer leaves behind when it records its row properly (via recordOutcome).
function explore(root, id, verdict = "unconfirmed") {
  const pp = paths("acme", root);
  const file = csvPath(pp.productDir, "contacts");
  put(root, `artifacts/acme/modules/contacts/clarification-evidence/${id}/observation.md`, `Verdict: ${verdict}\n`);
  const ev = [`clarification-evidence/${id}/observation.md`];
  const outcome = verdict === "confirmed"
    ? (put(root, `artifacts/acme/modules/contacts/clarification-evidence/${id}/snapshot-1.md`, "- alert: Saved\n"),
      { verdict, answer: { context: "c", action: "a", result: 'shows "Saved"', scope: "s" }, basis: ["observed"], evidence: [...ev, `clarification-evidence/${id}/snapshot-1.md`] })
    : { verdict, reason: "needs-full-run", summary: "needs a submit", nextStep: "re-run in full-run", evidence: ev };
  return recordOutcome(file, outcome, { id, module: "contacts", runId: "acme-run-1", mode: "readonly", ledgerEntries: [], sourceIds: new Set(), productDir: pp.productDir });
}

test("clarifications: one row at a time from the rows open at the start, each checked, then the summary", () => {
  const { root } = startRun();
  const file = csvPath(paths("acme", root).productDir, "contacts");
  append(file, "contacts", "acme-run-1", [1, 2, 3].map((n) => ({ question: `Q${n}?`, steps: "1. Sign in." })));
  record(file, "contacts-2", { answer: "Yes", runId: "acme-run-1" });
  const r = go(root, "clarifications", { max: 5 });
  assert.deepEqual(r.actions.map((a) => [a.step, a.agent, a.prompt]), [["explore-contacts-1", "clarification-explorer", "product=acme module=contacts id=contacts-1 mode=readonly"]], "one at a time, whatever --max says (D-047)");
  perform(root, "clarifications", { step: "explore-contacts-1", agent: "clarification-explorer" }, () => explore(root, "contacts-1", "confirmed"));
  perform(root, "clarifications", { step: "explore-contacts-3", agent: "clarification-explorer" }, () => explore(root, "contacts-3"));
  const done = go(root, "clarifications");
  assert.equal(done.done.outcome, "complete");
  assert.deepEqual([done.done.summary.answered, done.done.summary.total, done.done.summary.proposed], [2, 3, ["contacts-1", "contacts-2"]]);
  assert.deepEqual([done.done.deferred, done.done.failedRows], [[], []]);
  assert.ok(existsSync(path.join(root, done.done.summary.file)));
  assert.equal(show("acme", "clarifications", "contacts", { root }).steps["explore-contacts-1"].verified, true);
});

test("clarifications: an explorer that left no valid record is retried once, then the script records the row blocked", () => {
  const { root } = startRun();
  const file = csvPath(paths("acme", root).productDir, "contacts");
  append(file, "contacts", "acme-run-1", [{ question: "Q1?", steps: "1. Sign in." }]);
  perform(root, "clarifications", { step: "explore-contacts-1", agent: "clarification-explorer" }); // returns without recording
  const retry = go(root, "clarifications");
  assert.equal(retry.actions[0].prompt, "product=acme module=contacts id=contacts-1 mode=readonly attempt=2");
  assert.match(show("acme", "clarifications", "contacts", { root }).notes.join("\n"), /explore-contacts-1: attempt 1: no clarification-evidence\/contacts-1\/record.json/);
  step("acme", "clarifications", "contacts", "explore-contacts-1", "start", undefined, { root });
  step("acme", "clarifications", "contacts", "explore-contacts-1", "fail", "browser crashed", { root });
  const done = go(root, "clarifications");
  assert.equal(done.done.outcome, "complete");
  assert.deepEqual(done.done.failedRows, ["contacts-1"]);
  const [row] = readRows(file);
  assert.match(row.notes, /^\[acme-run-1\] blocked \(no-valid-record\): the explorer failed: browser crashed \(after 2 attempts\)\.\nNext step: /);
  assert.deepEqual(done.done.summary.unconfirmed.map((u) => u.id), ["contacts-1"]);
});

test("clarifications: a row answered by a human meanwhile needs no record; follow-ups wait for the next run", () => {
  const { root } = startRun();
  const file = csvPath(paths("acme", root).productDir, "contacts");
  append(file, "contacts", "acme-run-1", [1, 2].map((n) => ({ question: `Q${n}?`, steps: "1. Sign in." })));
  perform(root, "clarifications", { step: "explore-contacts-1", agent: "clarification-explorer" }, () => {
    explore(root, "contacts-1");
    append(file, "contacts", "acme-run-1", [{ question: "Follow-up?", steps: "1. Sign in." }], { raisedBy: "contacts-1" });
  });
  perform(root, "clarifications", { step: "explore-contacts-2", agent: "clarification-explorer" }, () => humanEdit(file, "contacts-2", { answer: "Only admins" }));
  const done = go(root, "clarifications");
  assert.equal(done.done.outcome, "complete");
  assert.deepEqual([done.done.deferred, done.done.failedRows], [["contacts-3"], []]);
});
