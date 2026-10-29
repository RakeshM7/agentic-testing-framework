// scripts/report-data.mjs, scripts/report.mjs and scripts/lib/report.mjs (G11): report.json collection per section, the
// two bug fixes, explicit gaps, the cited narrative check, the verified stamp and the deterministic render.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { HEADERS } from "./lib/clarifications.mjs";
import { loadJson, paths, validateData } from "./lib/contract.mjs";
import { serializeCsv } from "./lib/csv.mjs";
import { append } from "./lib/ledger.mjs";
import { numbersOf, renderDeck, reportPaths, reportUnverified, resolveCite } from "./lib/report.mjs";
import { collect } from "./report-data.mjs";
import { main } from "./report.mjs";
import { put, startRun } from "./test-helpers.mjs";

const A = "artifacts/acme";
const RUN = "acme-run-1";
const NOW = new Date("2026-10-19T10:00:00Z");
const json = (root, rel, v) => put(root, rel, JSON.stringify(v, null, 2));
const ledgerItem = (id, status, extra = {}) => ({ id, key: id, technique: "ep", source: "interactions", subject: id, label: id, priority: "p1", status, ...extra });

// A run with data for every section of contacts, and an empty deals.
function fixture() {
  const { root } = startRun();
  const M = `${A}/modules/contacts`;
  json(root, `${M}/explore/sitemap.json`, []); // contacts: an empty sitemap
  json(root, `${A}/modules/deals/explore/sitemap.json`, [{ url: "/deals" }]);
  put(root, `${M}/clarifications.csv`, serializeCsv([HEADERS, ["CQ-contacts-1", "contacts", "Is the phone required?", "1. open", "", "", "[r] unconfirmed (needs-full-run): x\nNext step: run in full-run", RUN], ["CQ-contacts-2", "contacts", "Max name length?", "1. type", "Context: a", "agent-proposed", "", RUN], ["CQ-contacts-3", "contacts", "Sort order?", "1. sort", "Result: asc", "human-approved", "", RUN]]));
  put(root, `${M}/testcases/testcases-summary.md`, "# Summary\n\nTotal test cases: 3\n");
  put(root, `${M}/testcases/approval.csv`, "TC ID\n");
  json(root, `${M}/testcases/coverage.json`, {
    module: "contacts", runId: RUN, format: "gherkin", maxCases: 200, degraded: [], summary: {}, built: {}, problems: [],
    byTechnique: { ep: { total: 3, mapped: 1, excluded: 1, pending: 0, deferred: 1 } },
    items: [ledgerItem("CI-contacts-1", "mapped"), ledgerItem("CI-contacts-2", "excluded", { reason: "not-testable", detail: "no UI" }), ledgerItem("CI-contacts-3", "deferred", { reason: "budget", detail: "over the budget of 1" })],
    cases: [{ id: "TC-contacts-1", key: "k", assumption: true, assumptions: ["phone is optional"], hash: "h1" }, { id: "TC-contacts-2", key: "k2", hash: "h2" }],
  });
  json(root, `${M}/k6/workload.json`, { module: "contacts", scenarios: [{ id: "K6-contacts-1", name: "smoke-1", thresholds: [{ metric: "http_req_duration", endpoint: "EP-contacts-1", stat: "p95", limit: 1000, source: "assumed", assumed: true }, { metric: "http_req_failed", endpoint: "EP-contacts-1", stat: "rate", limit: 0.01, source: "slo", assumed: false }] }] });
  json(root, `${M}/k6/workload-coverage.json`, { loaded: [{ case: "TC-contacts-1", target: "EP-contacts-1", endpoints: ["EP-contacts-1"], type: "smoke", ids: ["K6-contacts-1"] }], excluded: [{ case: "TC-contacts-2", target: "EP-contacts-2", reason: "mutating-readonly", detail: "POST in readonly" }], deferred: [] });
  put(root, "k6-tests/acme/scripts/contacts-smoke-1.js", "// k6");
  put(root, "k6-tests/acme/scripts/contacts-pipeline-smoke-1.js", "// another module's script"); // a module `contacts-pipeline`
  json(root, "k6-tests/acme/results/contacts-smoke-1.untracked.json", [{ type: "contacts", status: 201, count: 2 }]);
  json(root, "k6-tests/acme/results/contacts-smoke-1.retry.untracked.json", [{ type: "contacts", status: 201, count: 1 }]);
  put(root, "playwright-tests/acme/tests/ui/contacts/cases.spec.ts", "// spec");
  json(root, `${A}/knowledge/modules/contacts/rule-facts.json`, { module: "contacts", facts: [{ file: "n.md", line: 3, category: "rules", text: "Email must be unique", citations: [], evidence: "agent-capture" }, { file: "n.md", line: 4, category: "rules", text: "Name is required", citations: [], evidence: "script-fetched" }] });
  json(root, `${A}/modules/contacts/api-code/coverage.json`, { items: [{ id: "EP-contacts-1", kind: "endpoint", label: "x", status: "mapped" }, { id: "API-contacts-1", kind: "scenario", label: "y", status: "deferred", reason: "budget", detail: "over api.plan_budget" }] });
  append(paths("acme", root).ledgerFile, { runId: RUN, event: "created", type: "contact", ref: "c-1", module: "contacts", stage: "k6", agent: "k6-runner-triager" });
  // results and triage
  const RES = (fw) => `${A}/results/${RUN}/contacts/${fw}`;
  json(root, `${RES("playwright-ui")}/results.json`, { framework: "playwright-ui", module: "contacts", runId: RUN, mode: "readonly", status: "ran", totals: { total: 4, passed: 2, failed: 1, flaky: 1, skipped: 0 }, durationMs: 10, items: [] });
  json(root, `${RES("k6")}/results.json`, { framework: "k6", module: "contacts", runId: RUN, mode: "readonly", status: "not-run", reason: "k6 load only runs in full-run", totals: { total: 0, passed: 0, failed: 0, flaky: 0, skipped: 0 }, durationMs: 0, items: [] });
  json(root, `${RES("playwright-ui")}/triage.json`, {
    module: "contacts", domain: "ui", framework: "playwright-ui", runId: RUN, mode: "readonly", inputs: { results: null }, notFailures: [],
    summary: { rows: 2, open: 0, clusters: 1, byClass: { "product-bug": 1, flaky: 1 } },
    rows: [{ key: "ui:TC-contacts-2", class: "product-bug", cluster: "BUG-contacts-1", healable: false }, { key: "ui:TC-contacts-3", class: "flaky", cluster: null, healable: false }],
    clusters: [{ id: "BUG-contacts-1", signature: "sig", rows: ["ui:TC-contacts-2"], ids: ["TC-contacts-2"] }],
  });
  json(root, `${RES("playwright-ui")}/triage-overlay.json`, { bugs: [{ cluster: "BUG-contacts-1", title: "Save loses the phone", steps: ["s"], expected: { text: "e", source: "testcase:TC-contacts-2" }, actual: { quote: "q" }, evidence: [`${A}/results/${RUN}/x.png`], affected: ["TC-contacts-2"], severity: "major" }] });
  // a failed review blocks the dependants
  const pr = paths("acme", root);
  const run = loadJson(pr.runFile);
  run.stages["contacts/testcases"] = { status: "failed", error: "review failed", attempts: 1, reviewFailed: true, findings: [{ severity: "major", location: "a:1", reason: "r" }] };
  writeFileSync(pr.runFile, JSON.stringify(run, null, 2));
  return { root, pr };
}

const validReport = async (root) => {
  const data = await collect("acme", { root, now: NOW });
  assert.deepEqual(await validateData("report", data), []);
  return data;
};

test("collect: every section from fixtures, schema-valid", async () => {
  const { root } = fixture();
  const r = await validReport(root);
  const c = r.modules.find((m) => m.module === "contacts");
  assert.deepEqual([r.schemaVersion, r.generatedAt, r.mode], [1, "2026-10-19T10:00:00.000Z", "readonly"]);
  // modules, test cases, approvals, specs
  assert.deepEqual([c.testcases, c.playwrightUiSpecs, c.playwrightApiSpecs, c.clarifications.total, c.clarifications.answered, c.clarifications.unconfirmed, c.clarifications.awaitingApproval], [3, 1, 0, 3, 2, 1, 1]);
  assert.deepEqual(r.totals.approvals, { approved: 0, rejected: 0, changes: 0, awaiting: 2 });
  // results and triage
  assert.deepEqual([r.totals.execution["playwright-ui"].total, r.totals.execution["playwright-ui"].failed, r.totals.execution.k6.modulesNotRun, r.totals.execution["playwright-api"].modulesNoResults], [4, 1, 1, 2]);
  assert.deepEqual(r.totals.triage.byClass, { "product-bug": 1, flaky: 1 });
  assert.deepEqual(r.bugs.map((b) => [b.id, b.severity, b.title, b.affected, b.draft]), [["BUG-contacts-1", "major", "Save loses the phone", ["TC-contacts-2"], true]]);
  assert.equal(r.bugs[0].evidence.length, 1);
  // human queues
  assert.deepEqual(r.queues.testcaseApprovals.find((q) => q.module === "contacts"), { module: "contacts", built: true, approvalCsv: `${A}/modules/contacts/testcases/approval.csv`, approved: 0, rejected: 0, changes: 0, awaiting: 2 });
  assert.deepEqual(r.queues.clarifications.map((q) => [q.id, q.kind, q.nextStep]), [["CQ-contacts-1", "unanswered", "run in full-run"], ["CQ-contacts-2", "awaiting-approval", null]]);
  // coverage per ledger with deferrals and exclusions, and a missing ledger said so
  const tc = r.coverage.ledgers.find((l) => l.ledger === "testcases" && l.module === "contacts");
  assert.deepEqual([tc.counts, tc.byTechnique.ep.total, tc.deferred, tc.excluded], [{ total: 3, mapped: 1, excluded: 1, deferred: 1, pending: 0 }, 3, [{ id: "CI-contacts-3", detail: "over the budget of 1" }], [{ id: "CI-contacts-2", reason: "not-testable", detail: "no UI" }]]);
  assert.deepEqual(r.coverage.ledgers.find((l) => l.ledger === "workload").excluded.map((e) => [e.id, e.reason]), [["TC-contacts-2", "mutating-readonly"]], "the workload ledger runs over the approved @performance cases (D-068)");
  assert.equal(r.coverage.ledgers.find((l) => l.ledger === "api-code").deferred[0].id, "API-contacts-1");
  const ui = r.coverage.ledgers.find((l) => l.ledger === "ui-code" && l.module === "contacts");
  assert.deepEqual([ui.available, ui.reason], [false, "ui-code ledger not written"]);
  // assumptions: assumed thresholds only, @assumption cases, weak rule facts, limits, leftovers, untracked creates
  assert.deepEqual(r.assumptions.k6Thresholds.map((t) => [t.script, t.metric, t.limit]), [["contacts-smoke-1", "http_req_duration", 1000]]);
  assert.deepEqual(r.assumptions.assumptionCases, [{ module: "contacts", id: "TC-contacts-1", assumptions: ["phone is optional"] }]);
  assert.deepEqual(r.assumptions.ruleFacts.map((f) => [f.evidence, f.text]), [["agent-capture", "Email must be unique"]]);
  assert.ok(r.assumptions.knownLimits.length >= 1);
  assert.deepEqual(r.assumptions.k6Leftovers, [{ type: "contact", ref: "c-1", module: "contacts", stage: "k6" }]);
  assert.deepEqual(r.assumptions.k6Untracked.map((u) => [u.script, u.retry, u.creates, u.types]), [["contacts-smoke-1", false, 2, ["contacts"]], ["contacts-smoke-1", true, 1, ["contacts"]]]);
  assert.deepEqual([r.totals.assumptions.k6UntrackedCreates, r.totals.assumptions.k6Thresholds], [3, 1]);
  // stages: the failed review with its findings, and what it blocks
  assert.deepEqual(r.failedStages.map((s) => [s.key, s.reviewFailed, s.findings.length]), [["contacts/testcases", true, 1]]);
  assert.ok(r.blockedStages.some((s) => s.key === "contacts/k6"));
  assert.equal(r.totals.stages.failed, 1);
});

test("bug fix: k6 scripts are the workload's scenarios, never another module's longer-named scripts", async () => {
  const { root } = fixture();
  const r = await validReport(root);
  const c = r.modules.find((m) => m.module === "contacts");
  assert.deepEqual([c.k6Scripts, c.k6Planned], [1, 1], "contacts-pipeline-smoke-1.js is not contacts' script");
  const d = r.modules.find((m) => m.module === "deals");
  assert.deepEqual([d.k6Scripts, d.k6Planned], [0, null], "no workload: counted as zero and listed as missing");
  assert.ok(r.missing.some((m) => m.section === "k6" && m.module === "deals"));
});

test("bug fix: an empty sitemap is not explored", async () => {
  const { root } = fixture();
  const r = await validReport(root);
  assert.deepEqual(r.modules.map((m) => [m.module, m.explored]), [["contacts", false], ["deals", true]]);
  assert.equal(r.totals.modulesExplored, 1);
  assert.ok(r.missing.some((m) => m.section === "modules" && m.module === "contacts" && /empty/.test(m.reason)));
});

test("missing data is explicit: a run with nothing collected lists every gap and no ledger pretends to be zero", async () => {
  const { root } = startRun();
  const r = await validReport(root);
  assert.ok(r.missing.length > 0);
  assert.equal(r.totals.missing, r.missing.length);
  assert.ok(r.coverage.ledgers.every((l) => l.available === false && l.reason));
  assert.deepEqual(r.coverage.ledgers.find((l) => l.module === "contacts" && l.ledger === "testcases"), { ledger: "testcases", module: "contacts", available: false, reason: "testcases ledger not written", file: null });
  assert.equal(r.modules[0].testcases, null);
  assert.ok(r.missing.some((m) => m.section === "results" && m.module === "contacts"));
  assert.deepEqual(r.assumptions.knownLimits, [], "nothing explored, so no limit applies");
});

// ---------- the narrative ----------

const statement = (text, ...cites) => ({ text, cites });
const narrativeOk = () => ({
  executiveSummary: [statement("3 test cases exist, of which 2 await approval.", "modules[module=contacts].testcases", "totals.approvals.awaiting"), statement("The run was readonly.", "mode")],
  risks: [{ ...statement("One product bug cluster, BUG-contacts-1, is major.", "bugs[0].severity", "bugs"), severity: "high" }],
  recommendations: [statement("Answer the 1 unconfirmed clarification before the next run.", "totals.clarifications.unconfirmed")],
});

async function setupReport() {
  const f = fixture();
  const rp = reportPaths(f.pr.productDir, RUN);
  put(f.root, path.relative(f.root, rp.report), JSON.stringify(await collect("acme", { root: f.root, now: NOW }), null, 2));
  return { ...f, rp, cli: (cmd) => main([cmd, "acme"], { root: f.root }), narrative: (n) => writeFileSync(rp.narrative, JSON.stringify(n)) };
}

test("check passes a cited narrative that matches report.json, stamps it, and the stamp goes stale on any edit", async () => {
  const s = await setupReport();
  s.narrative(narrativeOk());
  assert.equal((await s.cli("render")).code, 0);
  const c = await s.cli("check");
  assert.deepEqual([c.code, c.out.valid], [0, true], JSON.stringify(c.out));
  assert.equal(reportUnverified(s.rp), null);
  writeFileSync(s.rp.html, readFileSync(s.rp.html, "utf8") + "<!-- hand edit -->");
  assert.match(reportUnverified(s.rp), /changed after report.mjs check/);
  const again = await s.cli("check");
  assert.equal(again.code, 1);
  assert.match(again.out.problems.join("\n"), /index\.html is not what render makes/);
  assert.equal(existsSync(s.rp.state), false, "a failed check removes the stamp");
});

test("check fails a number that no cited path holds", async () => {
  const s = await setupReport();
  const n = narrativeOk();
  n.executiveSummary[0].text = "4 test cases exist, of which 2 await approval.";
  s.narrative(n);
  await s.cli("render").then((r) => assert.equal(r.code, 1, "render refuses too"));
  const c = await s.cli("check");
  assert.equal(c.code, 1);
  assert.match(c.out.problems.join("\n"), /executiveSummary\[0\]: the number 4 is not at any cited path/);
  assert.equal(existsSync(s.rp.state), false);
});

test("check fails a cited path that is not in report.json, and a statement with no citation", async () => {
  const s = await setupReport();
  const n = narrativeOk();
  n.recommendations[0].cites = ["totals.clarifications.nothing"];
  s.narrative(n);
  const c = await s.cli("check");
  assert.match(c.out.problems.join("\n"), /recommendations\[0\]: cites 'totals.clarifications.nothing', which is not in report.json/);
  n.recommendations[0].cites = [];
  s.narrative(n);
  assert.match((await s.cli("check")).out.problems.join("\n"), /narrative\.json: .*cites/);
  // a number that is only in an array's length counts; ids and dates are not numbers
  assert.deepEqual(numbersOf("BUG-contacts-1 on 2026-10-19: 3 of 12, 1,200 and 0.5 in v2 (7th)"), [3, 12, 1200, 0.5]);
});

test("check needs the narrative; render without it gives a deck with no narrative slides", async () => {
  const s = await setupReport();
  const r = await s.cli("render");
  assert.deepEqual([r.code, r.out.narrative], [0, false]);
  assert.doesNotMatch(readFileSync(s.rp.html, "utf8"), /Executive summary/);
  const c = await s.cli("check");
  assert.equal(c.code, 1);
  assert.match(c.out.problems.join("\n"), /narrative\.json is missing/);
});

test("resolveCite: keys, indexes and [key=value] selectors; nothing outside the data", () => {
  const d = { a: { "b-c": 5, list: [{ id: "x", n: 1 }, { id: "y", n: 2 }] }, s: "t" };
  assert.deepEqual(resolveCite(d, "a.b-c"), { found: true, value: 5 });
  assert.equal(resolveCite(d, "a.list[1].n").value, 2);
  assert.equal(resolveCite(d, "a.list[id=y].n").value, 2);
  for (const bad of ["a.nope", "a.list[2]", "a.list[id=z]", "s.length", "a.toString", "a..b"]) assert.equal(resolveCite(d, bad).found, false, bad);
});

// ---------- the render ----------

test("render is deterministic, self-contained and escapes data; every table row of the data is on a slide", async () => {
  const s = await setupReport();
  const report = loadJson(s.rp.report);
  report.bugs[0].title = "<script>alert(1)</script>";
  const html = renderDeck(report, narrativeOk());
  assert.equal(html, renderDeck(structuredClone(report), narrativeOk()), "same inputs, same bytes");
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /https?:\/\/(?!app\.acme\.test)|<link |<img |src=|@import|cdn/i, "no external request");
  for (const needle of ["prefers-color-scheme: dark", "@media print", 'lang="en"', "<svg", "role=\"img\"", "<caption>", 'scope="col"', "arrowright", "BUG-contacts-1", "approval.csv", "contacts-smoke-1", "http_req_duration", "Email must be unique", "ui-code ledger not written", "review failed", "Executive summary", "Risks and recommendations", "Data gaps"]) assert.match(html, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), needle);
  // the CLI writes the same bytes
  s.narrative(narrativeOk());
  await s.cli("render");
  const written = readFileSync(s.rp.html, "utf8");
  await s.cli("render");
  assert.equal(readFileSync(s.rp.html, "utf8"), written);
  assert.equal(written, renderDeck(loadJson(s.rp.report), narrativeOk()));
});

test("older runs stay readable: a run.json without provenance.config, or without provenance, gives a report with no config notice", async () => {
  for (const strip of [(run) => delete run.provenance.config, (run) => delete run.provenance]) {
    const { root } = startRun();
    const runFile = paths("acme", root).runFile;
    const run = loadJson(runFile);
    strip(run);
    writeFileSync(runFile, JSON.stringify(run, null, 2));
    assert.deepEqual(await validateData("run", run), []);
    const report = await collect("acme", { root, now: NOW });
    assert.equal(report.customConfig, null, "nothing is guessed for a run that did not record its config");
    assert.deepEqual(await validateData("report", report), []);
    assert.doesNotMatch(renderDeck(report), /Custom safety config|customized config/);
    // a report.json written before customConfig existed still validates and renders
    delete report.customConfig;
    assert.deepEqual(await validateData("report", report), []);
    assert.match(renderDeck(report), /test run report/);
  }
});

test("paths lists the report's files; the stage reads the stamp", async () => {
  const s = await setupReport();
  const p = await s.cli("paths");
  assert.deepEqual(p.out, { report: `${A}/results/${RUN}/report/report.json`, narrative: `${A}/results/${RUN}/report/narrative.json`, html: `${A}/results/${RUN}/report/index.html`, state: `${A}/results/${RUN}/report/report-check.json` });
  assert.equal((await main(["bogus", "acme"], { root: s.root })).code, 2);
  const { verifyOutputs } = await import("./lib/contract.mjs");
  const ctx = { product: "acme", runId: RUN, root: s.root };
  s.narrative(narrativeOk());
  await s.cli("render");
  assert.match((await verifyOutputs(ctx, "report", null)).join("\n"), /report\.mjs check never passed/);
  assert.equal((await s.cli("check")).code, 0);
  assert.deepEqual(await verifyOutputs(ctx, "report", null), []);
});

test("time and effort: stage and step durations, agent spawns per agent, a slide; unrecorded spawns are a data gap (D-079)", async () => {
  const { effort, recordSpawn, spawnMetrics } = await import("./lib/telemetry.mjs");
  const { step } = await import("./orchestration.mjs");
  const { root, run } = startRun();
  assert.deepEqual(spawnMetrics({ totalDurationMs: 5, totalTokens: 9, totalToolUseCount: 2, content: "x" }), { durationMs: 5, tokens: 9, toolUses: 2 });
  assert.deepEqual(spawnMetrics("text"), {});
  const p = paths("acme", root);
  const r = loadJson(p.runFile);
  r.stages["_product/knowledge"] = { status: "done", attempts: 1, startedAt: "2026-10-24T10:00:00.000Z", finishedAt: "2026-10-24T10:02:05.000Z" };
  r.stages["contacts/explore"] = { status: "running", attempts: 1, startedAt: "2026-10-24T10:03:00.000Z" };
  writeFileSync(p.runFile, JSON.stringify(r));
  step("acme", "testcases", "contacts", "write", "start", undefined, { root });
  const s = step("acme", "testcases", "contacts", "write", "done", undefined, { root });
  assert.ok(s.steps.write.startedAt && s.steps.write.at >= s.steps.write.startedAt, "a step keeps when it started");
  const noSpawns = effort({ run: loadJson(p.runFile), stateDir: p.state });
  assert.deepEqual([noSpawns.spawnsRecorded, noSpawns.stages.find((x) => x.key === "_product/knowledge").durationMs, noSpawns.stages.find((x) => x.key === "contacts/explore").durationMs], [false, 125000, null]);
  assert.deepEqual(noSpawns.steps.map((x) => [x.domain, x.module, x.steps, x.longest]), [["testcases", "contacts", 1, "write"]]);
  const before = await collect("acme", { root });
  assert.ok(before.missing.some((m) => m.section === "effort"), "spawns not recorded is said, never shown as zero");

  const spawn = (agent, metrics) => recordSpawn(root, { kind: "spawn", host: "claude-code", agent: "orchestrator-agent", subagent: agent }, metrics);
  spawn("module-explorer", { totalDurationMs: 60000, totalTokens: 1000 });
  spawn("module-explorer", { totalDurationMs: 30000, totalTokens: 500 });
  spawn("report-generator", {});
  assert.equal(recordSpawn(root, { kind: "shell", host: "claude-code" }), null);
  const report = await collect("acme", { root });
  assert.deepEqual(report.effort.agents.map((a) => [a.agent, a.spawns, a.durationMs, a.tokens]), [["module-explorer", 2, 90000, 1500], ["report-generator", 1, 0, 0]]);
  assert.deepEqual(report.totals.effort, { stageMs: 125000, stepMs: report.effort.totals.stepMs, spawns: 3, tokens: 1500 });
  assert.ok(!report.missing.some((m) => m.section === "effort"));
  assert.deepEqual(await validateData("report", report), []);
  const html = renderDeck(report);
  assert.match(html, /<h2[^>]*>Time and effort<\/h2>/);
  assert.match(html, /Stages took 2m 05s in all; 3 agent spawns were recorded, using 1500 tokens/);
  assert.match(html, /<code>module-explorer<\/code><\/td><td[^>]*>2<\/td><td[^>]*>1m 30s<\/td>/);
});
