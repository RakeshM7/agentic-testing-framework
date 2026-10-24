// scripts/triage.mjs, scripts/lib/triage.mjs and the id parsing of scripts/results.mjs (G8).
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fromK6, fromPlaywright, idsFromTitle } from "./results.mjs";
import { main } from "./triage.mjs";
import { erase, signatureOf, triagePaths, triageUnverified } from "./lib/triage.mjs";
import { put, startRun } from "./test-helpers.mjs";

const A = "artifacts/acme";
const M = `${A}/modules/contacts`;
const RES = (fw) => `${A}/results/acme-run-1/contacts/${fw}`;

// ---------- results.mjs ids ----------
const pwReport = (specs) => ({ stats: { duration: 10 }, suites: [{ title: "ui/contacts/cases.spec.ts", file: "ui/contacts/cases.spec.ts", suites: [{ title: "Contacts", specs }], specs: [] }] });
const spec = (title, tests) => ({ title, file: "ui/contacts/cases.spec.ts", tests });
const run = (status, extra = {}) => ({ status, duration: 5, retry: 0, ...extra });
const err = (message, extra = {}) => ({ message, stack: `Error: ${message}\n    at /w/pages/contacts/list.page.ts:10:5\n    at /w/tests/ui/contacts/cases.spec.ts:20:3`, ...extra });

test("idsFromTitle: anchored and exact, per side", () => {
  assert.deepEqual(idsFromTitle("TC-contacts-3 Create @p1 @functional", "contacts", "ui"), { tcId: "TC-contacts-3" });
  assert.deepEqual(idsFromTitle("see TC-contacts-3", "contacts", "ui"), {});
  assert.deepEqual(idsFromTitle("TC-contacts-30x", "contacts", "ui"), {});
  assert.deepEqual(idsFromTitle("TC-other-3 x", "contacts", "ui"), {});
  assert.deepEqual(idsFromTitle("API-contacts-5 GET /x @p2 @TC-contacts-1 @TC-contacts-1 @TC-contacts-2", "contacts", "api"), { scenarioId: "API-contacts-5", tcIds: ["TC-contacts-1", "TC-contacts-2"] });
  assert.deepEqual(idsFromTitle("XAPI-contacts-5 lookalike", "contacts", "api"), { tcIds: [] });
});

test("fromPlaywright: ids, retries, evidence, project and the smoke flag", () => {
  const r = fromPlaywright(pwReport([
    spec("TC-contacts-1 ok @p1", [{ status: "expected", projectName: "ui", results: [run("passed")] }]),
    spec("TC-contacts-2 flaky @p1", [{ status: "flaky", projectName: "ui", results: [run("failed", { error: err("boom") }), run("passed", { retry: 1 })] }]),
    spec("TC-contacts-3 bad @p1", [{ status: "unexpected", projectName: "ui", results: [run("failed", { error: err("first") }), run("failed", { retry: 1, error: err("last"), attachments: [{ name: "trace", path: "C:\\w\\test-results\\ui\\t\\trace.zip" }] })] }]),
    spec("locators resolve @locators-smoke", [{ status: "skipped", projectName: "ui", annotations: [{ type: "skip", description: "nothing to check" }], results: [run("skipped")] }]),
  ]), { module: "contacts", side: "ui" });
  const [ok, flaky, bad, smoke] = r.items;
  assert.equal(ok.tcId, "TC-contacts-1");
  assert.deepEqual([flaky.status, flaky.passedOnRetry, flaky.attempts, flaky.error], ["flaky", true, 2, "boom"]);
  assert.deepEqual([bad.attempts, bad.passedOnRetry, bad.error, bad.project], [2, false, "last", "ui"]);
  assert.deepEqual(bad.attachments, [{ name: "trace", path: "C:/w/test-results/ui/t/trace.zip" }]);
  assert.equal(bad.frames[0], "/w/pages/contacts/list.page.ts:10");
  assert.deepEqual([smoke.smoke, smoke.skipReason, smoke.tcId], [true, "nothing to check", undefined]);
  assert.equal(r.totals.flaky, 1);
});

test("fromK6: the K6 id, and a .retry summary is the second attempt", () => {
  const sum = (ok) => ({ state: { testRunDurationMs: 1000 }, metrics: { "http_req_duration{endpoint:EP-contacts-1}": { thresholds: { "p(95)<800": { ok } } } } });
  const ids = { "contacts-smoke-1": "K6-contacts-1", "contacts-smoke-2": "K6-contacts-2", "contacts-smoke-3": "K6-contacts-3" };
  const r = fromK6([
    { name: "contacts-smoke-1", data: sum(true) },
    { name: "contacts-smoke-2", data: sum(false) }, { name: "contacts-smoke-2.retry", data: sum(true) },
    { name: "contacts-smoke-3", data: sum(false) }, { name: "contacts-smoke-3.retry", data: sum(false) },
  ], { ids });
  assert.deepEqual(r.items.map((i) => [i.k6Id, i.status, i.attempts, i.passedOnRetry]), [["K6-contacts-1", "passed", 1, false], ["K6-contacts-2", "flaky", 2, true], ["K6-contacts-3", "failed", 2, false]]);
});

// ---------- the signature ----------
test("signatureOf: error class | message with ids and numbers erased | frame | step, in one function", () => {
  const e = (n) => `Error: EP-contacts-${n} returned ${400 + n} for 7f3e9a1b-1111-2222-3333-444455556666 at 2026-10-19\n\nexpect(received).toBe(expected)`;
  const a = signatureOf({ kind: "pw", error: e(1), frames: ["/w/helpers/api/x.ts:10", "/w/tests/api/contacts/a.spec.ts:5"], step: "EP-contacts-1" });
  const b = signatureOf({ kind: "pw", error: e(2), frames: ["/w/helpers/api/x.ts:99", "/w/tests/api/contacts/a.spec.ts:9"], step: "EP-contacts-2" });
  assert.equal(a, b, "ids, numbers and line numbers do not split a cluster");
  assert.equal(a, "expect.toBe | <id> returned <n> for <uuid> at <n>-<n>-<n> | helpers/api/x.ts | <id>");
  assert.notEqual(a, signatureOf({ kind: "pw", error: e(1), frames: ["/w/helpers/api/y.ts:10"], step: "EP-contacts-1" }), "another frame is another cluster");
  assert.equal(signatureOf({ kind: "pw", error: "TimeoutError: locator.click: Timeout 5000ms exceeded.\nCall log:\n  - waiting for getByRole('button', { name: 'Save' })", frames: ["/w/tests/ui/contacts/cases.spec.ts:3"], step: "getByRole('button', { name: 'Save' })" }),
    "TimeoutError | locator.click: Timeout <n>ms exceeded. | tests/ui/contacts/cases.spec.ts | getByRole('button', { name: 'Save' })");
  assert.equal(signatureOf({ kind: "k6", error: "http_req_duration{endpoint:EP-contacts-1} p(95)<800", step: "m" }), "k6-threshold | http_req_duration{endpoint:<id>} p(<n>)<<n> |  | m");
  assert.equal(signatureOf({ kind: "pw", error: "  \n" }), null);
  assert.equal(erase("abcdef0123456789 and 12.5"), "<hex> and <n>");
});

// ---------- fixtures ----------
const caseRow = (n, extra = {}) => ({ id: `TC-contacts-${n}`, title: `case ${n}`, type: "functional", priority: "p1", mutates: false, api: false, hash: `h${n}`, ...extra });
function setup({ mode = "readonly", cases = [caseRow(1), caseRow(2), caseRow(3)], approved = [1, 2, 3], plan, workload, known, items = [], domain = "ui", status = "ran" } = {}) {
  const { root } = startRun({ mode });
  put(root, `${M}/testcases/coverage.json`, JSON.stringify({ cases }));
  put(root, `${M}/testcases/approvals.json`, JSON.stringify({ module: "contacts", cases: Object.fromEntries(approved.map((n) => [`TC-contacts-${n}`, { hash: `h${n}`, decision: "yes" }])) }));
  if (plan) put(root, `${M}/api/plan.json`, JSON.stringify(plan));
  if (workload) put(root, `${M}/k6/workload.json`, JSON.stringify({ module: "contacts", runId: "acme-run-1", mode, types: [], notes: [], scenarios: workload }));
  if (known) put(root, `${A}/known-issues.json`, JSON.stringify({ issues: known }));
  const fw = { ui: "playwright-ui", api: "playwright-api", k6: "k6" }[domain];
  const totals = { total: items.length, passed: 0, failed: 0, flaky: 0, skipped: 0 };
  const writeResults = (its, st = status) => put(root, `${RES(fw)}/results.json`, JSON.stringify({ framework: fw, module: "contacts", runId: "acme-run-1", mode, recordedAt: "2026-10-19T00:00:00Z", status: st, totals, durationMs: 0, items: its }));
  writeResults(items);
  const tp = triagePaths(path.join(root, A), "contacts", "acme-run-1", domain);
  const cli = (cmd, ...rest) => main([cmd, "acme", "contacts", "--domain", domain, ...rest], { root });
  const json = (f) => JSON.parse(readFileSync(path.join(root, f), "utf8"));
  const triage = () => JSON.parse(readFileSync(tp.triage, "utf8"));
  const row = (key) => triage().rows.find((r) => r.key === key);
  const overlay = (o) => put(root, path.relative(root, tp.overlay), JSON.stringify(o));
  return { root, tp, cli, json, triage, row, overlay, writeResults };
}
const item = (n, status, extra = {}) => ({ title: `Contacts > TC-contacts-${n} case ${n} @p1 @functional`, tcId: `TC-contacts-${n}`, status, attempts: status === "failed" ? 3 : 1, passedOnRetry: false, project: "ui", ...extra });
const ASSERT_ERR = "Error: expect(received).toBe(expected)\n\nExpected: 200\nReceived: 500";

// ---------- the rules ----------
test("rules: pass-on-retry is flaky, never a product bug; an override to product-bug is refused", async () => {
  const s = setup({ items: [item(1, "flaky", { passedOnRetry: true, attempts: 2, error: ASSERT_ERR })] });
  assert.equal((await s.cli("build")).code, 0);
  assert.deepEqual([s.row("ui:TC-contacts-1").class, s.row("ui:TC-contacts-1").rule, s.row("ui:TC-contacts-1").healable], ["flaky", "pass-on-retry", false]);
  s.overlay({ rows: [{ key: "ui:TC-contacts-1", class: "product-bug", reason: "r", cite: "testcase:TC-contacts-1", expectation: "testcase:TC-contacts-1" }] });
  const b = await s.cli("build");
  assert.match(b.out.overlayProblems.join("\n"), /never a product bug/);
});

test("rules: environment (refused, DNS, 5xx from the auth setup, missing env, missing session, every k6 request failed)", async () => {
  const errs = ["Error: connect ECONNREFUSED 127.0.0.1:443", "net::ERR_NAME_NOT_RESOLVED at https://x", "getaddrinfo ENOTFOUND app.acme.test", "Error: BASE_URL is not set", "Error: storage state .auth/ui.json not found"];
  const s = setup({ cases: errs.map((_, i) => caseRow(i + 1)), approved: [1, 2, 3, 4, 5], items: errs.map((e, i) => item(i + 1, "failed", { error: e })).concat([{ ...item(6, "failed", { error: "Error: login: status 503", project: "setup-ui" }), tcId: undefined, title: "authenticate" }]) });
  await s.cli("build");
  for (let i = 1; i <= 5; i++) assert.equal(s.row(`ui:TC-contacts-${i}`).class, "environment", errs[i - 1]);
  assert.equal(s.triage().rows.find((r) => r.title === "authenticate").class, "environment");
  // a 5xx on a normal test is NOT environment by rule (a candidate for the agent)
  const t = setup({ items: [item(1, "failed", { error: ASSERT_ERR })] });
  await t.cli("build");
  assert.equal(t.row("ui:TC-contacts-1").class, null);
  // k6: every request failed
  const k = setup({ domain: "k6", workload: [{ id: "K6-contacts-1", name: "smoke-1", thresholds: [] }], items: [{ title: "contacts-smoke-1", k6Id: "K6-contacts-1", status: "failed", httpFailRate: 1, attempts: 2, passedOnRetry: false, error: "http_req_failed{endpoint:EP-contacts-1} rate<0.05", thresholds: [{ metric: "http_req_failed{endpoint:EP-contacts-1}", expr: "rate<0.05", ok: false }] }] });
  await k.cli("build");
  assert.equal(k.row("k6:K6-contacts-1").class, "environment");
});

test("rules: locator-drift from the smoke count 0 or a page-object locator timeout (healable); other UI failures stay open", async () => {
  const smoke = { title: "list locators resolve @locators-smoke", status: "failed", smoke: true, attempts: 3, project: "ui", error: "Error: contacts.addButton: expect(locator).not.toHaveCount(expected)\n\nExpected: not 0\nReceived: 0" };
  const timeout = item(1, "failed", { error: "TimeoutError: locator.click: Timeout 5000ms exceeded.\nCall log:\n  - waiting for getByRole('button', { name: 'Save' })" });
  const s = setup({ cases: [caseRow(1), caseRow(2)], approved: [1, 2], items: [smoke, timeout, item(2, "failed", { error: ASSERT_ERR })] });
  await s.cli("build");
  const t = s.triage();
  assert.deepEqual(t.rows.map((r) => [r.class, r.healable]), [["locator-drift", true], ["locator-drift", true], [null, false]]);
  assert.ok(t.rows[0].fixHint);
});

test("rules: the UI ledger guard's refusal is a healable test-bug, never the product's (D-074); results prefer that error", async () => {
  const guard = "Error: Delete blocked by the ledger guard (D-005): DELETE /api/contacts/7 names no entity this run created. Record the product's own id as the ref with recordCreated, and delete only what owns() confirms.";
  const s = setup({ mode: "full-run", items: [item(1, "failed", { error: guard }), item(2, "failed", { error: ASSERT_ERR })] });
  await s.cli("build");
  const t = s.triage();
  const row = (id) => t.rows.find((r) => r.key === `ui:${id}`);
  assert.deepEqual([row("TC-contacts-1").class, row("TC-contacts-1").rule, row("TC-contacts-1").healable], ["test-bug", "ledger-guard", true]);
  assert.equal(row("TC-contacts-2").class, null, "any other failure stays open for the triager");
  assert.match(row("TC-contacts-1").fixHint, /id the product uses as its ref/);
  // the guard fails the test when it ends, after the step that broke because of it: the report's errors[] holds both
  const r = fromPlaywright(pwReport([spec("TC-contacts-1 del @p1", [{ status: "unexpected", projectName: "ui", results: [run("failed", { error: err("Timeout 5000ms exceeded"), errors: [err("Timeout 5000ms exceeded"), err(guard.replace(/^Error: /, ""))] })] }])]), { module: "contacts", side: "ui" });
  assert.match(r.items[0].error, /^Delete blocked by the ledger guard/);
});

test("rules: api class-only expectation inside the class is not a failure, outside it a candidate product-bug", async () => {
  const sc = (n, expect) => ({ id: `API-contacts-${n}`, endpoint: "EP-contacts-1", mutates: false, title: `s${n}`, expect });
  const it = (n, status) => ({ title: `API-contacts-${n} s`, scenarioId: `API-contacts-${n}`, status: "failed", attempts: 3, passedOnRetry: false, project: "api", error: `Error: status\n\nExpected: >= 200\nReceived: ${status}` });
  const s = setup({ domain: "api", cases: [], approved: [], plan: [sc(1, { statusClass: "2xx", source: "class-only" }), sc(2, { statusClass: "2xx", source: "class-only" })], items: [it(1, 204), it(2, 500)] });
  await s.cli("build");
  const t = s.triage();
  assert.deepEqual(t.notFailures.map((x) => x.key), ["api:API-contacts-1"]);
  assert.deepEqual([t.rows[0].key, t.rows[0].class, t.rows[0].rule, t.rows[0].expectation], ["api:API-contacts-2", "product-bug", "api-class-only", "scenario:API-contacts-2"]);
});

test("rules: blocked-by-mode rows for hidden @mutates tests (readonly), none in full-run; awaiting-approval rows for unapproved cases", async () => {
  const cases = [caseRow(1), caseRow(2, { mutates: true }), caseRow(3), caseRow(4, { api: true })];
  const ro = setup({ cases, approved: [1, 2], items: [item(1, "passed")] });
  await ro.cli("build");
  assert.deepEqual(ro.triage().rows.map((r) => [r.key, r.status, r.class, r.rule]), [["ui:TC-contacts-2", "hidden", "blocked-by-mode", "hidden-mutates"], ["ui:TC-contacts-3", "unapproved", "awaiting-approval", "awaiting-approval"]]);
  const fr = setup({ mode: "full-run", cases, approved: [1, 2], items: [item(1, "passed")] });
  await fr.cli("build");
  assert.deepEqual(fr.triage().rows.map((r) => r.key), ["ui:TC-contacts-2", "ui:TC-contacts-3"].slice(1).concat([]).length ? ["ui:TC-contacts-2", "ui:TC-contacts-3"] : [], "full-run: the mutating test is missing (no result), not blocked");
  assert.equal(fr.row("ui:TC-contacts-2").class, null);
  // an unapproved case that Playwright lists as a skipped fixme
  const sk = setup({ cases, approved: [1], items: [item(3, "skipped", { skipReason: "awaiting approval" })] });
  await sk.cli("build");
  assert.equal(sk.row("ui:TC-contacts-3").class, "awaiting-approval");
  // the api domain: hidden @mutates scenarios, and unapproved @api cases
  const api = setup({ domain: "api", cases, approved: [], plan: [{ id: "API-contacts-1", endpoint: "EP-contacts-1", mutates: true, title: "post", expect: { status: 201 } }], items: [] });
  await api.cli("build");
  assert.deepEqual(api.triage().rows.map((r) => [r.key, r.class]), [["api:TC-contacts-4", "awaiting-approval"], ["api:API-contacts-1", "blocked-by-mode"]]);
  // k6 in readonly: not-run -> every workload scenario blocked-by-mode
  const k6 = setup({ domain: "k6", status: "not-run", workload: [{ id: "K6-contacts-1", name: "smoke-1", thresholds: [] }] });
  await k6.cli("build");
  assert.deepEqual(k6.triage().rows.map((r) => [r.key, r.class, r.rule]), [["k6:K6-contacts-1", "blocked-by-mode", "readonly-not-run"]]);
});

test("rules: a failed auth setup makes the tests that never ran environment rows", async () => {
  const s = setup({ items: [{ title: "authenticate", status: "failed", project: "setup-ui", attempts: 3, error: "Error: login failed: status 502" }] });
  await s.cli("build");
  assert.deepEqual(s.triage().rows.filter((r) => r.status === "missing").map((r) => [r.class, r.rule]), [["environment", "setup-failed"], ["environment", "setup-failed"], ["environment", "setup-failed"]]);
  const t = setup({ items: [] });
  await t.cli("build");
  assert.deepEqual(t.triage().rows.map((r) => r.class), [null, null, null]);
});

test("rules: known-issue by exact signature, scoped to its module", async () => {
  const f = setup({ items: [item(1, "failed", { error: ASSERT_ERR, frames: ["/w/pages/contacts/list.page.ts:3"] })] });
  await f.cli("build");
  const sig = f.row("ui:TC-contacts-1").signature;
  const s = setup({ items: [item(1, "failed", { error: ASSERT_ERR, frames: ["/w/pages/contacts/list.page.ts:3"] }), item(2, "failed", { error: ASSERT_ERR, frames: ["/w/pages/contacts/list.page.ts:3"] })], known: [{ id: "KI-1", signature: sig, title: "500 on save", reference: "JIRA-1" }] });
  await s.cli("build");
  assert.deepEqual([s.row("ui:TC-contacts-1").class, s.row("ui:TC-contacts-1").knownIssue], ["known-issue", "KI-1"]);
  const near = setup({ items: [item(1, "failed", { error: ASSERT_ERR, frames: ["/w/pages/contacts/list.page.ts:3"] })], known: [{ id: "KI-1", signature: sig + " ", title: "t", reference: "r" }, { id: "KI-2", module: "deals", signature: sig, title: "t", reference: "r" }] });
  await near.cli("build");
  assert.equal(near.row("ui:TC-contacts-1").class, null, "not by substring, not for another module");
  const bad = setup({ items: [], known: [{ id: "KI-1" }] });
  assert.equal((await bad.cli("build")).code, 1);
});

// ---------- clusters ----------
test("clusters by signature, with BUG ids stable across builds", async () => {
  const e = (n) => `Error: EP-contacts-${n} returned ${500 + n}`;
  const mk = (n, error, frames) => item(n, "failed", { error, frames });
  const s = setup({ cases: [caseRow(1), caseRow(2), caseRow(3)], items: [mk(1, e(1), ["/w/helpers/a.ts:1"]), mk(2, e(2), ["/w/helpers/a.ts:9"]), mk(3, "Error: other", ["/w/helpers/b.ts:1"])] });
  await s.cli("build");
  const first = s.triage().clusters;
  assert.deepEqual(first.map((c) => [c.id, c.rows.length]), [["BUG-contacts-1", 2], ["BUG-contacts-2", 1]]);
  assert.equal(s.row("ui:TC-contacts-1").cluster, "BUG-contacts-1");
  // TC-1 stops failing, a new signature appears: the old ids stay, the new one is next
  s.writeResults([mk(2, e(2), ["/w/helpers/a.ts:9"]), mk(3, "Error: new", ["/w/helpers/c.ts:1"])]);
  await s.cli("build");
  assert.deepEqual(s.triage().clusters.map((c) => [c.id, c.ids]), [["BUG-contacts-1", ["TC-contacts-2"]], ["BUG-contacts-3", ["TC-contacts-3"]]]);
  const reg = s.json(`${M}/triage/triage-registry.json`);
  assert.equal(reg.clusters["ui|Error | other | helpers/b.ts | "].status, "gone");
});

// ---------- the overlay and check ----------
function failing() {
  const s = setup({ cases: [caseRow(1), caseRow(2)], approved: [1, 2], items: [item(1, "failed", { error: ASSERT_ERR, frames: ["/w/helpers/a.ts:1"], attachments: [{ name: "trace", path: "x" }] }), item(2, "failed", { error: ASSERT_ERR, frames: ["/w/helpers/a.ts:5"] })] });
  put(s.root, "playwright-tests/acme/test-results/ui/t/trace.zip", "zip");
  put(s.root, `${A}/knowledge/modules/contacts/notes.md`, "# Notes\nSaving a contact returns the contact.\n");
  return s;
}
const ROW1 = { key: "ui:TC-contacts-1", class: "product-bug", reason: "save returns 500", evidence: ["playwright-tests/acme/test-results/ui/t/trace.zip"], expectation: "testcase:TC-contacts-1" };
const ROW2 = { key: "ui:TC-contacts-2", class: "test-bug", reason: "wrong wait", healable: true, fixHint: "wait for the dialog" };
const BUG = (over = {}) => ({ cluster: "BUG-contacts-1", title: "Save fails with 500", steps: ["open Contacts", "save"], expected: { text: "the contact is saved", source: "testcase:TC-contacts-1" }, actual: { quote: "Received: 500" }, evidence: ["playwright-tests/acme/test-results/ui/t/trace.zip"], affected: ["TC-contacts-1"], severity: "major", ...over });

test("check: unclassified rows, then a verified stamp once classified; stale after a results change", async () => {
  const s = failing();
  await s.cli("build");
  const r = await s.cli("check");
  assert.equal(r.code, 1);
  assert.equal(r.out.problems.filter((p) => /unclassified/.test(p)).length, 2);
  assert.equal(triageUnverified(s.tp), "the triage did not pass triage.mjs check");
  s.overlay({ rows: [ROW1, ROW2], bugs: [BUG()] });
  await s.cli("build");
  const ok = await s.cli("check");
  assert.deepEqual(ok.out, { valid: true, problems: [] });
  assert.equal(triageUnverified(s.tp), null);
  // a results change after the build
  s.writeResults([item(1, "failed", { error: "Error: other" })]);
  assert.match((await s.cli("check")).out.problems[0], /^stale: results\.json changed after triage\.mjs build/);
  assert.match(triageUnverified(s.tp), /changed after triage\.mjs check/);
});

test("check: an edited triage.json is not trusted", async () => {
  const s = failing();
  s.overlay({ rows: [ROW1, ROW2], bugs: [BUG()] });
  await s.cli("build");
  const t = s.triage();
  t.rows[1].class = "flaky";
  put(s.root, path.relative(s.root, s.tp.triage), JSON.stringify(t));
  assert.match((await s.cli("check")).out.problems.join("\n"), /differs from a fresh build/);
});

test("check: a product-bug needs evidence that exists and an expectation that resolves exactly", async () => {
  const run1 = async (row, bug = BUG()) => {
    const s = failing();
    s.overlay({ rows: [row, ROW2], bugs: [bug] });
    await s.cli("build");
    return (await s.cli("check")).out.problems.join("\n");
  };
  assert.match(await run1({ ...ROW1, evidence: [] }), /needs evidence/);
  assert.match(await run1({ ...ROW1, evidence: ["playwright-tests/acme/test-results/ui/missing.zip"] }), /no such file/);
  assert.match(await run1({ ...ROW1, evidence: ["../outside.txt"] }), /must be a file of this product|no such file/);
  assert.match(await run1({ ...ROW1, expectation: undefined }), /no expectation source/);
  assert.match(await run1({ ...ROW1, expectation: "testcase:TC-contacts-9" }), /no such test case/);
  assert.match(await run1({ ...ROW1, expectation: "testcase:TC-contacts" }), /no such test case/, "a prefix is not the id");
  assert.match(await run1({ ...ROW1, expectation: "knowledge:modules/contacts/nothing.md" }), /no such file under knowledge/);
  assert.equal(await run1({ ...ROW1, expectation: "knowledge:modules/contacts/notes.md" }), "");
  // the attachment of the results counts as evidence
  const s = failing();
  put(s.root, "playwright-tests/acme/test-results/ui/t/trace.zip", "zip");
  s.writeResults([item(1, "failed", { error: ASSERT_ERR, frames: ["/w/helpers/a.ts:1"], attachments: [{ name: "trace", path: path.join(s.root, "playwright-tests/acme/test-results/ui/t/trace.zip") }] }), item(2, "failed", { error: ASSERT_ERR, frames: ["/w/helpers/a.ts:5"] })]);
  s.overlay({ rows: [{ ...ROW1, evidence: [] }, ROW2], bugs: [BUG()] });
  await s.cli("build");
  assert.equal((await s.cli("check")).out.valid, true);
});

test("check: a product-bug cluster needs a bug draft that matches it; drafts are checked", async () => {
  const run1 = async (bugs) => {
    const s = failing();
    s.overlay({ rows: [ROW1, ROW2], ...(bugs ? { bugs } : {}) });
    await s.cli("build");
    return (await s.cli("check")).out.problems.join("\n");
  };
  assert.match(await run1(null), /BUG-contacts-1: a product-bug cluster without a bug draft/);
  assert.match(await run1([BUG({ affected: ["TC-contacts-1", "TC-contacts-2"] })]), /affected must be exactly/);
  assert.match(await run1([BUG({ actual: { quote: "invented text" } })]), /actual\.quote must be quoted/);
  assert.match(await run1([BUG({ evidence: ["playwright-tests/acme/test-results/ui/none.zip"] })]), /no such file/);
  assert.match(await run1([BUG({ expected: { text: "x", source: "clarification:CL-9" } })]), /no such row/);
  assert.match(await run1([BUG(), BUG({ cluster: "BUG-contacts-7" })]), /BUG-contacts-7: a bug draft for no cluster/);
  assert.match(await run1([BUG(), BUG()]), /two bug drafts/);
  assert.equal(await run1([BUG()]), "");
});

test("check: overriding a rule-decided class needs a cited reason; the mode and approval classes cannot be overridden", async () => {
  const mk = () => setup({ cases: [caseRow(1), caseRow(2, { mutates: true }), caseRow(3)], approved: [1, 2], items: [item(1, "failed", { error: "Error: connect ECONNREFUSED 1.2.3.4:80" })] });
  const s = mk();
  s.overlay({ rows: [{ key: "ui:TC-contacts-1", class: "test-bug", reason: "the target was up", healable: false }] });
  assert.match((await s.cli("build")).out.overlayProblems.join("\n"), /needs a cite/);
  const t = mk();
  t.overlay({ rows: [{ key: "ui:TC-contacts-1", class: "test-bug", reason: "the target was up", cite: "testcase:TC-contacts-99", healable: false }] });
  assert.match((await t.cli("build")).out.overlayProblems.join("\n"), /no such test case/);
  const u = mk();
  put(u.root, `${A}/knowledge/modules/contacts/n.md`, "x\n");
  u.overlay({ rows: [{ key: "ui:TC-contacts-1", class: "test-bug", reason: "the target was up", cite: "knowledge:modules/contacts/n.md", healable: false }, { key: "ui:TC-contacts-2", class: "test-bug", reason: "r", cite: "knowledge:modules/contacts/n.md", healable: false }, { key: "ui:TC-contacts-3", class: "test-bug", reason: "r", cite: "knowledge:modules/contacts/n.md", healable: false }] });
  const b = await u.cli("build");
  assert.match(b.out.overlayProblems.join("\n"), /ui:TC-contacts-2: 'blocked-by-mode' is decided by the mode/);
  assert.match(b.out.overlayProblems.join("\n"), /ui:TC-contacts-3: 'awaiting-approval' is decided by the mode or the approval/);
  assert.doesNotMatch(b.out.overlayProblems.join("\n"), /TC-contacts-1:/);
  // the agent cannot decide the script-only classes for an open row
  const v = setup({ items: [item(1, "failed", { error: ASSERT_ERR })] });
  v.overlay({ rows: [{ key: "ui:TC-contacts-1", class: "known-issue", reason: "r" }] });
  assert.match((await v.cli("build")).out.overlayProblems.join("\n"), /decided by the script/);
});

test("check: healable only for test-bug and locator-drift, and with a fix hint; test-bug needs the decision", async () => {
  const s = setup({ items: [item(1, "failed", { error: ASSERT_ERR }), item(2, "failed", { error: "Error: other" }), item(3, "failed", { error: "Error: third" })] });
  s.overlay({ rows: [{ key: "ui:TC-contacts-1", class: "test-bug", reason: "r", healable: true }, { key: "ui:TC-contacts-2", class: "test-bug", reason: "r" }, { key: "ui:TC-contacts-3", class: "environment", reason: "r", healable: true }] });
  await s.cli("build");
  const p = (await s.cli("check")).out.problems.join("\n");
  assert.match(p, /ui:TC-contacts-1: healable without a fix hint/);
  assert.match(p, /ui:TC-contacts-2: a test-bug needs healable true or false/);
  assert.match(p, /ui:TC-contacts-3: healable is only for test-bug and locator-drift/);
});

test("check: schema problems in the overlay stop the build", async () => {
  const s = setup({ items: [item(1, "failed", { error: ASSERT_ERR })] });
  s.overlay({ rows: [{ key: "ui:TC-contacts-1", class: "nonsense", reason: "r" }] });
  const b = await s.cli("build");
  assert.equal(b.code, 1);
  assert.match(b.out.problems[0], /^triage-overlay\.json:/);
  assert.equal(existsSync(s.tp.triage), false);
});

test("a missing results.json stops the build; healableRows reads the healable rows of triage.json (D-058)", async () => {
  const s = setup({ items: [item(1, "failed", { error: "Error: connect ECONNREFUSED 1.1.1.1:1" }), item(2, "failed", { error: "TimeoutError: locator.click: Timeout 5000ms exceeded.\nCall log:\n  - waiting for getByRole('button', { name: 'Save' })" })] });
  await s.cli("build");
  const { healableRows } = await import("./lib/domain-flows.mjs");
  assert.equal(healableRows(s.tp.triage), 1);
  const none = setup({ items: [] });
  none.writeResults([]);
  const { rmSync } = await import("node:fs");
  rmSync(none.tp.results);
  const r = await none.cli("build");
  assert.equal(r.code, 1);
  assert.match(r.out.problems[0], /results\.json is missing/);
});

// ---------- prepare ----------
test("prepare --domain k6 clears the module's stale summaries (and leftovers files), nothing else", async () => {
  const s = setup({ domain: "k6" });
  const dir = "k6-tests/acme/results";
  for (const f of ["contacts-smoke-1.summary.json", "contacts-smoke-1.retry.summary.json", "contacts-smoke-1.created.json", "contacts-smoke-1.untracked.json", "deals-smoke-1.summary.json", "contacts-smoke-1.log"]) put(s.root, `${dir}/${f}`, "{}");
  const r = await s.cli("prepare");
  assert.deepEqual(r.out.removed.sort(), [`${dir}/contacts-smoke-1.created.json`, `${dir}/contacts-smoke-1.retry.summary.json`, `${dir}/contacts-smoke-1.summary.json`, `${dir}/contacts-smoke-1.untracked.json`]);
  assert.ok(existsSync(path.join(s.root, dir, "deals-smoke-1.summary.json")));
  assert.ok(existsSync(path.join(s.root, dir, "contacts-smoke-1.log")));
  const u = setup({ domain: "ui" });
  const tr = "playwright-tests/acme/test-results";
  put(u.root, `${tr}/ui/contacts/t/trace.zip`, "z");
  put(u.root, `${tr}/ui/contacts-report.json`, "{}");
  put(u.root, `${tr}/ui/deals/t/trace.zip`, "z");
  put(u.root, `${tr}/ui/deals-report.json`, "{}");
  put(u.root, `${tr}/api/t/trace.zip`, "z");
  assert.deepEqual((await u.cli("prepare")).out.removed.sort(), [`${tr}/ui/contacts`, `${tr}/ui/contacts-report.json`]);
  for (const f of ["ui/deals/t/trace.zip", "ui/deals-report.json", "api/t/trace.zip"]) assert.ok(existsSync(path.join(u.root, tr, f)), f);
});

// ---------- k6 thresholds ----------
test("k6: a failure against assumed thresholds stays open and is not an SLO expectation; an SLO failure can be cited", async () => {
  const th = [{ metric: "http_req_duration{endpoint:EP-contacts-1}", expr: "p(95)<1000", source: "assumed", assumed: true }, { metric: "http_req_failed{endpoint:EP-contacts-1}", expr: "rate<0.01", source: "slo:module", assumed: false }];
  const k6item = (id, metric, expr) => ({ title: `contacts-smoke-${id}`, k6Id: `K6-contacts-${id}`, status: "failed", attempts: 2, passedOnRetry: false, httpFailRate: 0.2, error: `${metric} ${expr}`, thresholds: [{ metric, expr, ok: false }] });
  const s = setup({ domain: "k6", workload: [{ id: "K6-contacts-1", name: "smoke-1", thresholds: th }, { id: "K6-contacts-2", name: "smoke-2", thresholds: th }], items: [k6item(1, th[0].metric, th[0].expr), k6item(2, th[1].metric, th[1].expr)] });
  put(s.root, "k6-tests/acme/results/contacts-smoke-1.summary.json", "{}");
  await s.cli("build");
  assert.deepEqual(s.triage().rows.map((r) => [r.k6Id, r.class, r.failedThresholds[0].assumed]), [["K6-contacts-1", null, true], ["K6-contacts-2", null, false]]);
  const ev = "k6-tests/acme/results/contacts-smoke-1.summary.json";
  const bug = (id, cluster) => ({ cluster, title: "slow", steps: ["run the smoke"], expected: { text: "p95 under the SLO", source: `scenario:K6-contacts-${id}` }, actual: { quote: "p(95)" }, evidence: [ev], affected: [`K6-contacts-${id}`], severity: "major" });
  s.overlay({ rows: [{ key: "k6:K6-contacts-1", class: "product-bug", reason: "slow", evidence: [ev], expectation: "scenario:K6-contacts-1" }, { key: "k6:K6-contacts-2", class: "product-bug", reason: "errors", evidence: [ev], expectation: "scenario:K6-contacts-2" }], bugs: [bug(1, "BUG-contacts-1"), bug(2, "BUG-contacts-2")] });
  await s.cli("build");
  const p = (await s.cli("check")).out.problems.join("\n");
  assert.match(p, /K6-contacts-1: product-bug expectation: .*assumed or generated, not an SLO/);
  assert.doesNotMatch(p, /K6-contacts-2: product-bug expectation/);
});

test("cli: usage errors and paths", async () => {
  const s = setup({});
  assert.equal((await s.cli("nonsense")).code, 2);
  assert.equal((await main(["build", "acme", "contacts", "--domain", "x"], { root: s.root })).code, 2);
  const p = await s.cli("paths");
  assert.equal(p.out.triage, `${RES("playwright-ui")}/triage.json`);
});
