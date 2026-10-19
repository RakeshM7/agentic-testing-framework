// `orchestration.mjs next` drives each domain's loop from its flow and what is on disk, the way a domain
// orchestrator uses it: ask next, start the agent, mark the step, repeat. Gate compile commands are skipped here.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { next, show, step } from "./orchestration.mjs";
import { reviewCheck } from "./lib/review.mjs";
import { requiredEntries } from "./lib/fix.mjs";
import { healableRows } from "./lib/domain-flows.mjs";
import { append, csvPath, readRows, record, recordOutcome } from "./lib/clarifications.mjs";
import { paths } from "./lib/contract.mjs";
import { main as requestsMain } from "./requests.mjs";
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
// The UI reviewer's per-test review.json for round n (G9), checked: `pass` reviews every test ok, anything else gives each a
// major finding. review.mjs check derives the verdict and stamps it, as the reviewer's own command does.
const verdict = (root, v, round = 1) => {
  const p = paths("acme", root);
  const plan = JSON.parse(readFileSync(path.join(p.productDir, "modules/contacts/ui-code/plan.json"), "utf8"));
  const bad = { severity: "major", location: "tests/ui/contacts/cases.spec.ts:1", reason: "the test proves something adjacent" };
  const tests = Object.fromEntries(plan.tests.map((t) => [t.id, { intent: v === "pass" ? "ok" : bad, assertion: "ok", flakiness: "ok", "data-safety": "ok" }]));
  put(root, `${RESULTS}/playwright-ui/review.json`, JSON.stringify({ module: "contacts", round, tests }));
  const r = reviewCheck({ root, module: "contacts", productDir: p.productDir, runId: "acme-run-1", pwProject: p.pwProject, k6Project: p.k6Project }, "playwright-ui", { round });
  assert.equal(r.verdict, v, JSON.stringify(r));
};
// The fixer's fix-report.json (G9) answering every blocker/major finding of the round (or healable row): all fixed in the
// spec when `changed`, else all not-fixed. The orchestration verifies it with fix.mjs check once the fixer's step is done.
const answer = (root, round, source = "review", changed = false) => {
  const p = paths("acme", root);
  const { ids } = requiredEntries({ module: "contacts", productDir: p.productDir, runId: "acme-run-1" }, "playwright-ui", round, source);
  const entries = ids.map((id) => (changed ? { id, status: "fixed", files: ["tests/ui/contacts/cases.spec.ts"] } : { id, status: "not-fixed", reason: "needs-human", text: "left for a human" }));
  put(root, `${RESULTS}/playwright-ui/fix-report.json`, JSON.stringify({ module: "contacts", round, source, entries }));
};
// A verified triage.json (D-058): no results, known issues or overlay on disk, so the stamp is all nulls and stays current.
const stamp = { results: null, knownIssues: null, overlay: null };
const triage = (root, framework, healable, { verified = stamp, cls = "test-bug" } = {}) =>
  put(root, `${RESULTS}/${framework}/triage.json`, JSON.stringify({ module: "contacts", rows: healable ? [{ key: "ui:TC-contacts-1", class: cls, healable: true }, { key: "ui:TC-contacts-2", class: "flaky", healable: false }] : [{ key: "ui:TC-contacts-2", class: "flaky", healable: false }], verified }));
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
  perform(root, "playwright-ui", { step: "fix-1", agent: "pw-ui-fixer" }, () => { editSpec(root, "await page.goto('/');", "await page.waitForTimeout(9);"); answer(root, 1, "review", true); });
  const fix = perform(root, "playwright-ui", { step: "fix-2", agent: "pw-ui-fixer" }, () => { editSpec(root, "await page.waitForTimeout(9);", "await page.goto('/');"); answer(root, 2, "review", true); });
  assert.equal(fix.prompt, `product=acme module=contacts findings=${RESULTS}/playwright-ui/gate-findings.md round=2`, "gate findings go to the fixer; no reviewer started");
  assert.equal(show("acme", "playwright-ui", "contacts", { root }).steps["gate-2"].note, "changes-required");
  assert.equal(show("acme", "playwright-ui", "contacts", { root }).steps["review-2"], undefined);
  perform(root, "playwright-ui", { step: "review-3", agent: "pw-ui-reviewer" }, () => verdict(root, "pass", 3));

  const run = perform(root, "playwright-ui", { step: "run-1", agent: "pw-ui-test-runner-triager" }, () => triage(root, "playwright-ui", true));
  assert.equal(run.prompt, "product=acme module=contacts run=acme-run-1 mode=readonly round=1");
  const heal = perform(root, "playwright-ui", { step: "heal-1", agent: "pw-ui-fixer" }, () => answer(root, 1, "triage"));
  assert.equal(heal.prompt, `product=acme module=contacts triage=${RESULTS}/playwright-ui/triage.json round=1`);
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
  const failed = go(root, "playwright-ui").done;
  assert.deepEqual([failed.outcome, failed.failedStep, failed.note], ["failed", "pages", "pom-writer could not ground locators"]);
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

test("review rounds are bounded: a review that never passes ends the domain review-failed with its open findings, and no suite runs (G10)", async () => {
  const ui = startRun();
  await uiCode(ui.root);
  for (const s of ["scaffold", "pages", "tests"]) step("acme", "playwright-ui", "contacts", s, "done", undefined, { root: ui.root });
  for (const n of [1, 2, 3]) {
    perform(ui.root, "playwright-ui", { step: `review-${n}`, agent: "pw-ui-reviewer" }, () => verdict(ui.root, "changes-required", n));
    perform(ui.root, "playwright-ui", { step: `fix-${n}`, agent: "pw-ui-fixer" }, () => answer(ui.root, n));
  }
  const done = go(ui.root, "playwright-ui");
  assert.deepEqual(done.actions, []);
  assert.equal(done.done.outcome, "review-failed");
  assert.equal(show("acme", "playwright-ui", "contacts", { root: ui.root }).steps["run-1"], undefined, "the runner is never offered");
  assert.deepEqual(done.done.reviewFailure, { rounds: 3, file: `${RESULTS}/playwright-ui/review-findings.md`, total: 1, findings: [{ n: 1, severity: "major", rule: "intent", problem: "TC-contacts-1: the test proves something adjacent" }] });
  assert.deepEqual(done.done.summary.unresolved, done.done.reviewFailure.findings);
  assert.equal(done.done.summary.results, null);
  assert.deepEqual(show("acme", "playwright-ui", "contacts", { root: ui.root }).reviewFailure, done.done.reviewFailure, "kept in the state for run.mjs");
});

test("a heal round starts only from a verified triage; locator-drift rows heal like test-bug rows (D-058)", async () => {
  const setup = async () => {
    const r = startRun();
    await uiCode(r.root);
    for (const s of ["scaffold", "pages", "tests"]) step("acme", "playwright-ui", "contacts", s, "done", undefined, { root: r.root });
    perform(r.root, "playwright-ui", { step: "review-1", agent: "pw-ui-reviewer" }, () => verdict(r.root, "pass"));
    return r.root;
  };
  // the rows exist, but triage.mjs check never stamped them: no heal round, the run step fails with the reason
  const a = await setup();
  perform(a, "playwright-ui", { step: "run-1", agent: "pw-ui-test-runner-triager" }, () => triage(a, "playwright-ui", true, { verified: null }));
  let done = go(a, "playwright-ui");
  assert.deepEqual([done.done.outcome, done.done.failedStep], ["failed", "run-1"]);
  assert.match(done.done.note, /did not pass triage\.mjs check/);
  assert.equal(show("acme", "playwright-ui", "contacts", { root: a }).steps["heal-1"], undefined);

  // a stamp the results no longer match is no stamp either
  const b = await setup();
  perform(b, "playwright-ui", { step: "run-1", agent: "pw-ui-test-runner-triager" }, () => {
    triage(b, "playwright-ui", true, { cls: "locator-drift" });
    put(b, `${RESULTS}/playwright-ui/results.json`, "{}");
  });
  done = go(b, "playwright-ui");
  assert.deepEqual([done.done.outcome, done.done.failedStep], ["failed", "run-1"]);
  assert.match(done.done.note, /changed after triage\.mjs check/);

  // verified, with a locator-drift row marked healable: the fixer is offered triage.json
  const c = await setup();
  perform(c, "playwright-ui", { step: "run-1", agent: "pw-ui-test-runner-triager" }, () => triage(c, "playwright-ui", true, { cls: "locator-drift" }));
  assert.equal(go(c, "playwright-ui").actions[0].step, "heal-1");
  assert.equal(healableRows(path.join(c, RESULTS, "playwright-ui/triage.json")), 1, "only the healable row counts; a flaky row never does");
  assert.equal(healableRows(path.join(c, RESULTS, "playwright-ui/missing.json")), 0);
});

test("heal rounds are bounded by limits.heal_rounds", async () => {
  const { root } = startRun();
  await uiCode(root);
  for (const s of ["scaffold", "pages", "tests"]) step("acme", "playwright-ui", "contacts", s, "done", undefined, { root });
  perform(root, "playwright-ui", { step: "review-1", agent: "pw-ui-reviewer" }, () => verdict(root, "pass"));
  for (const n of [1, 2, 3]) {
    perform(root, "playwright-ui", { step: `run-${n}`, agent: "pw-ui-test-runner-triager" }, () => triage(root, "playwright-ui", true));
    perform(root, "playwright-ui", { step: `heal-${n}`, agent: "pw-ui-fixer" }, () => answer(root, n, "triage"));
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

test("a fixer round is verified by fix.mjs check: a missing report fails the step, a lying one too (G9)", async () => {
  const setup = async () => {
    const r = startRun();
    await uiCode(r.root);
    for (const s of ["scaffold", "pages", "tests"]) step("acme", "playwright-ui", "contacts", s, "done", undefined, { root: r.root });
    return r.root;
  };
  // review round 1 changes-required; the fixer finishes without answering the findings
  let root = await setup();
  perform(root, "playwright-ui", { step: "review-1", agent: "pw-ui-reviewer" }, () => verdict(root, "changes-required"));
  perform(root, "playwright-ui", { step: "fix-1", agent: "pw-ui-fixer" });
  assert.ok(existsSync(path.join(root, RESULTS, "playwright-ui/fix-snapshot.json")), "the orchestration snapshots before it spawns the fixer");
  let done = go(root, "playwright-ui");
  assert.deepEqual([done.done.outcome, done.done.failedStep], ["failed", "fix-1"]);
  assert.match(done.done.note, /fix.mjs check failed: fix-report.json is missing/);

  // claims a fix in a file it never changed
  root = await setup();
  perform(root, "playwright-ui", { step: "review-1", agent: "pw-ui-reviewer" }, () => verdict(root, "changes-required"));
  perform(root, "playwright-ui", { step: "fix-1", agent: "pw-ui-fixer" }, () => answer(root, 1, "review", true));
  done = go(root, "playwright-ui");
  assert.deepEqual([done.done.outcome, done.done.failedStep], ["failed", "fix-1"]);
  assert.match(done.done.note, /did not change this round/);

  // a heal round answers every healable row too
  root = await setup();
  perform(root, "playwright-ui", { step: "review-1", agent: "pw-ui-reviewer" }, () => verdict(root, "pass"));
  perform(root, "playwright-ui", { step: "run-1", agent: "pw-ui-test-runner-triager" }, () => triage(root, "playwright-ui", true));
  perform(root, "playwright-ui", { step: "heal-1", agent: "pw-ui-fixer" });
  done = go(root, "playwright-ui");
  assert.deepEqual([done.done.outcome, done.done.failedStep], ["failed", "heal-1"]);
  assert.match(done.done.note, /fix-report.json is missing/);
});

// ---- G10: worker requests, once-limits, the repo-owner lock, heal gate, summaries, run id ------------------------------
const ask = async (root, domain, from, entry) => {
  const r = await requestsMain(["add", "acme", domain, "contacts", "--from", from, ...Object.entries(entry).flatMap(([k, v]) => [`--${k}`, v])], { root });
  assert.equal(r.code, 0, JSON.stringify(r.out));
  return r.out;
};
const reqs = (root, domain) => JSON.parse(readFileSync(path.join(root, RESULTS, `${domain}/requests.json`), "utf8")).requests;
async function builtUi() {
  const { root } = startRun();
  await uiCases(root);
  await renderFoundation(root, ["repo", "ui"]);
  await performAsync(root, "playwright-ui", { step: "pages", agent: "pw-ui-pom-writer" }, () => scaffoldUiCode(root, { scope: "pages" }));
  await performAsync(root, "playwright-ui", { step: "tests", agent: "pw-ui-tests-writer" }, () => scaffoldUiCode(root));
  return root;
}

test("requests.mjs: stable ids, dedupe whatever the status, kinds per domain, schema-checked file", async () => {
  const { root } = startRun();
  const a = await ask(root, "playwright-ui", "pw-ui-tests-writer", { kind: "missing-method", target: "ContactsPage.openFirst()", summary: "Open the first row", files: "pages/contacts/list.page.ts" });
  assert.match(a.added[0], /^RQ-[0-9a-f]{8}$/);
  const again = await ask(root, "playwright-ui", "pw-ui-reviewer", { kind: "missing-method", target: "contactspage.openfirst()", summary: "open the  first row." });
  assert.deepEqual([again.added, again.duplicates], [[], [{ id: a.added[0], status: "pending" }]], "same kind, target and summary after normalising: the same request");
  const bad = await requestsMain(["add", "acme", "k6", "contacts", "--from", "k6-script-writer", "--kind", "repo-change", "--target", "package.json", "--summary", "x"], { root });
  assert.equal(bad.code, 1);
  assert.match(bad.out.errors[0], /k6 has no handler for kind 'repo-change'/);
  assert.equal((await requestsMain(["add", "acme", "playwright-ui", "contacts", "--from", "w", "--kind", "nope", "--target", "t", "--summary", "s"], { root })).code, 1);
  assert.deepEqual((await requestsMain(["check", "acme", "playwright-ui", "contacts"], { root })).out.problems, []);
  assert.equal((await requestsMain(["list", "acme", "playwright-ui", "contacts"], { root })).out.requests.length, 1);
  // --file of a non-JSON file is refused without echoing any of its content (D6)
  put(root, "notes.env", "DB_PASSWORD=hunter2-secret\n");
  const leak = await requestsMain(["add", "acme", "playwright-ui", "contacts", "--from", "pw-ui-tests-writer", "--file", "notes.env"], { root });
  assert.equal(leak.code, 1);
  assert.deepEqual(leak.out.errors, ["--file: not valid JSON"]);
  assert.ok(!JSON.stringify(leak.out).includes("DB_PASS"));
});

test("a build worker's missing-method request: handler step, then the worker once more; duplicates and over-limit requests are not re-queued, also after a resume", async () => {
  const root = await builtUi();
  const { added } = await ask(root, "playwright-ui", "pw-ui-tests-writer", { kind: "missing-method", target: "ContactsPage.openFirst()", summary: "Open the first row" });
  const h = perform(root, "playwright-ui", { step: "req-1", agent: "pw-ui-pom-writer" });
  assert.equal(h.prompt, `product=acme module=contacts requests=${RESULTS}/playwright-ui/requests.json ids=${added[0]}`);
  const redo = perform(root, "playwright-ui", { step: "redo-tests", agent: "pw-ui-tests-writer" });
  assert.equal(redo.prompt, `product=acme module=contacts requests=${RESULTS}/playwright-ui/requests.json resolved=${added[0]}`);
  assert.deepEqual([reqs(root, "playwright-ui")[0].status, reqs(root, "playwright-ui")[0].step], ["handled", "req-1"]);
  // the same request again (any worker): a duplicate, nothing queued; the flow moves on to the review
  const dup = await ask(root, "playwright-ui", "pw-ui-fixer", { kind: "missing-method", target: "ContactsPage.openFirst()", summary: "Open the first row" });
  assert.deepEqual(dup.duplicates, [{ id: added[0], status: "handled" }]);
  assert.equal(go(root, "playwright-ui").actions[0].step, "review-1");

  // a foundation gap gets one round per build: the first runs, the second (a different gap) is declined with the reason
  await ask(root, "playwright-ui", "pw-ui-tests-writer", { kind: "foundation-gap", target: "config/ui/settings.ts", summary: "No loading indicator configured" });
  const g = perform(root, "playwright-ui", { step: "req-2", agent: "pw-ui-scaffolder" });
  assert.match(g.prompt, /ids=RQ-/);
  const second = await ask(root, "playwright-ui", "pw-ui-tests-writer", { kind: "foundation-gap", target: "config/ui/settings.ts", summary: "Cookie banner is not dismissed" });
  // the counters live in the orchestration state: a fresh read (a resumed session) sees the round spent
  assert.equal(show("acme", "playwright-ui", "contacts", { root }).req.rounds["foundation-gap"], 1);
  assert.equal(go(root, "playwright-ui").actions[0].step, "review-1", "the second gap is not offered");
  const declined = reqs(root, "playwright-ui").find((r) => r.id === second.added[0]);
  assert.equal(declined.status, "declined");
  assert.match(declined.note, /limit: 1 foundation-gap round\(s\) already spent in this run/);
  step("acme", "playwright-ui", "contacts", "review-1", "start", undefined, { root });
  step("acme", "playwright-ui", "contacts", "review-1", "fail", "stop here", { root });
  const done = go(root, "playwright-ui");
  assert.equal(done.done.outcome, "failed");
  assert.deepEqual([done.done.requests.total, done.done.requests.handled, done.done.requests.declined], [3, 2, 1]);
  assert.equal(done.done.requests.open[0].id, second.added[0]);
});

test("a request handler that fails declines its requests with the reason; the domain goes on", async () => {
  const root = await builtUi();
  await ask(root, "playwright-ui", "pw-ui-tests-writer", { kind: "missing-method", target: "ContactsPage.openFirst()", summary: "Open the first row" });
  const [a] = go(root, "playwright-ui").actions;
  step("acme", "playwright-ui", "contacts", a.step, "start", undefined, { root });
  step("acme", "playwright-ui", "contacts", a.step, "fail", "cannot ground the locator", { root });
  assert.equal(go(root, "playwright-ui").actions[0].step, "review-1", "no re-run of the worker, the loop continues");
  const r = reqs(root, "playwright-ui")[0];
  assert.equal(r.status, "declined");
  assert.match(r.note, /pw-ui-pom-writer did not finish: cannot ground the locator/);
});

test("pw-repo-owner calls are serialized across the UI and API domains by a lock in the product's orchestration state", async () => {
  const { root } = startRun();
  await ask(root, "playwright-ui", "pw-ui-scaffolder", { kind: "repo-change", target: "package.json", summary: "Add dependency x" });
  await ask(root, "playwright-api", "pw-api-scaffolder", { kind: "repo-change", target: "playwright.config.ts", summary: "Add an api project timeout" });
  const ui = go(root, "playwright-ui").actions[0];
  assert.deepEqual([ui.step, ui.agent], ["req-1", "pw-repo-owner"]);
  assert.match(ui.prompt, /^product=acme module=contacts task=change requests=.*playwright-ui\/requests\.json ids=RQ-/);
  step("acme", "playwright-ui", "contacts", "req-1", "start", undefined, { root });
  const api = go(root, "playwright-api");
  assert.deepEqual(api.actions, []);
  assert.deepEqual([api.waiting.on, api.waiting.heldBy, api.waiting.attempt], ["pw-repo-owner", "playwright-ui/contacts", 1]);
  assert.equal(go(root, "playwright-ui").actions[0].step, "req-1", "the holder's interrupted step is offered again");
  step("acme", "playwright-ui", "contacts", "req-1", "done", undefined, { root });
  const next2 = go(root, "playwright-api").actions[0];
  assert.deepEqual([next2.step, next2.agent], ["req-1", "pw-repo-owner"]);
  assert.equal(show("acme", "playwright-api", "contacts", { root }).req.waits, 0, "the wait counter resets once it was served");
  const lock = path.join(root, "artifacts/acme/state/orchestration/_repo-owner-lock.json");
  assert.equal(JSON.parse(readFileSync(lock, "utf8")).holder, "playwright-api/contacts");
  step("acme", "playwright-api", "contacts", "req-1", "start", undefined, { root });
  step("acme", "playwright-api", "contacts", "req-1", "fail", "crashed", { root });
  assert.equal(existsSync(lock), false, "released when the step settled");
});

test("the pw-repo-owner lock is taken when the step is handed out: a second domain waits while the first has not started; a stale offer expires (D2)", async () => {
  const { root } = startRun();
  await ask(root, "playwright-ui", "pw-ui-scaffolder", { kind: "repo-change", target: "package.json", summary: "Add dependency x" });
  await ask(root, "playwright-api", "pw-api-scaffolder", { kind: "repo-change", target: "playwright.config.ts", summary: "Add an api project timeout" });
  const ui = go(root, "playwright-ui").actions[0];
  assert.equal(ui.step, "req-1");
  // the UI step was handed out but never started: the API domain must not get pw-repo-owner too
  const api = go(root, "playwright-api");
  assert.deepEqual(api.actions, []);
  assert.equal(api.waiting.heldBy, "playwright-ui/contacts");
  // the re-offer returns the same step, with no second round spent (D3)
  assert.equal(go(root, "playwright-ui").actions[0].step, "req-1");
  const s = show("acme", "playwright-ui", "contacts", { root }).req;
  assert.deepEqual([s.calls, s.rounds["repo-change"], Object.keys(s.steps)], [1, 1, ["req-1"]]);
  // a handed-out step that never started expires: the other domain takes the lock after the TTL
  const lockFile = path.join(root, "artifacts/acme/state/orchestration/_repo-owner-lock.json");
  const l = JSON.parse(readFileSync(lockFile, "utf8"));
  writeFileSync(lockFile, JSON.stringify({ ...l, at: new Date(Date.now() - 11 * 60 * 1000).toISOString() }));
  const took = go(root, "playwright-api").actions[0];
  assert.deepEqual([took.step, took.agent], ["req-1", "pw-repo-owner"]);
  assert.equal(JSON.parse(readFileSync(lockFile, "utf8")).holder, "playwright-api/contacts");
});

test("a requested step handed out but never started does not spend its kind's once-limit; the resumed session is offered the same step (D3)", async () => {
  const root = await builtUi();
  await ask(root, "playwright-ui", "pw-ui-tests-writer", { kind: "foundation-gap", target: "config/ui/settings.ts", summary: "No loading indicator configured" });
  const first = go(root, "playwright-ui").actions[0];
  assert.equal(first.agent, "pw-ui-scaffolder");
  // the session dies before `step start`; the resumed one is offered the same step, the request is not declined
  const again = go(root, "playwright-ui").actions[0];
  assert.deepEqual([again.step, again.prompt], [first.step, first.prompt]);
  assert.equal(reqs(root, "playwright-ui")[0].status, "pending");
  assert.equal(show("acme", "playwright-ui", "contacts", { root }).req.rounds["foundation-gap"], 1);
});

test("a domain that waits too long for pw-repo-owner declines the request instead of looping forever (D-011)", async () => {
  const { root } = startRun();
  await ask(root, "playwright-ui", "pw-ui-scaffolder", { kind: "repo-change", target: "package.json", summary: "Add dependency x" });
  await ask(root, "playwright-api", "pw-api-scaffolder", { kind: "repo-change", target: "playwright.config.ts", summary: "Add timeout" });
  go(root, "playwright-ui");
  step("acme", "playwright-ui", "contacts", "req-1", "start", undefined, { root });
  for (let i = 1; i <= 20; i++) assert.equal(go(root, "playwright-api").waiting.attempt, i);
  const r = go(root, "playwright-api");
  assert.equal(r.waiting, undefined);
  assert.equal(r.actions[0].step, "discover", "declined; the domain's own flow goes on");
  assert.match(reqs(root, "playwright-api")[0].note, /pw-repo-owner stayed busy with playwright-ui\/contacts for 20 asks/);
});

test("a heal fix passes the gate (after at most one gate fix) before the runner starts again (G10)", async () => {
  const setup = async () => {
    const r = startRun();
    await uiCode(r.root);
    for (const s of ["scaffold", "pages", "tests"]) step("acme", "playwright-ui", "contacts", s, "done", undefined, { root: r.root });
    perform(r.root, "playwright-ui", { step: "review-1", agent: "pw-ui-reviewer" }, () => verdict(r.root, "pass"));
    perform(r.root, "playwright-ui", { step: "run-1", agent: "pw-ui-test-runner-triager" }, () => triage(r.root, "playwright-ui", true));
    return r.root;
  };
  // the heal fix breaks a gate rule: the gate's findings go back to the fixer, then the runner may start
  let root = await setup();
  perform(root, "playwright-ui", { step: "heal-1", agent: "pw-ui-fixer" }, () => { editSpec(root, "await page.goto('/');", "await page.waitForTimeout(9);"); answer(root, 1, "triage", true); });
  const gf = perform(root, "playwright-ui", { step: "heal-1-gate-fix", agent: "pw-ui-fixer" }, () => { editSpec(root, "await page.waitForTimeout(9);", "await page.goto('/#top');"); answer(root, 1, "triage", true); });
  assert.equal(gf.prompt, `product=acme module=contacts findings=${RESULTS}/playwright-ui/gate-findings.md triage=${RESULTS}/playwright-ui/triage.json round=1`);
  assert.equal(show("acme", "playwright-ui", "contacts", { root }).steps["gate-heal-1"].note, "changes-required");
  assert.equal(go(root, "playwright-ui").actions[0].step, "run-2", "the second gate passes: the runner starts");
  assert.equal(show("acme", "playwright-ui", "contacts", { root }).steps["gate-heal-1-2"].note, "pass");

  // a heal fix that passes the gate goes straight to the runner
  root = await setup();
  perform(root, "playwright-ui", { step: "heal-1", agent: "pw-ui-fixer" }, () => answer(root, 1, "triage"));
  assert.equal(go(root, "playwright-ui").actions[0].step, "run-2");
  assert.equal(show("acme", "playwright-ui", "contacts", { root }).steps["gate-heal-1"].note, "pass");

  // still failing after the gate fix: the domain fails with the findings in the note
  root = await setup();
  perform(root, "playwright-ui", { step: "heal-1", agent: "pw-ui-fixer" }, () => { editSpec(root, "await page.goto('/');", "await page.waitForTimeout(9);"); answer(root, 1, "triage", true); });
  perform(root, "playwright-ui", { step: "heal-1-gate-fix", agent: "pw-ui-fixer" }, () => { editSpec(root, "await page.waitForTimeout(9);", "await page.waitForTimeout(8);"); answer(root, 1, "triage", true); });
  const done = go(root, "playwright-ui");
  assert.deepEqual([done.done.outcome, done.done.failedStep], ["failed", "gate-heal-1-2"]);
  assert.match(done.done.note, /the gate still fails after the heal fix of round 1 and its gate fix/);
});

test("automationSummary: totals, product bugs, failures by class, healed rows, from files only", async () => {
  const { automationSummary } = await import("./lib/domain-flows.mjs");
  const { root } = startRun();
  const p = paths("acme", root);
  const c = { productDir: p.productDir, module: "contacts", run: { runId: "acme-run-1" } };
  put(root, `${RESULTS}/playwright-api/results.json`, JSON.stringify({ status: "ran", totals: { total: 5, passed: 3, failed: 1, flaky: 1, skipped: 0 } }));
  put(root, `${RESULTS}/playwright-api/triage.json`, JSON.stringify({ rows: [
    { key: "api:API-contacts-1", title: "a", scenarioId: "API-contacts-1", class: "product-bug", healable: false, cluster: "BUG-1" },
    { key: "api:API-contacts-2", title: "b", class: "flaky", healable: false },
    { key: "api:API-contacts-4", title: "d", class: "test-bug", healable: true },
  ] }));
  const s = automationSummary(c, { triageDomain: "api" }, null, { healKeys: ["api:API-contacts-3", "api:API-contacts-4"], rounds: { heal: 1 } });
  assert.deepEqual(s.results, { status: "ran", total: 5, passed: 3, failed: 1, flaky: 1, skipped: 0 });
  assert.deepEqual(s.productBugs, [{ key: "api:API-contacts-1", id: "API-contacts-1", title: "a", cluster: "BUG-1" }]);
  assert.deepEqual(s.failuresByClass, { "product-bug": 1, flaky: 1, "test-bug": 1 });
  assert.deepEqual([s.healRounds, s.healed, s.healableLeft], [1, 1, 1]);
});

test("k6: a workload built from an older run is refused by the flow even with a current stamp (G10, D-6 of G7)", () => {
  const { root } = startRun();
  put(root, "artifacts/acme/modules/contacts/k6/workload.json", JSON.stringify({ runId: "acme-run-0", scenarios: [] }));
  put(root, "artifacts/acme/modules/contacts/k6/workload-coverage.json", JSON.stringify({ verified: {} }));
  perform(root, "k6", { step: "workload", agent: "k6-workload-designer" });
  const done = go(root, "k6");
  assert.deepEqual([done.done.outcome, done.done.failedStep], ["failed", "workload"]);
  assert.match(done.done.note, /workload\.json was built from run acme-run-0, not acme-run-1, the active run/);
});
