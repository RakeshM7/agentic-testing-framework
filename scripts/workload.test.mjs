// scripts/workload.mjs and scripts/lib/workload.mjs: the script-built k6 workload (G7).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { main } from "./workload.mjs";
import { gate } from "./gate.mjs";
import { planPaths } from "./lib/api-plan.mjs";
import { writeJson } from "./lib/endpoints.mjs";
import { stampVerified } from "./lib/verified.mjs";
import { mapResults, profileFor, rateLimitRps, sizing, typesFor, workloadPaths, workloadRules, workloadScenarios, workloadUnverified, K6_DEFAULTS } from "./lib/workload.mjs";
import { validateRunConfig } from "./run-config.mjs";
import { put, startRun } from "./test-helpers.mjs";

const MOD = "artifacts/acme/modules/contacts";
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
const sc = (n, endpoint, extra = {}) => ({ id: `API-contacts-${n}`, endpoint: `EP-contacts-${endpoint}`, type: "functional", priority: "p2", title: `scenario ${n}`, ...extra });
const PLAN = () => [
  sc(1, 1, { priority: "p1" }), sc(2, 2), sc(3, 3), sc(4, 4), sc(5, 5), sc(6, 6, { blocked: "needs an admin identity" }), sc(7, 8), sc(9, 9),
  sc(8, 2, { type: "lifecycle", steps: [{ endpoint: "EP-contacts-2" }, { endpoint: "EP-contacts-3" }, { endpoint: "EP-contacts-4" }] }),
  sc(10, 6, { type: "negative", title: "reports 401" }),
];
const RESULTS = (over = {}) => ({
  framework: "playwright-api", module: "contacts", runId: "acme-run-1", mode: "readonly", recordedAt: "2026-10-19T00:00:00Z", status: "ran",
  totals: { total: 0, passed: 0, failed: 0, flaky: 0, skipped: 0 }, durationMs: 0,
  items: [1, 2, 3, 4, 5, 7, 8, 9, 10].map((n) => ({ title: `contacts.spec.ts > API-contacts-${n} scenario ${n} @p2 @functional`, status: over[n] ?? (n === 5 ? "failed" : "passed") })),
});

function setup({ mode = "readonly", k6, catalogue = CATALOGUE(), plan = PLAN(), results = RESULTS(), overlay } = {}) {
  const { root } = startRun({ mode, extra: k6 ? [`k6: ${JSON.stringify(k6)}`] : [] });
  const pp = planPaths(path.join(root, "artifacts/acme"), "contacts");
  writeJson(pp.catalogue, catalogue);
  writeJson(pp.plan, plan);
  writeJson(pp.coverage, { verified: stampVerified({ plan: pp.plan, catalogue: pp.catalogue }) });
  if (results) put(root, "artifacts/acme/results/acme-run-1/contacts/playwright-api/results.json", JSON.stringify(results));
  put(root, "artifacts/acme/knowledge/modules/contacts/notes.md", "# Contacts\nCreating, reading and deleting a contact is the core flow.\n");
  if (overlay) put(root, `${MOD}/k6/workload-overlay.json`, JSON.stringify(overlay));
  const wp = workloadPaths(path.join(root, "artifacts/acme"), "contacts");
  const cli = (cmd, ...rest) => main([cmd, "acme", "contacts", ...rest], { root });
  const wl = () => JSON.parse(readFileSync(wp.workload, "utf8"));
  const cov = () => JSON.parse(readFileSync(wp.coverage, "utf8"));
  const reason = (id) => cov().excluded.find((x) => x.endpoint === `EP-contacts-${id}`)?.reason ?? (cov().loaded.some((x) => x.endpoint === `EP-contacts-${id}`) ? "loaded" : cov().deferred.some((x) => x.endpoint === `EP-contacts-${id}`) ? "deferred" : null);
  return { root, wp, pp, cli, wl, cov, reason };
}
const FLOW = { name: "contact-lifecycle", steps: [{ endpoint: "EP-contacts-2" }, { endpoint: "EP-contacts-3", bind: { param: "id", from: 0, pointer: "/id" } }, { endpoint: "EP-contacts-9", bind: { param: "id", from: 0, pointer: "/id" } }, { endpoint: "EP-contacts-4", bind: { param: "id", from: 0, pointer: "/id" } }], citations: ["knowledge:modules/contacts/notes.md"] };

test("types by mode: readonly smoke only (an opt-in is noted, not an error); full-run smoke + average-load + opt-ins", async () => {
  assert.deepEqual(typesFor("readonly", K6_DEFAULTS, "contacts").types, ["smoke"]);
  const ro = typesFor("readonly", { ...K6_DEFAULTS, modules: { contacts: { types: ["stress"] } } }, "contacts");
  assert.deepEqual(ro.types, ["smoke"]);
  assert.match(ro.notes[0], /opts in stress: ignored, a readonly run gets smoke only/);
  assert.deepEqual(typesFor("full-run", K6_DEFAULTS, "contacts").types, ["smoke", "average-load"]);
  assert.deepEqual(typesFor("full-run", { ...K6_DEFAULTS, modules: { contacts: { types: ["soak", "stress"] } } }, "contacts").types, ["smoke", "average-load", "stress", "soak"]);

  const s = setup({ k6: { modules: { contacts: { types: ["stress", "breakpoint"] } } } });
  const r = await s.cli("build");
  assert.equal(r.code, 0, JSON.stringify(r.out));
  assert.deepEqual([...new Set(s.wl().scenarios.map((x) => x.type))], ["smoke"]);
  assert.ok(s.wl().notes.some((n) => /ignored, a readonly run gets smoke only/.test(n)));
  const f = setup({ mode: "full-run", k6: { modules: { contacts: { types: ["stress", "breakpoint"] } } } });
  assert.equal((await f.cli("build")).code, 0);
  const types = new Set(f.wl().scenarios.map((x) => x.type));
  assert.deepEqual([...types].sort(), ["average-load", "breakpoint", "smoke", "stress"]);
  const ramp = f.wl().scenarios.find((x) => x.type === "stress");
  assert.equal(ramp.executor, "ramping-arrival-rate");
  assert.equal(f.wl().scenarios.find((x) => x.type === "average-load").executor, "constant-arrival-rate");
  // breakpoint thresholds abort the run
  assert.ok(f.wl().scenarios.find((x) => x.key === "GET /api/v1/contacts|breakpoint").options.thresholds["http_req_duration{endpoint:EP-contacts-1}"].every((t) => t.abortOnFail === true));
});

test("the ledger: every catalogue endpoint loaded, excluded with a reason, or deferred; failed and blocked tests exclude", async () => {
  const s = setup();
  assert.equal((await s.cli("build")).code, 0);
  assert.equal(s.reason(1), "loaded");
  assert.equal(s.reason(3), "loaded");
  assert.equal(s.reason(5), "failed-functional");
  assert.equal(s.reason(6), "blocked");
  assert.equal(s.reason(7), "not-planned");
  for (const n of [2, 4, 8, 9]) assert.equal(s.reason(n), "mutating-readonly", `EP-contacts-${n}`);
  assert.equal(s.cov().counts.total, 9);
  assert.equal(s.cov().counts.loaded + s.cov().counts.excluded + s.cov().counts.deferred, 9);
  assert.match(s.cov().excluded.find((x) => x.endpoint === "EP-contacts-5").detail, /API-contacts-5/);

  // a failed lifecycle scenario touches several endpoints: all of them are excluded, and the detail says why
  const a = setup({ results: RESULTS({ 8: "failed" }) });
  assert.equal((await a.cli("build")).code, 0);
  assert.equal(a.reason(3), "failed-functional");
  assert.match(a.cov().excluded.find((x) => x.endpoint === "EP-contacts-3").detail, /ambiguous: API-contacts-8 touches EP-contacts-2, EP-contacts-3, EP-contacts-4, excluded conservatively/);
  // no passing test: untested; no results file at all: untested, with a note
  const u = setup({ results: RESULTS({ 1: "skipped" }) });
  assert.equal((await u.cli("build")).code, 0);
  assert.equal(u.reason(1), "untested-functional");
  const n = setup({ results: null });
  assert.equal((await n.cli("build")).code, 0);
  assert.equal(n.reason(1), "untested-functional");
  assert.ok(n.wl().notes.some((x) => /no playwright-api results.json for run acme-run-1/.test(x)));
  assert.equal(n.wl().scenarios.length, 0);
  assert.equal(workloadScenarios(n.wp.workload).length, 0);
});

test("results map to plan scenarios by the one API id in the title; anything else is unmapped", () => {
  const ids = new Set(["API-contacts-1", "API-contacts-12"]);
  const r = mapResults({ items: [
    { title: "a > API-contacts-1 list @p1", status: "passed" },
    { title: "API-contacts-12 x", status: "flaky" },
    { title: "API-contacts-1 and API-contacts-12", status: "failed" },
    { title: "API-contacts-sub-1 other module", status: "failed" },
    { title: "XAPI-contacts-1 lookalike", status: "failed" },
    { title: "API-contacts-99 unknown", status: "failed" },
  ] }, "contacts", ids);
  assert.equal(r.byScenario.get("API-contacts-1"), "passed");
  assert.equal(r.byScenario.get("API-contacts-12"), "failed"); // flaky counts as failed
  assert.equal(r.unmapped.length, 4);
});

test("stable K6 ids: keyed by endpoint key + type, never shifted by input changes", async () => {
  const s = setup();
  await s.cli("build");
  const before = Object.fromEntries(s.wl().scenarios.map((x) => [x.key, x.id]));
  assert.deepEqual(Object.keys(before).sort(), ["GET /api/v1/contacts/{id}|smoke", "GET /api/v1/contacts|smoke"]);
  for (const x of s.wl().scenarios) assert.equal(x.name, `smoke-${x.id.split("-").at(-1)}`);
  // EP-contacts-5 starts passing: a new key gets the next id, the old ones keep theirs
  put(s.root, "artifacts/acme/results/acme-run-1/contacts/playwright-api/results.json", JSON.stringify(RESULTS({ 5: "passed" })));
  await s.cli("build");
  const after = Object.fromEntries(s.wl().scenarios.map((x) => [x.key, x.id]));
  for (const [k, id] of Object.entries(before)) assert.equal(after[k], id);
  assert.equal(after["GET /api/v1/tags|smoke"], "K6-contacts-3");
  // it fails again: gone, and back with the same id
  put(s.root, "artifacts/acme/results/acme-run-1/contacts/playwright-api/results.json", JSON.stringify(RESULTS()));
  await s.cli("build");
  assert.equal(JSON.parse(readFileSync(s.wp.registry, "utf8")).scenarios["GET /api/v1/tags|smoke"].status, "gone");
  put(s.root, "artifacts/acme/results/acme-run-1/contacts/playwright-api/results.json", JSON.stringify(RESULTS({ 5: "passed" })));
  await s.cli("build");
  assert.equal(s.wl().scenarios.find((x) => x.key === "GET /api/v1/tags|smoke").id, "K6-contacts-3");
});

test("Little's law sizing and the dropped_iterations threshold on every scenario", async () => {
  assert.deepEqual(sizing(10, 1), { peakRps: 10, expectedIterationS: 1, headroom: 1.5, preAllocatedVUs: 15, maxVUs: 30 });
  assert.equal(sizing(1, 0.2).preAllocatedVUs, 1);
  const f = setup({ mode: "full-run", k6: { modules: { contacts: { slo: { endpoints: { "GET /api/v1/contacts": { p95_ms: 400 } } } } } }, overlay: { thinkTime: { "EP-contacts-1": { ms: 600, citation: "knowledge:modules/contacts/notes.md" } } } });
  assert.equal((await f.cli("build")).code, 0);
  const avg = f.wl().scenarios.find((x) => x.key === "GET /api/v1/contacts|average-load");
  // 10 rps x (0.4 s p95 + 0.6 s think) x 1.5
  assert.deepEqual(avg.sizing, { peakRps: 10, expectedIterationS: 1, headroom: 1.5, preAllocatedVUs: 15, maxVUs: 30 });
  assert.deepEqual(avg.options.scenarios[avg.name], { executor: "constant-arrival-rate", rate: 10, timeUnit: "1s", duration: "120s", preAllocatedVUs: 15, maxVUs: 30 });
  assert.equal(avg.thinkTimeMs, 600);
  // 10 rps x 120 s = 1200 iterations -> count<12; smoke: 30 iterations -> count<1
  assert.deepEqual(avg.options.thresholds.dropped_iterations, ["count<12"]);
  assert.deepEqual(f.wl().scenarios.find((x) => x.key === "GET /api/v1/contacts|smoke").options.thresholds.dropped_iterations, ["count<1"]);
  for (const x of f.wl().scenarios) assert.ok(x.thresholds.some((t) => t.metric === "dropped_iterations"), x.id);
  const smoke = f.wl().scenarios.find((x) => x.key === "GET /api/v1/contacts|smoke");
  assert.deepEqual(smoke.options.scenarios[smoke.name], { executor: "constant-arrival-rate", rate: 1, timeUnit: "1s", duration: "30s", preAllocatedVUs: 2, maxVUs: 4 });
});

test("caps: half a documented rate limit for every type, else 10 rps for 2 min; a write gets half the read cap", async () => {
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
  const f = setup({ mode: "full-run", catalogue: cat, results: RESULTS({ 5: "passed" }), k6: { modules: { contacts: { types: ["stress"] } } }, overlay: { flows: [FLOW] } });
  assert.equal((await f.cli("build")).code, 0, "build");
  const by = (k) => f.wl().scenarios.find((x) => x.key === k);
  assert.equal(by("GET /api/v1/contacts|average-load").options.scenarios[by("GET /api/v1/contacts|average-load").name].rate, 5);
  assert.equal(by("GET /api/v1/contacts|average-load").load.capSource, "rate-limit");
  assert.equal(by("GET /api/v1/contacts|stress"), undefined); // 2 x 5 capped at 5: no headroom
  assert.ok(f.cov().skippedTypes.some((x) => x.unit === "GET /api/v1/contacts" && x.type === "stress" && x.reason === "rate-limited"));
  const item = by("GET /api/v1/contacts/{id}|average-load").options.scenarios;
  assert.deepEqual([Object.values(item)[0].rate, Object.values(item)[0].timeUnit], [30, "1m"]);
  assert.equal(f.reason(5), "rate-limited");
  // without a limit: 10 rps; the write flow (create + update + delete) gets half, also capped by the item's rate limit
  const g = setup({ mode: "full-run", overlay: { flows: [FLOW] } });
  assert.equal((await g.cli("build")).code, 0);
  const avg = g.wl().scenarios.find((x) => x.key === "GET /api/v1/contacts|average-load");
  assert.deepEqual([avg.load.averageRps, avg.load.durationS, avg.load.capSource], [10, 120, "default"]);
  const flow = g.wl().scenarios.find((x) => x.key === "flow:contact-lifecycle|average-load");
  assert.deepEqual([flow.load.averageRps, flow.load.capSource], [5, "default-write-half"]);
  assert.equal(f.wl().scenarios.find((x) => x.key === "flow:contact-lifecycle|average-load").load.averageRps, 0.5);
  // an SLO rps overrides the write half-cap, never 50% of a rate limit
  const h = setup({ mode: "full-run", overlay: { flows: [FLOW] }, k6: { caps: { rps: 4 }, modules: { contacts: { slo: { rps: 8 } } } } });
  assert.equal((await h.cli("build")).code, 0);
  assert.equal(h.wl().scenarios.find((x) => x.key === "flow:contact-lifecycle|average-load").load.averageRps, 8);
});

test("thresholds from the SLO (global < module < endpoint) or assumed p95 < 1000 ms and error rate < 1%", async () => {
  const a = setup();
  await a.cli("build");
  const t = a.wl().scenarios.find((x) => x.key === "GET /api/v1/contacts|smoke").thresholds;
  assert.deepEqual(t.filter((x) => x.stat !== "dropped-iterations").map((x) => [x.stat, x.expr, x.source, x.assumed]), [["p95", "p(95)<1000", "assumed", true], ["error-rate", "rate<0.01", "assumed", true]]);
  const s = setup({ k6: { slo: { p95_ms: 900, error_rate: 0.02 }, modules: { contacts: { slo: { p95_ms: 700, endpoints: { "EP-contacts-1": { p99_ms: 1500 } } } } } } });
  assert.equal((await s.cli("build")).code, 0);
  const one = s.wl().scenarios.find((x) => x.key === "GET /api/v1/contacts|smoke");
  assert.deepEqual(one.thresholds.filter((x) => x.stat !== "dropped-iterations").map((x) => [x.stat, x.expr, x.source, x.assumed]), [["p95", "p(95)<700", "slo:module", false], ["p99", "p(99)<1500", "slo:endpoint", false], ["error-rate", "rate<0.02", "slo:global", false]]);
  assert.deepEqual(one.options.thresholds["http_req_duration{endpoint:EP-contacts-1}"], ["p(95)<700", "p(99)<1500"]);
  // an endpoint SLO key that names nothing is a problem, not silently ignored
  const bad = setup({ k6: { modules: { contacts: { slo: { endpoints: { "GET /nope": { p95_ms: 1 } } } } } } });
  const r = await bad.cli("build");
  assert.equal(r.code, 1);
  assert.match(r.out.problems.join("\n"), /slo.endpoints\['GET \/nope'\]: no endpoint/);
});

test("writes: excluded in readonly, loaded in full-run only through a cited flow on run-created entities", async () => {
  const ro = setup({ overlay: { flows: [FLOW] } });
  assert.equal((await ro.cli("build")).code, 0);
  assert.ok(ro.wl().scenarios.every((x) => !x.mutates));
  assert.equal(ro.reason(2), "mutating-readonly");
  // full-run, no flow: no-safe-data; the query-like POST is loaded without a flow, at the write cap (D-057)
  const nf = setup({ mode: "full-run" });
  assert.equal((await nf.cli("build")).code, 0);
  for (const n of [2, 4, 9]) assert.equal(nf.reason(n), "no-safe-data");
  const q = nf.wl().scenarios.find((x) => x.key === "POST /api/v1/contacts/search|smoke");
  assert.deepEqual([q.mutates, q.queryLike, q.load.rps, q.load.averageRps, q.load.capSource], [true, true, 1, 5, "default-write-half"]);
  // with the flow: loaded, mutates, cleanup by the delete step, trackLeftover
  const f = setup({ mode: "full-run", overlay: { flows: [FLOW] } });
  assert.equal((await f.cli("build")).code, 0);
  const w = f.wl().scenarios.find((x) => x.key === "flow:contact-lifecycle|smoke");
  assert.equal(w.mutates, true);
  assert.deepEqual(w.cleanup, { endpoint: "EP-contacts-4", trackLeftover: true });
  assert.deepEqual(w.flow.steps.map((x) => `${x.method} ${x.endpoint}`), ["POST EP-contacts-2", "GET EP-contacts-3", "PUT EP-contacts-9", "DELETE EP-contacts-4"]);
  for (const n of [2, 4, 9]) assert.equal(f.reason(n), "loaded");
  // the flow's sizing sums the steps' p95: 4 x 1 s, at 5 rps (writes), x 1.5
  assert.equal(f.wl().scenarios.find((x) => x.key === "flow:contact-lifecycle|average-load").sizing.preAllocatedVUs, 30);
  // a flow step that failed its functional tests: the flow does not load, the other writes say why
  const bad = setup({ mode: "full-run", overlay: { flows: [FLOW] }, results: RESULTS({ 9: "failed" }) });
  assert.equal((await bad.cli("build")).code, 0);
  assert.equal(bad.reason(9), "failed-functional");
  assert.equal(bad.reason(2), "no-safe-data");
  assert.match(bad.cov().excluded.find((x) => x.endpoint === "EP-contacts-2").detail, /flow 'contact-lifecycle' is not loaded: EP-contacts-9 failed-functional/);
  // flows that would touch pre-existing data are refused
  const unsafe = [
    { ...FLOW, steps: [{ endpoint: "EP-contacts-3", bind: { param: "id", from: 0, pointer: "/id" } }, FLOW.steps[3]] },
    { ...FLOW, steps: [FLOW.steps[0], { endpoint: "EP-contacts-4" }] },
    { ...FLOW, steps: [FLOW.steps[0], FLOW.steps[3], FLOW.steps[1]] },
    { ...FLOW, steps: [FLOW.steps[0], { endpoint: "EP-contacts-2" }] },
  ];
  for (const [i, fl] of unsafe.entries()) {
    const u = setup({ mode: "full-run", overlay: { flows: [fl] } });
    const r = await u.cli("build");
    assert.equal(r.code, 1, `unsafe flow ${i}`);
    assert.match(r.out.problems.join("\n"), [/not a create/, /no bind to a create of this flow/, /the deletes are the last steps/, /creates again/][i]);
  }
});

test("overlay: schema, every value cited against real files, known endpoints, mixes of reads", async () => {
  const cite = "knowledge:modules/contacts/notes.md";
  const mix = { name: "browse", endpoints: [{ endpoint: "EP-contacts-1", weight: 3 }, { endpoint: "EP-contacts-3", weight: 1 }], citation: cite };
  const s = setup({ overlay: { mixes: [mix], priorities: { "EP-contacts-1": { priority: "p1", citation: cite } }, data: [{ target: "mix:browse", need: "existing contact ids to read", citation: cite }], exclude: [{ endpoint: "EP-contacts-8", reason: "search is billed per call", citation: cite }] } });
  assert.equal((await s.cli("build")).code, 0);
  const m = s.wl().scenarios.find((x) => x.key === "mix:browse|smoke");
  assert.deepEqual([m.kind, m.weights, m.endpoints], ["mix", { "EP-contacts-1": 3, "EP-contacts-3": 1 }, ["EP-contacts-1", "EP-contacts-3"]]);
  assert.equal(m.data[0].need, "existing contact ids to read");
  assert.equal(s.wl().scenarios.length, 1); // members load only through the mix
  assert.equal(s.reason(8), "overlay-excluded");
  // uncited: the schema refuses it and nothing is built
  const u = setup({ overlay: { thinkTime: { "EP-contacts-1": { ms: 100 } } } });
  const r = await u.cli("build");
  assert.equal(r.code, 1);
  assert.match(r.out.problems.join("\n"), /workload-overlay.json: .*citation/);
  // a citation to a file that does not exist, an escape out of knowledge/, an unknown endpoint, a write in a mix
  const bad = setup({ overlay: {
    priorities: { "EP-contacts-1": { priority: "p1", citation: "knowledge:nope.md" }, "EP-contacts-77": { priority: "p2", citation: cite } },
    thinkTime: { "EP-contacts-1": { ms: 100, citation: "knowledge:../../../etc/passwd" }, "flow:none": { ms: 1, citation: cite } },
    mixes: [{ name: "writes", endpoints: [{ endpoint: "EP-contacts-1", weight: 1 }, { endpoint: "EP-contacts-2", weight: 1 }], citation: cite }],
  } });
  const b = await bad.cli("build");
  assert.equal(b.code, 1);
  const text = b.out.problems.join("\n");
  for (const re of [/no such file under knowledge/, /must stay inside knowledge/, /unknown endpoint EP-contacts-77/, /EP-contacts-2 mutates; writes are loaded only through flows/, /thinkTime\['flow:none'\]: names no endpoint/]) assert.match(text, re);
  assert.throws(() => bad.wl(), /ENOENT/); // nothing written
});

test("budget: the best-ranked load units are kept, the rest deferred: budget, never dropped", async () => {
  const s = setup({ mode: "full-run", k6: { budget: 1 }, results: RESULTS({ 5: "passed" }), overlay: { priorities: { "EP-contacts-5": { priority: "p1", citation: "knowledge:modules/contacts/notes.md" }, "EP-contacts-1": { priority: "p3", citation: "knowledge:modules/contacts/notes.md" } } } });
  assert.equal((await s.cli("build")).code, 0);
  assert.equal(s.reason(1), "deferred");
  assert.equal(s.reason(5), "loaded");
  assert.match(s.cov().deferred[0].detail, /over k6.budget \(1 load units\)/);
});

test("check: schemas, a fresh build, ids, open model, dropped_iterations, no writes in readonly; stamps verified", async () => {
  const s = setup();
  assert.equal((await s.cli("build")).code, 0);
  assert.match(workloadUnverified(s.wp), /did not pass/);
  const ok = await s.cli("check");
  assert.equal(ok.code, 0, JSON.stringify(ok.out));
  assert.equal(workloadUnverified(s.wp), null);
  const registry = readFileSync(s.wp.registry, "utf8");
  // a hand edit
  const wl = s.wl();
  wl.scenarios[0].options.scenarios[wl.scenarios[0].name].rate = 50;
  writeJson(s.wp.workload, wl);
  assert.match(workloadUnverified(s.wp), /changed after/);
  let r = await s.cli("check");
  assert.equal(r.code, 1);
  assert.match(r.out.problems.join("\n"), /workload.json differs from a fresh build/);
  // check never assigns ids, even when inputs changed
  await s.cli("build");
  put(s.root, "artifacts/acme/results/acme-run-1/contacts/playwright-api/results.json", JSON.stringify(RESULTS({ 5: "passed" })));
  r = await s.cli("check");
  assert.match(r.out.problems.join("\n"), /differs from a fresh build/);
  assert.equal(readFileSync(s.wp.registry, "utf8"), registry);
  // a missing dropped_iterations threshold fails the schema
  await s.cli("build");
  const w2 = s.wl();
  delete w2.scenarios[0].options.thresholds.dropped_iterations;
  writeJson(s.wp.workload, w2);
  assert.match((await s.cli("check")).out.problems.join("\n"), /dropped_iterations/);
  // an unverified plan
  await s.cli("build");
  writeFileSync(s.pp.plan, readFileSync(s.pp.plan, "utf8") + " ");
  assert.match((await s.cli("check")).out.problems.join("\n"), /the API plan is not verified/);

  // the file rules, on a workload a broken build might write
  const sc = (id, extra = {}) => ({ id, key: `k${id}`, name: `smoke-${id.split("-").at(-1)}`, type: "smoke", kind: "endpoint", endpoints: ["EP-contacts-1"], mutates: false, thresholds: [{ metric: "dropped_iterations" }], options: { scenarios: { [`smoke-${id.split("-").at(-1)}`]: { executor: "constant-arrival-rate" } }, thresholds: { dropped_iterations: ["count<1"] } }, ...extra });
  const reg = { scenarios: { "kK6-contacts-1": { id: "K6-contacts-1" }, "kK6-contacts-2": { id: "K6-contacts-2" } } };
  const cov = { loaded: [{ endpoint: "EP-contacts-1", ids: ["K6-contacts-9"] }], excluded: [], deferred: [] };
  const probs = workloadRules({ mode: "readonly", scenarios: [
    sc("K6-contacts-1"),
    sc("K6-contacts-1"),
    sc("K6-contacts-2", { mutates: true, options: { scenarios: { "smoke-2": { executor: "ramping-vus" } }, thresholds: {} }, thresholds: [] }),
    sc("K6-contacts-3", { type: "average-load", kind: "flow", mutates: true }),
  ] }, cov, reg, [{ id: "EP-contacts-1" }, { id: "EP-contacts-2" }]).join("\n");
  for (const re of [/K6-contacts-1: listed 2 times/, /key 'kK6-contacts-1' used twice/, /K6-contacts-2: executor ramping-vus is not an arrival-rate/, /K6-contacts-2: no dropped_iterations threshold/, /K6-contacts-2: a write scenario in a readonly workload/, /K6-contacts-3: does not match workload-registry.json/, /K6-contacts-3: a write flow must record mutates and cleanup with trackLeftover/, /K6-contacts-3: average-load in a readonly workload/, /EP-contacts-2 is not accounted for/, /maps to unknown K6-contacts-9/]) assert.match(probs, re);
});

test("paths and readers", async () => {
  const s = setup({ results: null });
  // --run names a run of this product: the active run, or one with playwright-api results for the module (D-6)
  assert.equal((await s.cli("paths", "--run", "acme-run-1")).code, 0);
  await assert.rejects(() => s.cli("paths", "--run", "acme-run-0"), /--run acme-run-0 is neither the active run \(acme-run-1\) nor a run of 'acme' with playwright-api results for contacts/);
  await assert.rejects(() => s.cli("build", "--run", "other-product-run-7"), /is neither the active run/);
  put(s.root, "artifacts/acme/results/acme-run-0/contacts/playwright-api/results.json", JSON.stringify(RESULTS()));
  const p = await s.cli("paths", "--run", "acme-run-0");
  assert.equal(p.out.results, "artifacts/acme/results/acme-run-0/contacts/playwright-api/results.json");
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

// D-005 flows (S7-F1): a catalogue with nested, foreign and child endpoints, all planned and passing.
const CITE = "knowledge:modules/contacts/notes.md";
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
const FLOW_PLAN = () => [...PLAN(), ...[10, 11, 12, 13, 14, 15, 16].map((n) => sc(n + 10, n))];
const FLOW_RESULTS = () => ({ ...RESULTS(), items: FLOW_PLAN().map((s) => ({ title: `contacts.spec.ts > ${s.id} ${s.title}`, status: "passed" })) });
const B = (from, pointer = "/id", param = "id") => ({ param, from, pointer });
const flowSetup = (steps, extra = {}) => setup({ mode: "full-run", catalogue: FLOW_CATALOGUE(), plan: FLOW_PLAN(), results: FLOW_RESULTS(), overlay: { flows: [{ name: "f", steps, citations: [CITE] }] }, ...extra });
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
    const f = s.wl().scenarios.find((x) => x.kind === "flow");
    assert.deepEqual(f.cleanup, { endpoint: "EP-contacts-4", trackLeftover: true });
    for (const st of steps) assert.equal(s.reason(Number(st.endpoint.split("-").at(-1))), "loaded");
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
  const s = setup({ mode: "full-run", catalogue: cat, overlay: { flows: [FLOW] }, k6: { modules: { contacts: { types: ["stress", "spike", "breakpoint"] } } } });
  assert.equal((await s.cli("build")).code, 0);
  const writes = s.wl().scenarios.filter((x) => x.mutates);
  assert.deepEqual([...new Set(writes.filter((x) => x.kind === "flow").map((x) => x.type))].sort(), ["average-load", "breakpoint", "smoke", "spike", "stress"]);
  // every type of every write, a query-like POST's average-load included (D-057)
  for (const x of writes) {
    assert.ok(Number.isFinite(x.load.writeCapRps), x.key);
    assert.ok(x.load.rps <= x.load.writeCapRps + 1e-9, `${x.key}: peak ${x.load.rps} > write cap ${x.load.writeCapRps}`);
  }
  assert.equal(writes.find((x) => x.key === "flow:contact-lifecycle|stress").load.writeCapRps, 1.5);
  assert.equal(writes.find((x) => x.key === "POST /api/v1/contacts/search|spike").load.rps, 5); // a query-like POST: write cap 5
});

test("D-057: a query-like POST runs at the write cap in every type, its stress peak at least its average; none in readonly", async () => {
  const types = ["stress", "spike", "breakpoint", "soak"];
  const s = setup({ mode: "full-run", k6: { modules: { contacts: { types } } } });
  assert.equal((await s.cli("build")).code, 0);
  const q = s.wl().scenarios.filter((x) => x.queryLike);
  assert.deepEqual(q.map((x) => x.type).sort(), ["average-load", "breakpoint", "smoke", "soak", "spike", "stress"]);
  for (const x of q) {
    assert.equal(x.load.writeCapRps, 5, x.key);
    assert.ok(x.load.rps <= x.load.writeCapRps + 1e-9 && x.load.averageRps <= x.load.writeCapRps + 1e-9, x.key);
  }
  const of = (t) => q.find((x) => x.type === t).load;
  assert.ok(of("smoke").rps <= of("average-load").rps);
  assert.equal(of("average-load").rps, 5);
  assert.ok(of("stress").rps >= of("average-load").rps, `stress peak ${of("stress").rps} < average ${of("average-load").rps}`);
  const ro = setup({ k6: { modules: { contacts: { types } } } });
  assert.equal((await ro.cli("build")).code, 0);
  assert.ok(!ro.wl().scenarios.some((x) => x.queryLike || x.mutates));
  assert.equal(ro.reason(8), "mutating-readonly");
});

// S7-F2: N-1 (a cleanup delete is the created entity's item DELETE), N-2 (a query-like item path), D-6 (the build's run).
const ACTION_CATALOGUE = () => [
  ...FLOW_CATALOGUE(),
  ep(17, "DELETE", "/api/v1/contacts/{id}/assign", { crud: "action" }),
  { ...ep(18, "POST", "/api/v1/contacts/{id}/archive", { crud: "action" }), queryLike: { evidence: "overlay: archive is a filter", source: "overlay" } },
];
const ACTION_PLAN = () => [...FLOW_PLAN(), sc(27, 17), sc(28, 18)];
const actionSetup = (steps, extra = {}) => flowSetup(steps, { catalogue: ACTION_CATALOGUE(), plan: ACTION_PLAN(), results: { ...RESULTS(), items: ACTION_PLAN().map((s) => ({ title: `contacts.spec.ts > ${s.id} ${s.title}`, status: "passed" })) }, ...extra });

test("N-1: only a DELETE on the created entity's item path is the flow's cleanup; a sub-path DELETE is a write step", async () => {
  const s = actionSetup([E(2), E(9, B(0)), E(17, B(0))]);
  assert.equal((await s.cli("build")).code, 0);
  assert.equal((await s.cli("check")).code, 0);
  assert.deepEqual(s.wl().scenarios.find((x) => x.kind === "flow").cleanup, { endpoint: null, trackLeftover: true });
  // the sub-path DELETE then the real item DELETE: the item DELETE is the cleanup
  const both = actionSetup([E(2), E(17, B(0)), E(4, B(0))]);
  assert.equal((await both.cli("build")).code, 0, "unassign, then delete");
  assert.equal(both.wl().scenarios.find((x) => x.kind === "flow").cleanup.endpoint, "EP-contacts-4");
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
  const s = actionSetup([E(2), E(4, B(0))]);
  assert.equal((await s.cli("build")).code, 0);
  assert.equal(s.reason(18), "no-safe-data");
  assert.match(s.cov().excluded.find((x) => x.endpoint === "EP-contacts-18").detail, /query-like on an item path/);
  assert.ok(!s.wl().scenarios.some((x) => x.endpoints.includes("EP-contacts-18")));
  assert.equal(s.reason(8), "loaded");
  for (const x of s.wl().scenarios.filter((y) => y.endpoints.includes("EP-contacts-8"))) assert.ok(x.queryLike && x.load.rps <= x.load.writeCapRps + 1e-9, x.key);
  const ro = actionSetup([E(2), E(4, B(0))], { mode: "readonly" });
  assert.equal((await ro.cli("build")).code, 0);
  assert.ok(["no-safe-data", "mutating-readonly"].includes(ro.reason(18)));
  assert.ok(!ro.wl().scenarios.some((x) => x.endpoints.includes("EP-contacts-18")));
  // as a step of a flow bound to its create, it is loaded (a write step under the bind rules)
  const flow = actionSetup([E(2), E(18, B(0)), E(4, B(0))]);
  assert.equal((await flow.cli("build")).code, 0);
  assert.equal(flow.reason(18), "loaded");
  assert.ok(flow.wl().scenarios.filter((x) => x.endpoints.includes("EP-contacts-18")).every((x) => x.kind === "flow"));
});

test("D-6: check binds the build to its run: a workload built from another run fails check until rebuilt with that run", async () => {
  const s = setup({ mode: "full-run", overlay: { flows: [FLOW] } });
  put(s.root, "artifacts/acme/results/acme-run-0/contacts/playwright-api/results.json", JSON.stringify({ ...RESULTS(), runId: "acme-run-0" }));
  assert.equal((await s.cli("build", "--run", "acme-run-0")).code, 0);
  assert.equal(s.wl().runId, "acme-run-0");
  assert.equal((await s.cli("check", "--run", "acme-run-0")).code, 0);
  const c = await s.cli("check");
  assert.equal(c.code, 1);
  assert.match(c.out.problems.join("\n"), /workload\.json was built from run acme-run-0, not acme-run-1, the run being checked: rebuild with that run \(workload\.mjs build <product> <module> --run acme-run-1\)/);
  assert.match(workloadUnverified(s.wp), /did not pass workload\.mjs check/);
  assert.equal((await s.cli("build")).code, 0);
  assert.equal((await s.cli("check")).code, 0);
  assert.equal(workloadUnverified(s.wp), null);
});
