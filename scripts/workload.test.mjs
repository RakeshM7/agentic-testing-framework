// scripts/workload.mjs and scripts/lib/workload.mjs: the script-built k6 workload (G7).
//
// D-068 (selectable workflow steps, 2026-10-20) supersedes D-057's catalogue-wide workload: the workload is
// built ONLY from the human-approved @performance test cases, one load unit per case, and the coverage ledger runs over
// those cases instead of every catalogue endpoint. k6 no longer needs playwright-api (decision 5): the tests of the old
// not-planned and untested-functional exclusions and of mapResults were removed. Decision 16 restores failed-functional
// and blocked when playwright-api results exist (tested at the end). D-057's caps (types by mode and opt-in, open
// model, Little's law, dropped_iterations, rate-limit and write caps, SLO-or-assumed thresholds, writes only in a
// full-run through flows on run-created entities) are tested here on cases.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { main } from "./workload.mjs";
import { gate } from "./gate.mjs";
import { planPaths } from "./lib/api-plan.mjs";
import { writeJson } from "./lib/endpoints.mjs";
import { caseType, profileFor, rateLimitRps, sizing, typesFor, workloadPaths, workloadRules, workloadScenarios, workloadUnverified, K6_DEFAULTS } from "./lib/workload.mjs";
import { validateRunConfig } from "./run-config.mjs";
import { markApproved, put, startRun } from "./test-helpers.mjs";

const MOD = "artifacts/acme/modules/contacts";
const CITE = "knowledge:modules/contacts/notes.md";
const ep = (n, method, p, extra = {}) => ({
  id: `EP-contacts-${n}`, key: `${method} ${p}`, kind: "rest", method, path: p, resource: "contacts",
  crud: { GET: p.includes("{") ? "read" : "list", POST: "create", PUT: "update", DELETE: "delete" }[method],
  observed: { ui: true, probe: false }, params: p.includes("{") ? [{ name: "id", in: "path", required: true }] : [],
  rateLimit: null, links: [], mutates: method !== "GET", safeMethod: method === "GET", ...extra,
});
const CATALOGUE = () => [
  ep(1, "GET", "/api/v1/contacts"),
  ep(2, "POST", "/api/v1/contacts"),
  ep(3, "GET", "/api/v1/contacts/{id}"),
  ep(4, "DELETE", "/api/v1/contacts/{id}"),
  ep(5, "GET", "/api/v1/tags"),
  ep(6, "GET", "/api/v1/reports"),
  ep(7, "GET", "/api/v1/health"),
  { ...ep(8, "POST", "/api/v1/contacts/search"), crud: "action", queryLike: { evidence: "path segment 'search'", source: "name" } },
  ep(9, "PUT", "/api/v1/contacts/{id}"),
];
// An approved @performance case as testcases.mjs builds it (testcases/coverage.json): an endpoint (EP id) or a flow
// (an overlay flow or mix name), a load type, a target rate and an optional SLO.
const pc = (n, target, { type = "smoke", rps = 10, slo, priority = "p2" } = {}) => ({
  id: `TC-contacts-${n}`, key: `perf-${n}`, title: `load ${target}`, type: "performance", performance: true, priority, hash: `hash-${n}`,
  ...(target.startsWith("EP-") ? { endpoint: target } : { flow: target }),
  load: { type, rps, ...(slo ? { slo } : {}) },
});
const CASES = () => [pc(1, "EP-contacts-1"), pc(3, "EP-contacts-3")];

function setup({ mode = "readonly", k6, catalogue = CATALOGUE(), overlay, cases = CASES(), approve } = {}) {
  const { root } = startRun({ mode, extra: k6 ? [`k6: ${JSON.stringify(k6)}`] : [] });
  const pp = planPaths(path.join(root, "artifacts/acme"), "contacts");
  writeJson(pp.catalogue, catalogue);
  put(root, `${MOD}/testcases/coverage.json`, JSON.stringify({ cases }));
  markApproved(root, approve ?? cases.map((c) => c.id)); // only human-approved cases exist for the workload (D-053)
  put(root, "artifacts/acme/knowledge/modules/contacts/notes.md", "# Contacts\nCreating, reading and deleting a contact is the core flow.\n");
  if (overlay) put(root, `${MOD}/k6/workload-overlay.json`, JSON.stringify(overlay));
  const wp = workloadPaths(path.join(root, "artifacts/acme"), "contacts");
  const cli = (cmd, ...rest) => main([cmd, "acme", "contacts", ...rest], { root });
  const wl = () => JSON.parse(readFileSync(wp.workload, "utf8"));
  const cov = () => JSON.parse(readFileSync(wp.coverage, "utf8"));
  const tc = (n) => `TC-contacts-${n}`;
  const reason = (n) => cov().excluded.find((x) => x.case === tc(n))?.reason ?? (cov().loaded.some((x) => x.case === tc(n)) ? "loaded" : cov().deferred.some((x) => x.case === tc(n)) ? "deferred" : null);
  const of = (n) => wl().scenarios.find((x) => x.case === tc(n));
  return { root, wp, pp, cli, wl, cov, reason, of };
}
const FLOW = { name: "contact-lifecycle", steps: [{ endpoint: "EP-contacts-2" }, { endpoint: "EP-contacts-3", bind: { param: "id", from: 0, pointer: "/id" } }, { endpoint: "EP-contacts-9", bind: { param: "id", from: 0, pointer: "/id" } }, { endpoint: "EP-contacts-4", bind: { param: "id", from: 0, pointer: "/id" } }], citations: [CITE] };

test("types by mode and opt-in cap each case's type: readonly smoke only, opt-in types only when opted in, each cap noted", async () => {
  assert.deepEqual(typesFor("readonly", K6_DEFAULTS, "contacts").types, ["smoke"]);
  const ro = typesFor("readonly", { ...K6_DEFAULTS, modules: { contacts: { types: ["stress"] } } }, "contacts");
  assert.deepEqual(ro.types, ["smoke"]);
  assert.match(ro.notes[0], /opts in stress: ignored, a readonly run gets smoke only/);
  assert.deepEqual(typesFor("full-run", K6_DEFAULTS, "contacts").types, ["smoke", "average-load"]);
  assert.deepEqual(typesFor("full-run", { ...K6_DEFAULTS, modules: { contacts: { types: ["soak", "stress"] } } }, "contacts").types, ["smoke", "average-load", "stress", "soak"]);
  assert.deepEqual(caseType("stress", ["smoke"]), { type: "smoke", note: "stress capped to smoke: a readonly run gets smoke only" });
  assert.deepEqual(caseType("average-load", ["smoke", "average-load"]), { type: "average-load" });
  assert.match(caseType("soak", ["smoke", "average-load"]).note, /soak capped to average-load: soak is an opt-in type the run-config does not opt this module into/);

  const cases = () => [pc(1, "EP-contacts-1", { type: "stress" }), pc(3, "EP-contacts-3", { type: "breakpoint" }), pc(5, "EP-contacts-5", { type: "average-load" })];
  const s = setup({ cases: cases(), k6: { modules: { contacts: { types: ["stress", "breakpoint"] } } } });
  const r = await s.cli("build");
  assert.equal(r.code, 0, JSON.stringify(r.out));
  assert.deepEqual(s.wl().scenarios.map((x) => [x.case, x.type]), [["TC-contacts-1", "smoke"], ["TC-contacts-3", "smoke"], ["TC-contacts-5", "smoke"]]);
  assert.ok(s.wl().notes.some((n) => /ignored, a readonly run gets smoke only/.test(n)));
  assert.ok(s.wl().notes.includes("TC-contacts-1: stress capped to smoke: a readonly run gets smoke only"));
  assert.deepEqual(s.cov().loaded.find((x) => x.case === "TC-contacts-1"), { case: "TC-contacts-1", target: "EP-contacts-1", endpoints: ["EP-contacts-1"], type: "smoke", requestedType: "stress", ids: [s.of(1).id] });

  // full-run: the opted-in stress runs; breakpoint is not opted in here, so it runs as average-load, noted
  const f = setup({ mode: "full-run", cases: cases(), k6: { modules: { contacts: { types: ["stress"] } } } });
  assert.equal((await f.cli("build")).code, 0);
  assert.deepEqual(f.wl().scenarios.map((x) => [x.case, x.type, x.executor]), [["TC-contacts-1", "stress", "ramping-arrival-rate"], ["TC-contacts-3", "average-load", "constant-arrival-rate"], ["TC-contacts-5", "average-load", "constant-arrival-rate"]]);
  assert.ok(f.wl().notes.some((n) => /^TC-contacts-3: breakpoint capped to average-load/.test(n)));
  assert.equal(f.wl().scenarios.length, 3, "one scenario per case");
  // breakpoint thresholds abort the run
  const b = setup({ mode: "full-run", cases: cases(), k6: { modules: { contacts: { types: ["breakpoint"] } } } });
  assert.equal((await b.cli("build")).code, 0);
  assert.equal(b.of(3).key, "case:TC-contacts-3|breakpoint");
  assert.ok(b.of(3).options.thresholds["http_req_duration{endpoint:EP-contacts-3}"].every((t) => t.abortOnFail === true));
});

test("the ledger accounts for every approved @performance case: loaded, or excluded with a reason, never silently dropped", async () => {
  const ui = { id: "TC-contacts-9", key: "ui-9", title: "a UI case", type: "functional", priority: "p1", hash: "hash-9" };
  const s = setup({
    cases: [pc(1, "EP-contacts-1"), pc(2, "EP-contacts-99"), pc(3, "no-such-flow"), pc(4, "EP-contacts-2"), pc(6, "EP-contacts-6"), pc(7, "EP-contacts-7"), ui],
    approve: ["TC-contacts-1", "TC-contacts-2", "TC-contacts-3", "TC-contacts-4", "TC-contacts-6", "TC-contacts-9"],
    overlay: { exclude: [{ endpoint: "EP-contacts-6", reason: "reports are billed per call", citation: CITE }] },
  });
  const r = await s.cli("build");
  assert.equal(r.code, 0, JSON.stringify(r.out));
  // built with no API plan and no playwright-api results: k6 no longer needs playwright-api (decision 5)
  assert.ok(!existsSync(s.pp.plan) && !existsSync(path.join(s.root, "artifacts/acme/results/acme-run-1/contacts/playwright-api")));
  assert.equal(s.reason(1), "loaded");
  assert.equal(s.reason(2), "unknown-endpoint");
  assert.match(s.cov().excluded.find((x) => x.case === "TC-contacts-2").detail, /names EP-contacts-99, which is not in the endpoint catalogue/);
  assert.equal(s.reason(3), "unresolved-flow");
  assert.match(s.cov().excluded.find((x) => x.case === "TC-contacts-3").detail, /'no-such-flow': no workload-overlay.json flow or mix has that name/);
  assert.equal(s.reason(4), "mutating-readonly");
  assert.equal(s.reason(6), "overlay-excluded");
  assert.equal(s.cov().excluded.find((x) => x.case === "TC-contacts-6").citation, CITE);
  assert.equal(s.reason(7), null, "an unapproved case is not in the workload (D-053)");
  assert.equal(s.reason(9), null, "a UI case is not a load case");
  assert.deepEqual(s.cov().counts, { total: 5, loaded: 1, excluded: 4, deferred: 0 });
  // reported in the workload's notes too
  for (const n of [2, 3]) assert.ok(s.wl().notes.some((x) => x.startsWith(`TC-contacts-${n} is not loaded:`)), `TC-contacts-${n}`);
  assert.deepEqual(s.wl().scenarios.map((x) => x.key), ["case:TC-contacts-1|smoke"]);

  // no approved @performance case: nothing to load, and the notes say why
  const n = setup({ cases: [ui] });
  assert.equal((await n.cli("build")).code, 0);
  assert.equal(workloadScenarios(n.wp.workload).length, 0);
  assert.ok(n.wl().notes.some((x) => /no human-approved @performance test case: nothing to load/.test(x)));
  assert.equal(n.cov().counts.total, 0);
});

test("stable K6 ids: keyed by case + type, never shifted by input changes", async () => {
  const s = setup({ cases: [pc(1, "EP-contacts-1"), pc(3, "EP-contacts-3"), pc(5, "EP-contacts-5")], approve: ["TC-contacts-1", "TC-contacts-3"] });
  await s.cli("build");
  const before = Object.fromEntries(s.wl().scenarios.map((x) => [x.key, x.id]));
  assert.deepEqual(Object.keys(before).sort(), ["case:TC-contacts-1|smoke", "case:TC-contacts-3|smoke"]);
  for (const x of s.wl().scenarios) assert.equal(x.name, `smoke-${x.id.split("-").at(-1)}`);
  // TC-contacts-5 is approved: a new key gets the next id, the old ones keep theirs
  markApproved(s.root, ["TC-contacts-1", "TC-contacts-3", "TC-contacts-5"]);
  await s.cli("build");
  const after = Object.fromEntries(s.wl().scenarios.map((x) => [x.key, x.id]));
  for (const [k, id] of Object.entries(before)) assert.equal(after[k], id);
  assert.equal(after["case:TC-contacts-5|smoke"], "K6-contacts-3");
  // its approval is withdrawn: gone, and back with the same id
  markApproved(s.root, ["TC-contacts-1", "TC-contacts-3"]);
  await s.cli("build");
  assert.equal(JSON.parse(readFileSync(s.wp.registry, "utf8")).scenarios["case:TC-contacts-5|smoke"].status, "gone");
  markApproved(s.root, ["TC-contacts-1", "TC-contacts-3", "TC-contacts-5"]);
  await s.cli("build");
  assert.equal(s.of(5).id, "K6-contacts-3");
});

test("Little's law sizing and the dropped_iterations threshold on every scenario", async () => {
  assert.deepEqual(sizing(10, 1), { peakRps: 10, expectedIterationS: 1, headroom: 1.5, preAllocatedVUs: 15, maxVUs: 30 });
  assert.equal(sizing(1, 0.2).preAllocatedVUs, 1);
  const f = setup({ mode: "full-run", cases: [pc(1, "EP-contacts-1", { type: "average-load", rps: 10 }), pc(2, "EP-contacts-1", { type: "smoke" })], k6: { modules: { contacts: { slo: { endpoints: { "GET /api/v1/contacts": { p95_ms: 400 } } } } } }, overlay: { thinkTime: { "EP-contacts-1": { ms: 600, citation: CITE } } } });
  assert.equal((await f.cli("build")).code, 0);
  const avg = f.of(1);
  // 10 rps x (0.4 s p95 + 0.6 s think) x 1.5
  assert.deepEqual(avg.sizing, { peakRps: 10, expectedIterationS: 1, headroom: 1.5, preAllocatedVUs: 15, maxVUs: 30 });
  assert.deepEqual(avg.options.scenarios[avg.name], { executor: "constant-arrival-rate", rate: 10, timeUnit: "1s", duration: "120s", preAllocatedVUs: 15, maxVUs: 30 });
  assert.equal(avg.thinkTimeMs, 600);
  // 10 rps x 120 s = 1200 iterations -> count<12; smoke: 30 iterations -> count<1
  assert.deepEqual(avg.options.thresholds.dropped_iterations, ["count<12"]);
  const smoke = f.of(2);
  assert.deepEqual(smoke.options.thresholds.dropped_iterations, ["count<1"]);
  for (const x of f.wl().scenarios) assert.ok(x.thresholds.some((t) => t.metric === "dropped_iterations"), x.id);
  assert.deepEqual(smoke.options.scenarios[smoke.name], { executor: "constant-arrival-rate", rate: 1, timeUnit: "1s", duration: "30s", preAllocatedVUs: 2, maxVUs: 4 });
});

test("caps: the case's rate, never above half a documented rate limit or 10 rps for 2 min; a write gets half the read cap", async () => {
  assert.deepEqual(rateLimitRps({ limit: 600, window: "1m" }), { rps: 10 });
  assert.deepEqual(rateLimitRps({ perMinute: 30 }), { rps: 0.5 });
  assert.deepEqual(rateLimitRps({ headers: { "RateLimit-Policy": "100;w=10" } }), { rps: 10 });
  assert.deepEqual(rateLimitRps({ headers: { "x-ratelimit-limit": "100" } }), { unreadable: true });
  assert.deepEqual(rateLimitRps({ limit: 5, window: "fortnight" }), { unreadable: true });
  assert.equal(rateLimitRps(null), null);
  assert.equal(profileFor("stress", 5, 5, K6_DEFAULTS.caps).skip, "rate-limited");
  assert.equal(profileFor("spike", 2, Infinity, K6_DEFAULTS.caps).stages[0].target, 10);

  const cat = CATALOGUE();
  cat[0].rateLimit = { limit: 600, window: "1m", source: "docs" }; // 10 rps -> 5
  cat[2].rateLimit = { perMinute: 60, source: "docs" }; // 1 rps -> 0.5 -> 30 per minute
  cat[4].rateLimit = { headers: { "x-ratelimit-limit": "100" }, source: "probe" };
  const cases = [
    pc(1, "EP-contacts-1", { type: "average-load", rps: 50 }),
    pc(2, "EP-contacts-1", { type: "stress", rps: 50 }),
    pc(3, "EP-contacts-3", { type: "average-load" }),
    pc(5, "EP-contacts-5", { type: "average-load" }),
    pc(20, "contact-lifecycle", { type: "average-load", rps: 50 }),
  ];
  const f = setup({ mode: "full-run", catalogue: cat, cases, k6: { modules: { contacts: { types: ["stress"] } } }, overlay: { flows: [FLOW] } });
  assert.equal((await f.cli("build")).code, 0, "build");
  assert.equal(f.of(1).options.scenarios[f.of(1).name].rate, 5);
  assert.equal(f.of(1).load.capSource, "rate-limit");
  assert.equal(f.of(2), undefined); // 2 x 5 capped at 5: no headroom
  assert.equal(f.reason(2), "rate-limited");
  assert.ok(f.cov().skippedTypes.some((x) => x.unit === "case:TC-contacts-2" && x.type === "stress" && x.reason === "rate-limited"));
  const item = Object.values(f.of(3).options.scenarios)[0];
  assert.deepEqual([item.rate, item.timeUnit], [30, "1m"]);
  assert.equal(f.reason(5), "rate-limited");
  assert.match(f.cov().excluded.find((x) => x.case === "TC-contacts-5").detail, /no rate could be read/);
  assert.equal(f.of(20).load.averageRps, 0.5, "the flow's read step is capped by its rate limit");
  // without a limit: 10 rps; a case asking for less gets its own rate; the write flow gets half
  const g = setup({ mode: "full-run", cases: [pc(1, "EP-contacts-1", { type: "average-load", rps: 50 }), pc(4, "EP-contacts-1", { type: "average-load", rps: 3 }), pc(20, "contact-lifecycle", { type: "average-load", rps: 50 })], overlay: { flows: [FLOW] } });
  assert.equal((await g.cli("build")).code, 0);
  assert.deepEqual([g.of(1).load.averageRps, g.of(1).load.durationS, g.of(1).load.capSource], [10, 120, "default"]);
  assert.deepEqual([g.of(4).load.averageRps, g.of(4).load.capSource], [3, "case:TC-contacts-4"]);
  assert.deepEqual([g.of(20).load.averageRps, g.of(20).load.capSource], [5, "default-write-half"]);
  // an SLO rps overrides the write half-cap, never 50% of a rate limit
  const h = setup({ mode: "full-run", cases: [pc(20, "contact-lifecycle", { type: "average-load", rps: 50 })], overlay: { flows: [FLOW] }, k6: { caps: { rps: 4 }, modules: { contacts: { slo: { rps: 8 } } } } });
  assert.equal((await h.cli("build")).code, 0);
  assert.equal(h.of(20).load.averageRps, 8);
});

test("thresholds: the case's SLO over the run-config's, field by field, else assumed p95 < 1000 ms and error rate < 1%", async () => {
  const a = setup();
  await a.cli("build");
  const t = a.of(1).thresholds;
  assert.deepEqual(t.filter((x) => x.stat !== "dropped-iterations").map((x) => [x.stat, x.expr, x.source, x.assumed]), [["p95", "p(95)<1000", "assumed", true], ["error-rate", "rate<0.01", "assumed", true]]);
  const s = setup({
    cases: [pc(1, "EP-contacts-1"), pc(2, "EP-contacts-1", { slo: { p95_ms: 300, error_rate: 0.05 } })],
    k6: { slo: { p95_ms: 900, error_rate: 0.02 }, modules: { contacts: { slo: { p95_ms: 700, endpoints: { "EP-contacts-1": { p99_ms: 1500 } } } } } },
  });
  assert.equal((await s.cli("build")).code, 0);
  const one = s.of(1);
  assert.deepEqual(one.thresholds.filter((x) => x.stat !== "dropped-iterations").map((x) => [x.stat, x.expr, x.source, x.assumed]), [["p95", "p(95)<700", "slo:module", false], ["p99", "p(99)<1500", "slo:endpoint", false], ["error-rate", "rate<0.02", "slo:global", false]]);
  assert.deepEqual(one.options.thresholds["http_req_duration{endpoint:EP-contacts-1}"], ["p(95)<700", "p(99)<1500"]);
  // the case's own SLO wins field by field; a field it leaves out comes from the run-config
  assert.deepEqual(s.of(2).thresholds.filter((x) => x.stat !== "dropped-iterations").map((x) => [x.stat, x.expr, x.source, x.assumed]), [["p95", "p(95)<300", "case:TC-contacts-2", false], ["p99", "p(99)<1500", "slo:endpoint", false], ["error-rate", "rate<0.05", "case:TC-contacts-2", false]]);
  // a case SLO alone: the other field is assumed
  const c = setup({ cases: [pc(1, "EP-contacts-1", { slo: { p95_ms: 250 } })] });
  assert.equal((await c.cli("build")).code, 0);
  assert.deepEqual(c.of(1).thresholds.filter((x) => x.stat !== "dropped-iterations").map((x) => [x.stat, x.source, x.assumed]), [["p95", "case:TC-contacts-1", false], ["error-rate", "assumed", true]]);
  // an endpoint SLO key that names nothing is a problem, not silently ignored
  const bad = setup({ k6: { modules: { contacts: { slo: { endpoints: { "GET /nope": { p95_ms: 1 } } } } } } });
  const r = await bad.cli("build");
  assert.equal(r.code, 1);
  assert.match(r.out.problems.join("\n"), /slo.endpoints\['GET \/nope'\]: no endpoint/);
});

test("writes: excluded in readonly, loaded in full-run only through a cited flow on run-created entities", async () => {
  const ro = setup({ cases: [pc(20, "contact-lifecycle"), pc(8, "EP-contacts-8")], overlay: { flows: [FLOW] } });
  assert.equal((await ro.cli("build")).code, 0);
  assert.equal(ro.wl().scenarios.length, 0);
  assert.equal(ro.reason(20), "mutating-readonly");
  assert.equal(ro.reason(8), "mutating-readonly");
  // full-run, a write endpoint without a flow: no-safe-data; the query-like POST loads without a flow, at the write cap
  const nf = setup({ mode: "full-run", cases: [pc(2, "EP-contacts-2"), pc(4, "EP-contacts-4"), pc(9, "EP-contacts-9"), pc(8, "EP-contacts-8")] });
  assert.equal((await nf.cli("build")).code, 0);
  for (const n of [2, 4, 9]) assert.equal(nf.reason(n), "no-safe-data");
  assert.match(nf.cov().excluded.find((x) => x.case === "TC-contacts-2").detail, /a write is loaded only through a cited workload-overlay.json flow .*name that flow in the case/);
  const q = nf.of(8);
  assert.deepEqual([q.mutates, q.queryLike, q.load.rps, q.load.averageRps, q.load.capSource], [true, true, 1, 5, "default-write-half"]);
  // a case naming the flow: loaded, mutates, cleanup by the delete step, trackLeftover
  const f = setup({ mode: "full-run", cases: [pc(20, "contact-lifecycle"), pc(21, "contact-lifecycle", { type: "average-load" })], overlay: { flows: [FLOW] } });
  assert.equal((await f.cli("build")).code, 0);
  const w = f.of(20);
  assert.deepEqual([w.kind, w.mutates, w.key], ["flow", true, "case:TC-contacts-20|smoke"]);
  assert.deepEqual(w.cleanup, { endpoint: "EP-contacts-4", trackLeftover: true });
  assert.deepEqual(w.flow.steps.map((x) => `${x.method} ${x.endpoint}`), ["POST EP-contacts-2", "GET EP-contacts-3", "PUT EP-contacts-9", "DELETE EP-contacts-4"]);
  assert.deepEqual(f.cov().loaded.find((x) => x.case === "TC-contacts-20").target, "flow:contact-lifecycle");
  // the flow's sizing sums the steps' p95: 4 x 1 s, at 5 rps (writes), x 1.5
  assert.equal(f.of(21).sizing.preAllocatedVUs, 30);
  // flows that would touch pre-existing data are refused
  const unsafe = [
    { ...FLOW, steps: [{ endpoint: "EP-contacts-3", bind: { param: "id", from: 0, pointer: "/id" } }, FLOW.steps[3]] },
    { ...FLOW, steps: [FLOW.steps[0], { endpoint: "EP-contacts-4" }] },
    { ...FLOW, steps: [FLOW.steps[0], FLOW.steps[3], FLOW.steps[1]] },
    { ...FLOW, steps: [FLOW.steps[0], { endpoint: "EP-contacts-2" }] },
  ];
  for (const [i, fl] of unsafe.entries()) {
    const u = setup({ mode: "full-run", cases: [pc(20, "contact-lifecycle")], overlay: { flows: [fl] } });
    const r = await u.cli("build");
    assert.equal(r.code, 1, `unsafe flow ${i}`);
    assert.match(r.out.problems.join("\n"), [/not a create/, /no bind to a create of this flow/, /the deletes are the last steps/, /creates again/][i]);
  }
});

test("overlay: schema, every value cited against real files, known endpoints, mixes of reads", async () => {
  const mix = { name: "browse", endpoints: [{ endpoint: "EP-contacts-1", weight: 3 }, { endpoint: "EP-contacts-3", weight: 1 }], citation: CITE };
  const s = setup({ cases: [pc(1, "browse"), pc(8, "EP-contacts-8")], overlay: { mixes: [mix], priorities: { "EP-contacts-1": { priority: "p1", citation: CITE } }, data: [{ target: "mix:browse", need: "existing contact ids to read", citation: CITE }], exclude: [{ endpoint: "EP-contacts-8", reason: "search is billed per call", citation: CITE }] } });
  assert.equal((await s.cli("build")).code, 0);
  const m = s.of(1);
  assert.deepEqual([m.kind, m.key, m.weights, m.endpoints], ["mix", "case:TC-contacts-1|smoke", { "EP-contacts-1": 3, "EP-contacts-3": 1 }, ["EP-contacts-1", "EP-contacts-3"]]);
  assert.equal(m.data[0].need, "existing contact ids to read");
  assert.equal(s.cov().loaded[0].target, "mix:browse");
  assert.equal(s.wl().scenarios.length, 1);
  assert.equal(s.reason(8), "overlay-excluded");
  // uncited: the schema refuses it and nothing is built
  const u = setup({ overlay: { thinkTime: { "EP-contacts-1": { ms: 100 } } } });
  const r = await u.cli("build");
  assert.equal(r.code, 1);
  assert.match(r.out.problems.join("\n"), /workload-overlay.json: .*citation/);
  // a citation to a file that does not exist, an escape out of knowledge/, an unknown endpoint, a write in a mix
  const bad = setup({ overlay: {
    priorities: { "EP-contacts-1": { priority: "p1", citation: "knowledge:nope.md" }, "EP-contacts-77": { priority: "p2", citation: CITE } },
    thinkTime: { "EP-contacts-1": { ms: 100, citation: "knowledge:../../../etc/passwd" }, "flow:none": { ms: 1, citation: CITE } },
    mixes: [{ name: "writes", endpoints: [{ endpoint: "EP-contacts-1", weight: 1 }, { endpoint: "EP-contacts-2", weight: 1 }], citation: CITE }],
  } });
  const b = await bad.cli("build");
  assert.equal(b.code, 1);
  const text = b.out.problems.join("\n");
  for (const re of [/no such file under knowledge/, /must stay inside knowledge/, /unknown endpoint EP-contacts-77/, /EP-contacts-2 mutates; writes are loaded only through flows/, /thinkTime\['flow:none'\]: names no endpoint/]) assert.match(text, re);
  assert.throws(() => bad.wl(), /ENOENT/); // nothing written
});

test("budget: the best-ranked cases are kept (case priority, then the overlay's), the rest deferred: budget, never dropped", async () => {
  const s = setup({
    k6: { budget: 2 },
    cases: [pc(1, "EP-contacts-1", { priority: "p3" }), pc(5, "EP-contacts-5", { priority: "p1" }), pc(6, "EP-contacts-6", { priority: "p2" })],
    overlay: { priorities: { "EP-contacts-6": { priority: "p1", citation: CITE } } },
  });
  assert.equal((await s.cli("build")).code, 0);
  assert.equal(s.reason(1), "deferred");
  assert.equal(s.reason(5), "loaded");
  assert.equal(s.reason(6), "loaded");
  assert.match(s.cov().deferred[0].detail, /over k6.budget \(2 load units\)/);
  assert.deepEqual(s.cov().deferred[0].target, "EP-contacts-1");
});

test("check: schemas, a fresh build, ids, open model, dropped_iterations, no writes in readonly; stamps verified", async () => {
  const s = setup();
  assert.equal((await s.cli("build")).code, 0);
  assert.match(workloadUnverified(s.wp), /did not pass/);
  const ok = await s.cli("check");
  assert.equal(ok.code, 0, JSON.stringify(ok.out));
  assert.equal(workloadUnverified(s.wp), null);
  // an approval change after check: the workload's source changed
  markApproved(s.root, ["TC-contacts-1"]);
  assert.match(workloadUnverified(s.wp), /changed after/);
  markApproved(s.root, ["TC-contacts-1", "TC-contacts-3"]);
  assert.match((await s.cli("check")).out.problems.join("\n"), /workload-coverage.json differs from a fresh build/, "the approvals are an input: rebuild");
  assert.equal((await s.cli("build")).code, 0);
  assert.equal((await s.cli("check")).code, 0);
  const registry = readFileSync(s.wp.registry, "utf8");
  // a hand edit
  const wl = s.wl();
  wl.scenarios[0].options.scenarios[wl.scenarios[0].name].rate = 50;
  writeJson(s.wp.workload, wl);
  assert.match(workloadUnverified(s.wp), /changed after/);
  let r = await s.cli("check");
  assert.equal(r.code, 1);
  assert.match(r.out.problems.join("\n"), /workload.json differs from a fresh build/);
  // check never assigns ids, even when inputs changed (a third case approved)
  await s.cli("build");
  const covFile = path.join(s.root, MOD, "testcases", "coverage.json");
  writeFileSync(covFile, JSON.stringify({ cases: [...CASES(), pc(5, "EP-contacts-5")] }));
  markApproved(s.root, ["TC-contacts-1", "TC-contacts-3", "TC-contacts-5"]);
  r = await s.cli("check");
  assert.match(r.out.problems.join("\n"), /differs from a fresh build/);
  assert.equal(readFileSync(s.wp.registry, "utf8"), registry);
  // a missing dropped_iterations threshold fails the schema
  await s.cli("build");
  const w2 = s.wl();
  delete w2.scenarios[0].options.thresholds.dropped_iterations;
  writeJson(s.wp.workload, w2);
  assert.match((await s.cli("check")).out.problems.join("\n"), /dropped_iterations/);

  // the file rules, on a workload a broken build might write
  const sc = (id, extra = {}) => {
    const n = id.split("-").at(-1);
    return { id, key: `case:TC-contacts-${n}|smoke`, case: `TC-contacts-${n}`, name: `smoke-${n}`, type: "smoke", kind: "endpoint", endpoints: ["EP-contacts-1"], mutates: false, thresholds: [{ metric: "dropped_iterations" }], options: { scenarios: { [`smoke-${n}`]: { executor: "constant-arrival-rate" } }, thresholds: { dropped_iterations: ["count<1"] } }, ...extra };
  };
  const reg = { scenarios: { "case:TC-contacts-1|smoke": { id: "K6-contacts-1" }, "case:TC-contacts-2|smoke": { id: "K6-contacts-2" } } };
  const cov = { loaded: [{ case: "TC-contacts-1", ids: ["K6-contacts-9"] }], excluded: [], deferred: [] };
  const probs = workloadRules({ mode: "readonly", scenarios: [
    sc("K6-contacts-1"),
    sc("K6-contacts-1"),
    sc("K6-contacts-2", { mutates: true, options: { scenarios: { "smoke-2": { executor: "ramping-vus" } }, thresholds: {} }, thresholds: [] }),
    sc("K6-contacts-3", { type: "average-load", kind: "flow", mutates: true }),
    sc("K6-contacts-4", { key: "GET /api/v1/contacts|smoke", case: undefined }),
  ] }, cov, reg, [{ id: "EP-contacts-1" }, { id: "EP-contacts-2" }], ["TC-contacts-1", "TC-contacts-2"]).join("\n");
  for (const re of [/K6-contacts-1: listed 2 times/, /key 'case:TC-contacts-1\|smoke' used twice/, /K6-contacts-2: executor ramping-vus is not an arrival-rate/, /K6-contacts-2: no dropped_iterations threshold/, /K6-contacts-2: a write scenario in a readonly workload/, /K6-contacts-3: does not match workload-registry.json/, /K6-contacts-3: a write flow must record mutates and cleanup with trackLeftover/, /K6-contacts-3: average-load in a readonly workload/, /TC-contacts-2 is not accounted for/, /TC-contacts-1 maps to unknown K6-contacts-9/, /K6-contacts-4: not keyed by its approved @performance case/]) assert.match(probs, re);
});

test("paths and readers", async () => {
  const s = setup();
  // --run names a run of this product: the active run, or one with a results folder (D-6)
  assert.equal((await s.cli("paths", "--run", "acme-run-1")).code, 0);
  await assert.rejects(() => s.cli("paths", "--run", "acme-run-0"), /--run acme-run-0 is neither the active run \(acme-run-1\) nor a run of 'acme'/);
  await assert.rejects(() => s.cli("build", "--run", "other-product-run-7"), /is neither the active run/);
  put(s.root, "artifacts/acme/results/acme-run-0/contacts/k6/summary.json", "{}");
  const p = await s.cli("paths", "--run", "acme-run-0");
  assert.equal(p.out.cases, `${MOD}/testcases/coverage.json`);
  assert.equal(p.out.workload, `${MOD}/k6/workload.json`);
  await assert.rejects(() => s.cli("paths", "--run", "../x"), /--run must be a run id/);
  await s.cli("build");
  // the gate reads {scenarios}; an old array is a blocker that names the build
  put(s.root, `${MOD}/k6/workload.json`, JSON.stringify([{ id: "K6-contacts-1" }]));
  const g = gate("acme", "contacts", "k6", { root: s.root, compile: false });
  const findings = readFileSync(path.join(s.root, g.file), "utf8");
  assert.ok(findings.includes("not the script-built shape") && findings.includes("workload.mjs build"), findings);
  assert.equal(g.verdict, "changes-required");
  assert.equal(workloadScenarios(s.wp.workload), null);
});

test("run-config: k6 budget, caps, SLOs and opt-in types are validated and defaulted", () => {
  const base = { product: "acme", target: { url: "https://app.acme.test" }, modules: [{ slug: "contacts", name: "Contacts", nav_path: ["Contacts"] }] };
  assert.deepEqual(validateRunConfig(base).normalized.k6, K6_DEFAULTS);
  const ok = validateRunConfig({ ...base, k6: { budget: 5, caps: { rps: 2.5 }, slo: { p95_ms: 500, error_rate: 0.005 }, modules: { contacts: { types: ["stress", "soak"], slo: { endpoints: { "EP-contacts-1": { p99_ms: 900, rps: 3 } } } } } } });
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.normalized.k6.caps, { rps: 2.5, duration_s: 120, soak_duration_s: 1800 });
  const { errors } = validateRunConfig({ ...base, k6: { budget: 0, max: 1, caps: { rps: 0, duration_s: 1.5, x: 1 }, slo: { p95_ms: 900, p99_ms: 800, error_rate: 1, endpoints: {} }, modules: { contacts: { types: ["smoke", "stress", "stress"], slo: { rps: -1, endpoints: { a: { p95_ms: "fast" } } }, other: 1 }, deals: {} } } });
  for (const e of ["k6.budget:", "k6.max: unknown key", "k6.caps.rps:", "k6.caps.duration_s:", "k6.caps.x: unknown key", "k6.slo.p99_ms: must not be below p95_ms", "k6.slo.error_rate:", "k6.slo.endpoints: unknown key", "k6.modules.contacts.types:", "k6.modules.contacts.slo.rps:", "k6.modules.contacts.slo.endpoints['a'].p95_ms:", "k6.modules.contacts.other: unknown key", "k6.modules.deals: not a module of this run-config"])
    assert.ok(errors.some((x) => x.startsWith(e)), `${e}\n${errors.join("\n")}`);
});

// D-005 flows (S7-F1): a catalogue with nested, foreign and child endpoints; one approved case loads the flow "f".
const FLOW_CATALOGUE = () => [
  ...CATALOGUE(),
  ep(10, "PATCH", "/api/v1/users/{id}", { resource: "users", crud: "update" }),
  ep(11, "PUT", "/api/v1/accounts/{accountId}/contacts/{contactId}"),
  ep(12, "GET", "/api/v1/accounts/{id}", { resource: "accounts" }),
  ep(13, "DELETE", "/api/v1/accounts/{id}", { resource: "accounts" }),
  ep(14, "POST", "/api/v1/contacts/{id}/notes", { resource: "notes" }),
  ep(15, "PUT", "/api/v1/contacts/{id}/notes/{noteId}", { resource: "notes" }),
  ep(16, "DELETE", "/api/v1/contacts/{id}/notes/{noteId}", { resource: "notes" }),
];
const B = (from, pointer = "/id", param = "id") => ({ param, from, pointer });
const flowSetup = (steps, extra = {}) => setup({ mode: "full-run", catalogue: FLOW_CATALOGUE(), cases: [pc(20, "f")], overlay: { flows: [{ name: "f", steps, citations: [CITE] }] }, ...extra });
const E = (n, bind) => ({ endpoint: `EP-contacts-${n}`, ...(bind ? { bind } : {}) });

test("D-005 flows: the five repros (foreign field, unbound child, bind from a read) are refused by build and check", async () => {
  const repros = {
    c1: [[E(2), E(10, B(0, "/ownerId"))], [/step 1: bind 'id' reads \/ownerId of step 0's response, not the created entity's id \/id/, /names an item of \/api\/v1\/users, but step 0 creates in \/api\/v1\/contacts/]],
    c2: [[E(2), E(11, B(0, "/id", "accountId"))], [/step 1: EP-contacts-11 path parameter contactId has no bind to a create of this flow/, /bind 'accountId': .* names an item of \/api\/v1\/accounts/]],
    c3: [[E(2), E(12, B(0, "/accountId")), E(9, B(1, "/primaryContactId"))], [/step 2: bind 'id' comes from step 1 \(EP-contacts-12\), which is not a create of this flow/]],
    d1: [[E(2), E(3, B(0)), E(4, B(1, "/relatedContactId"))], [/step 2: bind 'id' comes from step 1 \(EP-contacts-3\), which is not a create/]],
    d2: [[E(2), E(13, B(0, "/accountId"))], [/step 1: bind 'id' reads \/accountId/, /names an item of \/api\/v1\/accounts/]],
  };
  for (const [name, [steps, res]] of Object.entries(repros)) {
    const s = flowSetup(steps);
    const r = await s.cli("build");
    assert.equal(r.code, 1, `${name} must not build`);
    for (const re of res) assert.match(r.out.problems.join("\n"), re, name);
  }
  // check refuses it too: a valid workload whose flow was hand-edited to bind a foreign field
  const s = flowSetup([E(2), E(9, B(0)), E(4, B(0))]);
  assert.equal((await s.cli("build")).code, 0);
  const wl = s.wl();
  for (const x of wl.scenarios) if (x.kind === "flow") x.flow.steps[1].bind = B(0, "/ownerId");
  writeFileSync(s.wp.workload, JSON.stringify(wl, null, 2) + "\n");
  const c = await s.cli("check");
  assert.equal(c.code, 1);
  assert.match(c.out.problems.join("\n"), /flow 'f' step 1: bind 'id' reads \/ownerId/);
  // more refusals: a child create first, a child bound to the parent's id, a parent deleted before its child
  const more = [
    [[E(14, B(0)), E(4, B(0))], /step 0: EP-contacts-14 \/api\/v1\/contacts\/\{id\}\/notes creates under a parent the flow did not create/],
    [[E(2), E(14, B(0)), E(15, [B(0), B(0, "/id", "noteId")])], /bind 'noteId': .* names an item of \/api\/v1\/contacts\/\{\}\/notes, but step 0 creates in \/api\/v1\/contacts/],
    [[E(2), E(14, B(0)), E(4, B(0)), E(16, [B(0), B(1, "/id", "noteId")])], /step 3: deletes step 1's entity after step 0's: children before their parent/],
    [[E(2), E(4, B(0)), E(3, B(0))], /step 2: comes after a delete/],
  ];
  for (const [steps, re] of more) {
    const r = await flowSetup(steps).cli("build");
    assert.equal(r.code, 1);
    assert.match(r.out.problems.join("\n"), re);
  }
});

test("D-005 flows: create -> read -> update -> delete and parent -> child create -> child delete -> parent delete load", async () => {
  for (const steps of [
    [E(2), E(3, B(0)), E(9, B(0)), E(4, B(0))],
    [E(2), E(14, B(0)), E(15, [B(0), B(1, "/id", "noteId")]), E(16, [B(0), B(1, "/id", "noteId")]), E(4, B(0))],
  ]) {
    const s = flowSetup(steps);
    const r = await s.cli("build");
    assert.equal(r.code, 0, JSON.stringify(r.out.problems));
    assert.equal((await s.cli("check")).code, 0);
    const f = s.of(20);
    assert.deepEqual(f.cleanup, { endpoint: "EP-contacts-4", trackLeftover: true });
    assert.equal(s.reason(20), "loaded");
    assert.deepEqual([...f.endpoints].sort(), [...new Set(steps.map((st) => st.endpoint))].sort());
  }
  // a documented create response id (a catalogue link) is the id pointer; /id is then refused
  const cat = FLOW_CATALOGUE();
  cat[3].links = [{ from: "EP-contacts-2", pointer: "/data/id", param: "id", source: "spec" }];
  const ok = flowSetup([E(2), E(4, B(0, "/data/id"))], { catalogue: cat });
  assert.equal((await ok.cli("build")).code, 0);
  const bad = await flowSetup([E(2), E(4, B(0))], { catalogue: cat }).cli("build");
  assert.match(bad.out.problems.join("\n"), /reads \/id of step 0's response, not the created entity's id \/data\/id/);
});

test("D-7: a write's stress, spike and breakpoint peaks never exceed the write cap (the ramp is scaled down)", async () => {
  // profileFor: a write cap scales the ramp's base to cap / the profile's peak factor; a read keeps 2R / 5R / 10R
  for (const [type, factor] of [["stress", 2], ["spike", 5], ["breakpoint", 10]]) {
    const w = profileFor(type, 5, Infinity, K6_DEFAULTS.caps, 5);
    assert.equal(w.peakRps, 5, type);
    assert.equal(profileFor(type, 5, Infinity, K6_DEFAULTS.caps).peakRps, 5 * factor, type);
  }
  assert.equal(profileFor("stress", 0.01, Infinity, K6_DEFAULTS.caps, 0.01).skip, "rate-limited"); // under 1 per minute
  const cat = CATALOGUE();
  cat[1].rateLimit = { limit: 6, window: "1s", source: "docs" }; // the POST: 50% = 3 rps, write cap 1.5
  const types = ["smoke", "average-load", "stress", "spike", "breakpoint"];
  const cases = [...types.map((type, i) => pc(20 + i, "contact-lifecycle", { type })), pc(8, "EP-contacts-8", { type: "spike" })];
  const s = setup({ mode: "full-run", catalogue: cat, cases, overlay: { flows: [FLOW] }, k6: { modules: { contacts: { types: ["stress", "spike", "breakpoint"] } } } });
  assert.equal((await s.cli("build")).code, 0);
  const writes = s.wl().scenarios.filter((x) => x.mutates);
  assert.deepEqual([...new Set(writes.filter((x) => x.kind === "flow").map((x) => x.type))].sort(), ["average-load", "breakpoint", "smoke", "spike", "stress"]);
  // every type of every write, a query-like POST included (D-057)
  for (const x of writes) {
    assert.ok(Number.isFinite(x.load.writeCapRps), x.key);
    assert.ok(x.load.rps <= x.load.writeCapRps + 1e-9, `${x.key}: peak ${x.load.rps} > write cap ${x.load.writeCapRps}`);
  }
  assert.equal(s.of(22).load.writeCapRps, 1.5); // the flow's stress
  assert.equal(s.of(8).load.rps, 5); // a query-like POST: write cap 5
});

test("D-057: a query-like POST runs at the write cap in every type, its stress peak at least its average; none in readonly", async () => {
  const optIn = ["stress", "spike", "breakpoint", "soak"];
  const all = ["smoke", "average-load", ...optIn];
  const cases = () => all.map((type, i) => pc(30 + i, "EP-contacts-8", { type }));
  const s = setup({ mode: "full-run", cases: cases(), k6: { modules: { contacts: { types: optIn } } } });
  assert.equal((await s.cli("build")).code, 0);
  const q = s.wl().scenarios.filter((x) => x.queryLike);
  assert.deepEqual(q.map((x) => x.type).sort(), [...all].sort());
  for (const x of q) {
    assert.equal(x.load.writeCapRps, 5, x.key);
    assert.ok(x.load.rps <= x.load.writeCapRps + 1e-9 && x.load.averageRps <= x.load.writeCapRps + 1e-9, x.key);
  }
  const of = (t) => q.find((x) => x.type === t).load;
  assert.ok(of("smoke").rps <= of("average-load").rps);
  assert.equal(of("average-load").rps, 5);
  assert.ok(of("stress").rps >= of("average-load").rps, `stress peak ${of("stress").rps} < average ${of("average-load").rps}`);
  const ro = setup({ cases: cases(), k6: { modules: { contacts: { types: optIn } } } });
  assert.equal((await ro.cli("build")).code, 0);
  assert.ok(!ro.wl().scenarios.some((x) => x.queryLike || x.mutates));
  assert.equal(ro.reason(30), "mutating-readonly");
});

// S7-F2: N-1 (a cleanup delete is the created entity's item DELETE), N-2 (a query-like item path), D-6 (the build's run).
const ACTION_CATALOGUE = () => [
  ...FLOW_CATALOGUE(),
  ep(17, "DELETE", "/api/v1/contacts/{id}/assign", { crud: "action" }),
  { ...ep(18, "POST", "/api/v1/contacts/{id}/archive", { crud: "action" }), queryLike: { evidence: "overlay: archive is a filter", source: "overlay" } },
];
const actionSetup = (steps, extra = {}) => flowSetup(steps, { catalogue: ACTION_CATALOGUE(), ...extra });

test("N-1: only a DELETE on the created entity's item path is the flow's cleanup; a sub-path DELETE is a write step", async () => {
  const s = actionSetup([E(2), E(9, B(0)), E(17, B(0))]);
  assert.equal((await s.cli("build")).code, 0);
  assert.equal((await s.cli("check")).code, 0);
  assert.deepEqual(s.of(20).cleanup, { endpoint: null, trackLeftover: true });
  // the sub-path DELETE then the real item DELETE: the item DELETE is the cleanup
  const both = actionSetup([E(2), E(17, B(0)), E(4, B(0))]);
  assert.equal((await both.cli("build")).code, 0, "unassign, then delete");
  assert.equal(both.of(20).cleanup.endpoint, "EP-contacts-4");
  // a sub-path DELETE after the entity's delete acts on a deleted entity; unbound, it would name pre-existing data
  for (const [steps, re] of [
    [[E(2), E(4, B(0)), E(17, B(0))], /step 2: comes after a delete/],
    [[E(2), E(17)], /step 1: EP-contacts-17 path parameter id has no bind to a create of this flow/],
  ]) {
    const r = await actionSetup(steps).cli("build");
    assert.equal(r.code, 1);
    assert.match(r.out.problems.join("\n"), re);
  }
});

test("N-2: a query-like POST on an item path is excluded standalone (full-run and readonly); a collection search stays", async () => {
  const cases = () => [pc(20, "f"), pc(18, "EP-contacts-18"), pc(8, "EP-contacts-8")];
  const s = actionSetup([E(2), E(4, B(0))], { cases: cases() });
  assert.equal((await s.cli("build")).code, 0);
  assert.equal(s.reason(18), "no-safe-data");
  assert.match(s.cov().excluded.find((x) => x.case === "TC-contacts-18").detail, /query-like on an item path/);
  assert.ok(!s.wl().scenarios.some((x) => x.endpoints.includes("EP-contacts-18")));
  assert.equal(s.reason(8), "loaded");
  assert.ok(s.of(8).queryLike && s.of(8).load.rps <= s.of(8).load.writeCapRps + 1e-9);
  const ro = actionSetup([E(2), E(4, B(0))], { mode: "readonly", cases: cases() });
  assert.equal((await ro.cli("build")).code, 0);
  assert.ok(["no-safe-data", "mutating-readonly"].includes(ro.reason(18)));
  assert.ok(!ro.wl().scenarios.some((x) => x.endpoints.includes("EP-contacts-18")));
  // as a step of a flow bound to its create, it is loaded (a write step under the bind rules)
  const flow = actionSetup([E(2), E(18, B(0)), E(4, B(0))]);
  assert.equal((await flow.cli("build")).code, 0);
  assert.equal(flow.reason(20), "loaded");
  assert.ok(flow.of(20).endpoints.includes("EP-contacts-18") && flow.of(20).kind === "flow");
});

test("D-6: check binds the build to its run: a workload built from another run fails check until rebuilt with that run", async () => {
  const s = setup({ mode: "full-run", cases: [pc(20, "contact-lifecycle")], overlay: { flows: [FLOW] } });
  put(s.root, "artifacts/acme/results/acme-run-0/contacts/k6/summary.json", "{}");
  assert.equal((await s.cli("build", "--run", "acme-run-0")).code, 0);
  assert.equal(s.wl().runId, "acme-run-0");
  assert.equal((await s.cli("check", "--run", "acme-run-0")).code, 0);
  // the domain flow passes the active run id: an older run's workload is not accepted whatever its stamp says (G10)
  assert.equal(workloadUnverified(s.wp), null, "stamped for acme-run-0");
  assert.match(workloadUnverified(s.wp, "acme-run-1"), /workload.json was built from run acme-run-0, not acme-run-1, the active run: rebuild with that run/);
  assert.equal(workloadUnverified(s.wp, "acme-run-0"), null);
  const c = await s.cli("check");
  assert.equal(c.code, 1);
  assert.match(c.out.problems.join("\n"), /workload\.json was built from run acme-run-0, not acme-run-1, the run being checked: rebuild with that run \(workload\.mjs build <product> <module> --run acme-run-1\)/);
  assert.match(workloadUnverified(s.wp), /did not pass workload\.mjs check/);
  assert.equal((await s.cli("build")).code, 0);
  assert.equal((await s.cli("check")).code, 0);
  assert.equal(workloadUnverified(s.wp), null);
});

// D-068, decision 16 (2026-10-20): k6 skips known functional failures only. With playwright-api results (this run's, or
// an earlier run's), a case whose endpoint failed or was blocked functionally is excluded (failed-functional, blocked)
// and noted; without results it is load-tested (untested-functional stays retired).
const scen = (n, endpoint, extra = {}) => ({ id: `API-contacts-${n}`, endpoint, type: "functional", ...extra });
function evidence(s, { plan, items, runId = "acme-run-1", recordedAt = "2026-10-20T10:00:00Z", status = "ran" }) {
  writeJson(s.pp.plan, plan);
  put(s.root, `artifacts/acme/results/${runId}/contacts/playwright-api/results.json`, JSON.stringify({ framework: "playwright-api", module: "contacts", runId, mode: "readonly", recordedAt, status, totals: {}, durationMs: 1, items }));
}
const PLAN = () => [scen(1, "EP-contacts-1"), scen(2, "EP-contacts-3"), scen(3, "EP-contacts-5", { blocked: "no producer for path parameter id" }), scen(4, "EP-contacts-6")];
const item = (n, status) => ({ title: `API-contacts-${n} ...`, status, scenarioId: `API-contacts-${n}` });

test("decision 16: a failed endpoint is excluded (failed-functional), a passed one kept, a blocked one excluded (blocked), each noted", async () => {
  const s = setup({ cases: [pc(1, "EP-contacts-1"), pc(3, "EP-contacts-3"), pc(5, "EP-contacts-5"), pc(6, "EP-contacts-6")] });
  evidence(s, { plan: PLAN(), items: [item(1, "failed"), item(2, "passed"), item(3, "skipped"), item(4, "flaky")] });
  const r = await s.cli("build");
  assert.equal(r.code, 0, JSON.stringify(r.out));
  assert.equal(s.reason(1), "failed-functional");
  assert.match(s.cov().excluded.find((x) => x.case === "TC-contacts-1").detail, /EP-contacts-1 failed functionally in run acme-run-1: API-contacts-1/);
  assert.equal(s.reason(3), "loaded", "its playwright-api test passed");
  assert.equal(s.reason(5), "blocked");
  assert.match(s.cov().excluded.find((x) => x.case === "TC-contacts-5").detail, /API-contacts-3 \(no producer for path parameter id\)/);
  assert.equal(s.reason(6), "failed-functional", "flaky counts as failed");
  for (const n of [1, 5, 6]) assert.ok(s.wl().notes.some((x) => x.startsWith(`TC-contacts-${n} is not loaded:`)), `TC-contacts-${n} noted`);
  assert.ok(s.wl().notes.includes("functional evidence: the playwright-api results of run acme-run-1"));
  assert.deepEqual(s.wl().scenarios.map((x) => x.case), ["TC-contacts-3"]);
  // the results are an input: check passes, and a change in them makes the workload stale
  assert.equal((await s.cli("check")).code, 0);
  assert.equal(workloadUnverified(s.wp), null);
  evidence(s, { plan: PLAN(), items: [item(1, "passed"), item(2, "passed"), item(3, "skipped"), item(4, "passed")] });
  assert.match(workloadUnverified(s.wp), /changed after/);
  assert.equal((await s.cli("build")).code, 0);
  assert.equal(s.reason(1), "loaded");
  assert.equal(s.reason(6), "loaded");
});

test("decision 16: no playwright-api results -> every case is load-tested (no untested-functional); not-run results are no evidence", async () => {
  const s = setup({ cases: [pc(1, "EP-contacts-1"), pc(5, "EP-contacts-5")] });
  writeJson(s.pp.plan, PLAN());
  assert.equal((await s.cli("build")).code, 0);
  assert.equal(s.reason(1), "loaded");
  assert.equal(s.reason(5), "loaded", "a plan block without results is not evidence");
  assert.ok(s.wl().notes.some((x) => /no playwright-api results.json for this module in this or an earlier run: every case is load-tested/.test(x)));
  assert.equal(s.cov().inputs.results, null);
  evidence(s, { plan: PLAN(), items: [item(1, "failed")], status: "not-run" });
  assert.equal((await s.cli("build")).code, 0);
  assert.equal(s.reason(1), "loaded");
  assert.ok(s.wl().notes.some((x) => /the playwright-api tests of run acme-run-1 did not run/.test(x)));
});

test("decision 16: an earlier run's results count (the latest recorded); this run's win", async () => {
  const s = setup({ cases: [pc(1, "EP-contacts-1"), pc(3, "EP-contacts-3")] });
  evidence(s, { plan: PLAN(), items: [item(1, "passed"), item(2, "failed")], runId: "acme-run-a", recordedAt: "2026-10-01T10:00:00Z" });
  evidence(s, { plan: PLAN(), items: [item(1, "failed"), item(2, "passed")], runId: "acme-run-0", recordedAt: "2026-10-10T10:00:00Z" });
  assert.equal((await s.cli("build")).code, 0);
  assert.deepEqual([s.reason(1), s.reason(3)], ["failed-functional", "loaded"], "the latest recorded earlier run");
  assert.ok(s.wl().notes.includes("functional evidence: the playwright-api results of run acme-run-0 (an earlier run)"));
  evidence(s, { plan: PLAN(), items: [item(1, "passed"), item(2, "passed")] });
  assert.equal((await s.cli("build")).code, 0);
  assert.deepEqual([s.reason(1), s.reason(3)], ["loaded", "loaded"], "this run's results");
});

test("decision 16: a flow case is excluded only when one of its endpoints failed, not for a plan block on a member", async () => {
  const plan = [scen(1, "EP-contacts-2"), scen(2, "EP-contacts-3", { blocked: "path parameter id needs an entity this run created" }), scen(3, "EP-contacts-9"), scen(4, "EP-contacts-4")];
  const s = setup({ mode: "full-run", cases: [pc(20, "contact-lifecycle")], overlay: { flows: [FLOW] } });
  evidence(s, { plan, items: [item(1, "passed"), item(2, "skipped"), item(3, "passed"), item(4, "passed")] });
  assert.equal((await s.cli("build")).code, 0);
  assert.equal(s.reason(20), "loaded");
  evidence(s, { plan, items: [item(1, "passed"), item(2, "skipped"), item(3, "failed"), item(4, "passed")] });
  assert.equal((await s.cli("build")).code, 0);
  assert.equal(s.reason(20), "failed-functional");
  assert.match(s.cov().excluded.find((x) => x.case === "TC-contacts-20").detail, /EP-contacts-9 failed functionally/);
});
