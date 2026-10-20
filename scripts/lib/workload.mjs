// A module's k6 load workload: artifacts/<product>/modules/<m>/k6/ (docs/conventions.md "Script-built agents", D-049,
// variant A: the script builds, the k6-workload-designer only overlays cited judgments).
//
//   workload.json            the scenarios (schema workload) -- written only by build()
//   workload-coverage.json   every human-approved @performance test case: loaded (with its K6 id), excluded with a
//                            reason, or deferred: budget (schema workload-coverage); `verified` is stamped by check()
//   workload-registry.json   scenario key -> K6 id, assigned once and never reused (lib/registry.mjs)
//   workload-overlay.json    the designer's cited judgments (schema workload-overlay) -- the only file the agent writes
//
// Inputs: the human-approved @performance test cases (testcases/coverage.json + approvals.json, D-053: each names an
// endpoint EP id or a user flow, a load type, a target rate and optionally an SLO), the endpoint catalogue of the
// api-discovery stage (api/discovered-endpoints.json: rateLimit, safeMethod, queryLike, mutates), the run-config's k6
// section (slo, modules.<m>.types, caps, budget), the run's mode and the overlay. The workload is built ONLY from the
// approved @performance cases (D-068, superseding D-057's catalogue-wide workload; D-057's caps below stay);
// k6 no longer needs playwright-api (decision 5), but known functional failures are skipped (decision 16): when the
// module has playwright-api results (this run's, else the latest recorded earlier run's), mapped to endpoints through
// the API plan's scenario ids, a case whose endpoint failed or was blocked functionally is not loaded. Without results,
// every case is load-tested.
// Never sends a request and never runs k6.
//
// Rules enforced here (not in prompts):
//   - one load unit per approved @performance case: its endpoint, or the overlay flow or mix its flow names; a case
//     naming an endpoint the catalogue lacks (unknown-endpoint) or a flow no overlay flow or mix resolves
//     (unresolved-flow) is excluded with that reason and noted, never dropped silently
//   - the case's type, capped (caseType): readonly -> smoke; an opt-in type the run-config does not opt in ->
//     average-load; each cap noted. Its rate: the case's target rps, never above the caps below. Its SLO: the case's
//     fields over k6.slo's, field by field; a field neither gives is the assumed default, marked assumed
//   - test types by mode: readonly -> smoke; full-run -> smoke + average-load, plus stress/spike/soak/breakpoint only
//     when k6.modules.<m>.types opts in (an opt-in under readonly is ignored with a note, never an error)
//   - open model only: constant-arrival-rate (smoke, average-load, soak), ramping-arrival-rate (stress, spike,
//     breakpoint)
//   - Little's law: preAllocatedVUs = ceil(peak rps x expected iteration seconds x HEADROOM), maxVUs = preAllocatedVUs
//     x MAX_VUS_FACTOR; the expected iteration time is the sum of the requests' p95 (SLO, else the assumed 1000 ms)
//     plus the cited think time
//   - every scenario has a dropped_iterations threshold: count < max(1, ceil(1% of the planned iterations))
//   - caps: a documented rate limit -> at most 50% of it, for every type; otherwise average-load runs at k6.caps.rps
//     (10) for k6.caps.duration_s (120 s); a write gets half the read cap unless an SLO gives its rps, and that write
//     cap holds at every peak: a write's stress, spike and breakpoint ramps are scaled down to it (profileFor); a
//     query-like POST (full-run only, no flow) runs at the write cap in every type, average-load included
//   - thresholds from k6.slo (global < module < endpoint, field by field), else p95 < 1000 ms and error rate < 1%,
//     each marked assumed
//   - writes: excluded in readonly (mutating-readonly); in full-run only through cited overlay flows that start with a
//     create and touch only the entities the flow created: every path parameter bound to a create's id pointer
//     (flowProblems; else no-safe-data); a flow records its cleanup and trackLeftover for the script generator (D-005)
//   - known functional failures (decision 16, the pre-S2b D-057 mapping): a case naming an endpoint that a failed (or
//     flaky) playwright-api scenario touches -> failed-functional (a failed scenario touching several endpoints
//     excludes all of them: ambiguous, conservative); an endpoint whose own functional scenarios are all blocked in
//     the plan and none passed -> blocked. A flow or mix case is excluded only when one of its endpoints failed (a
//     flow binds its own data, so a plan block on a member does not apply). Each is noted. No results -> loaded
//   - k6.budget counts load units (cases): the best-ranked by case priority, then the overlay's, then id; the rest
//     deferred: budget
//   - stable ids K6-<m>-<n> from the registry, keyed "case:<TC id>|<type>"
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { citationProblem } from "./citations.mjs";
import { csvPath, readRows } from "./clarifications.mjs";
import { applyBudget, createLedger } from "./coverage.mjs";
import { readJson, writeJson } from "./endpoints.mjs";
import { planPaths } from "./api-plan.mjs";
import { assignIds } from "./registry.mjs";
import { testcasePaths } from "./testcases.mjs";
import { sha256, stampVerified, unverifiedReason } from "./verified.mjs";
import { K6_DEFAULTS, K6_OPT_IN_TYPES as OPT_IN_TYPES } from "../run-config.mjs";

export { K6_DEFAULTS, OPT_IN_TYPES };

export const TYPES = ["smoke", "average-load", "stress", "spike", "soak", "breakpoint"];
export const EXCLUSION_REASONS = ["unknown-endpoint", "unresolved-flow", "overlay-excluded", "mutating-readonly", "failed-functional", "blocked", "rate-limited", "no-safe-data"];
export const ASSUMED = { p95_ms: 1000, error_rate: 0.01 };
export const SMOKE = { rps: 1, durationS: 30 };
export const RATE_LIMIT_SHARE = 0.5; // never above half a documented rate limit
export const WRITE_SHARE = 0.5; // a write gets half the read cap unless an SLO says otherwise
export const HEADROOM = 1.5; // Little's law headroom on preAllocatedVUs
export const MAX_VUS_FACTOR = 2; // maxVUs = preAllocatedVUs x this
export const DROPPED_SHARE = 0.01; // dropped_iterations allowed: 1% of the planned iterations, at least count<1
// Ramping profiles, relative to the average-load rate R and capped by 50% of a documented rate limit.
export const PROFILES = {
  stress: { peak: 2, stages: (r, p) => [[r, 60], [p, 60], [p, 120], [0, 30]] },
  spike: { peak: 5, stages: (r, p) => [[p, 10], [p, 30], [0, 10]] },
  breakpoint: { peak: 10, stages: (r, p) => [[p, 600]] },
};

export function workloadPaths(productDir, module) {
  const moduleDir = path.join(productDir, "modules", module);
  const dir = path.join(moduleDir, "k6");
  const pp = planPaths(productDir, module);
  const tp = testcasePaths(productDir, module);
  return {
    dir, moduleDir, productDir, apiDir: pp.dir,
    workload: path.join(dir, "workload.json"),
    coverage: path.join(dir, "workload-coverage.json"),
    registry: path.join(dir, "workload-registry.json"),
    overlay: path.join(dir, "workload-overlay.json"),
    // the catalogue (api-discovery stage); the plan only for k6-code's expected statuses (optional, else 2xx); the
    // test cases and their approvals: the workload's source (D-068)
    catalogue: pp.catalogue, plan: pp.plan, pp,
    cases: tp.coverage, approvals: tp.approvals,
    // the module's playwright-api results of a run: functional evidence when present (decision 16)
    resultsDir: path.join(productDir, "results"),
    results: (runId) => path.join(productDir, "results", runId, module, "playwright-api", "results.json"),
  };
}

// The scenarios of a workload.json (the readers' one entry point: gate, domain flows). null = missing or not the
// script-built shape.
export function workloadScenarios(file) {
  const wl = readJson(file, null);
  return wl && !Array.isArray(wl) && Array.isArray(wl.scenarios) ? wl.scenarios : null;
}

export const EMPTY_OVERLAY = { priorities: {}, mixes: [], thinkTime: {}, data: [], exclude: [], flows: [] };
export const readOverlay = (file) => ({ ...EMPTY_OVERLAY, ...readJson(file, {}) });

export function k6Config(cfg) {
  const k = cfg?.k6 ?? {};
  return { ...K6_DEFAULTS, ...k, caps: { ...K6_DEFAULTS.caps, ...k.caps }, slo: k.slo ?? {}, modules: k.modules ?? {} };
}

// Types by mode (G7 1): -> {types[], notes[]}
export function typesFor(mode, k6, module) {
  const optIn = k6.modules?.[module]?.types ?? [];
  if (mode !== "full-run") {
    const notes = optIn.length ? [`k6.modules.${module}.types opts in ${optIn.join(", ")}: ignored, a readonly run gets smoke only`] : [];
    return { types: ["smoke"], notes };
  }
  return { types: TYPES.filter((t) => t === "smoke" || t === "average-load" || optIn.includes(t)), notes: [] };
}

// ---------- rate limits ----------
const UNITS = { s: 1, sec: 1, secs: 1, second: 1, seconds: 1, m: 60, min: 60, mins: 60, minute: 60, minutes: 60, h: 3600, hr: 3600, hour: 3600, hours: 3600, d: 86400, day: 86400, days: 86400 };
function windowSeconds(w) {
  if (typeof w === "number") return w > 0 ? w : null;
  const m = /^\s*(\d+(?:\.\d+)?)?\s*([a-z]+)\s*$/i.exec(String(w ?? ""));
  const unit = m && Object.hasOwn(UNITS, m[2].toLowerCase()) ? UNITS[m[2].toLowerCase()] : null;
  return unit ? unit * (m[1] ? Number(m[1]) : 1) : null;
}
const pos = (v) => typeof v === "number" && Number.isFinite(v) && v > 0;
// A catalogue rateLimit -> null (none documented), {rps}, or {unreadable: true}.
export function rateLimitRps(rl) {
  if (rl == null) return null;
  if (typeof rl !== "object") return { unreadable: true };
  for (const [k, div] of [["rps", 1], ["requestsPerSecond", 1], ["perSecond", 1], ["perMinute", 60], ["requestsPerMinute", 60], ["perHour", 3600], ["requestsPerHour", 3600]])
    if (pos(rl[k])) return { rps: rl[k] / div };
  if (pos(Number(rl.limit)) && windowSeconds(rl.window ?? rl.per ?? rl.period)) return { rps: Number(rl.limit) / windowSeconds(rl.window ?? rl.per ?? rl.period) };
  // probe headers: only an IETF RateLimit-Policy "<limit>;w=<seconds>" names a window
  for (const [h, v] of Object.entries(rl.headers ?? {})) {
    const m = /^(x-)?ratelimit-policy$/i.test(h) && /(\d+)\s*;\s*w=(\d+)/.exec(String(v));
    if (m && Number(m[2]) > 0) return { rps: Number(m[1]) / Number(m[2]) };
  }
  return { unreadable: true };
}

// ---------- SLOs and thresholds ----------
const SLO_FIELDS = ["p95_ms", "p99_ms", "error_rate", "rps"];
export function sloFor(k6, module, e) {
  const g = k6.slo ?? {};
  const m = k6.modules?.[module]?.slo ?? {};
  const eps = m.endpoints ?? {};
  const ep = eps[e.id] ?? eps[e.key] ?? {};
  const out = {};
  for (const k of SLO_FIELDS) {
    if (ep[k] !== undefined) out[k] = { value: ep[k], source: "slo:endpoint" };
    else if (m[k] !== undefined) out[k] = { value: m[k], source: "slo:module" };
    else if (g[k] !== undefined) out[k] = { value: g[k], source: "slo:global" };
  }
  return out;
}

function endpointThresholds(e, slo, abortOnFail) {
  const p95 = slo.p95_ms ?? { value: ASSUMED.p95_ms, source: "assumed" };
  const err = slo.error_rate ?? { value: ASSUMED.error_rate, source: "assumed" };
  const t = (metric, stat, limit, expr, source) => ({ metric, endpoint: e.id, stat, limit, expr, source, assumed: source === "assumed", ...(abortOnFail ? { abortOnFail: true } : {}) });
  return [
    t(`http_req_duration{endpoint:${e.id}}`, "p95", p95.value, `p(95)<${p95.value}`, p95.source),
    ...(slo.p99_ms ? [t(`http_req_duration{endpoint:${e.id}}`, "p99", slo.p99_ms.value, `p(99)<${slo.p99_ms.value}`, slo.p99_ms.source)] : []),
    t(`http_req_failed{endpoint:${e.id}}`, "error-rate", err.value, `rate<${err.value}`, err.source),
  ];
}

export const droppedLimit = (planned) => Math.max(1, Math.ceil(planned * DROPPED_SHARE));

// ---------- open model: rates, profiles, sizing ----------
const round = (x) => Math.round(x * 1e6) / 1e6;
// rps values -> one k6 timeUnit for all of them: per second when all are whole, else per minute (floored). null = some
// non-zero value is under one per minute.
export function perUnit(values) {
  if (values.every((v) => Number.isInteger(round(v)))) return { timeUnit: "1s", rates: values.map((v) => round(v)) };
  const rates = values.map((v) => Math.floor(round(v * 60)));
  return rates.some((r, i) => values[i] > 0 && r < 1) ? null : { timeUnit: "1m", rates };
}
const perSecond = (rate, timeUnit) => (timeUnit === "1m" ? rate / 60 : rate);

// type, R (average rps), peakCap (50% of a rate limit, or Infinity), caps, writeCap (a write scenario's cap, else
// Infinity) -> profile or {skip, detail}. A write's ramp is scaled down so its peak never exceeds the write cap: the
// ramp's base rate becomes min(R, cap / the profile's peak factor), keeping the profile's shape; a rate under one
// request per minute skips the type as rate-limited.
export function profileFor(type, r, peakCap, caps, writeCap = Infinity) {
  if (type === "smoke" || type === "average-load" || type === "soak") {
    const rps = type === "smoke" ? Math.min(SMOKE.rps, r) : r;
    const durationS = type === "smoke" ? SMOKE.durationS : type === "soak" ? caps.soak_duration_s : caps.duration_s;
    const u = perUnit([rps]);
    if (!u || u.rates[0] < 1) return { skip: "rate-limited", detail: `${rps.toFixed(4)} rps is under one request per minute` };
    const actual = perSecond(u.rates[0], u.timeUnit);
    return { executor: "constant-arrival-rate", rate: u.rates[0], timeUnit: u.timeUnit, durationS, peakRps: actual, planned: actual * durationS };
  }
  const prof = PROFILES[type];
  const write = Number.isFinite(writeCap);
  const cap = Math.min(peakCap, writeCap);
  const base = write ? Math.min(r, cap / prof.peak) : r;
  const peak = Math.min(prof.peak * base, cap);
  if (!(peak > base)) return { skip: "rate-limited", detail: write ? `the write cap (${round(cap)} rps) leaves no headroom for a ramp` : `50% of the documented rate limit (${round(peakCap)} rps) leaves no headroom above the average-load rate (${round(r)} rps)` };
  const st = prof.stages(base, peak);
  const u = perUnit(st.map(([t]) => t));
  if (!u) return { skip: "rate-limited", detail: "the rates are under one request per minute" };
  const stages = st.map(([, d], i) => ({ target: u.rates[i], durationS: d }));
  let planned = 0;
  let prev = 0;
  for (const s of stages) {
    planned += ((perSecond(prev, u.timeUnit) + perSecond(s.target, u.timeUnit)) / 2) * s.durationS;
    prev = s.target;
  }
  return { executor: "ramping-arrival-rate", startRate: 0, timeUnit: u.timeUnit, stages, peakRps: perSecond(Math.max(...u.rates), u.timeUnit), planned, durationS: stages.reduce((n, s) => n + s.durationS, 0) };
}

// Little's law: VUs in flight = arrival rate x time in the system.
export function sizing(peakRps, expectedIterationS) {
  const preAllocatedVUs = Math.max(1, Math.ceil(round(peakRps * expectedIterationS * HEADROOM)));
  return { peakRps: round(peakRps), expectedIterationS: round(expectedIterationS), headroom: HEADROOM, preAllocatedVUs, maxVUs: preAllocatedVUs * MAX_VUS_FACTOR };
}

const PRIORITY = { p1: 1, p2: 2, p3: 3 };
const idNum = (id) => Number(String(id).split("-").at(-1));
export const isCreate = (e) => e.crud === "create" || (e.kind === "rest" && e.method === "POST" && !e.queryLike);
export const isDelete = (e) => e.crud === "delete" || e.method === "DELETE";
// A write in D-005's sense: PUT, PATCH, DELETE and a POST that is not query-like.
export const isWrite = (e) => !!e.mutates && !e.queryLike;
// The path parameters of an endpoint, in path order.
export const pathParamsOf = (e) => [...new Set([...[...String(e.path ?? "").matchAll(/\{([^}]+)\}/g)].map((m) => m[1]), ...(e.params ?? []).filter((p) => p.in === "path" && String(e.path ?? "").includes(`{${p.name}}`)).map((p) => p.name)])];
// A flow step's binds as a list: `bind` is one {param, from, pointer} or an array of them (a nested path binds each).
export const bindsOf = (st) => (st?.bind ? (Array.isArray(st.bind) ? st.bind : [st.bind]) : []);
const erase = (p) => String(p ?? "").replace(/\{[^}]*\}/g, "{}").replace(/\/+$/, "");
// The collection a path parameter names an item of: the path before "{param}", parameters erased.
// An entity's own delete: a DELETE whose path is the create's collection path plus exactly one {param} (the item path).
export const isItemDeleteOf = (e, create) => e?.method === "DELETE" && !!create && erase(e.path) === `${erase(create.path)}/{}`;
const collectionOf = (e, param) => {
  const p = String(e.path ?? "");
  const i = p.indexOf(`{${param}}`);
  return i < 0 ? null : erase(p.slice(0, i));
};

// Where the id of what create endpoint c created is, as api-code.mjs reads it: the pointer of the delete's link from c,
// else of any catalogue link from c (the documented create response id), else /id (assumed). -> {pointer, documented}
export function createIdPointer(catalogue, c) {
  if (c.kind === "graphql" && c.graphql?.field) return { pointer: `/data/${c.graphql.field}/id`, documented: true };
  const links = catalogue.filter((x) => x.kind === "rest").flatMap((x) => (x.links ?? []).filter((l) => l.from === c.id && l.pointer).map((l) => ({ pointer: l.pointer, del: isDelete(x) })));
  const l = links.find((x) => x.del) ?? links[0];
  return l ? { pointer: l.pointer, documented: true } : { pointer: "/id", documented: false };
}

// ---------- overlay ----------
function overlayProblems(ov, catalogue, cctx) {
  const problems = [];
  const byId = new Map(catalogue.map((e) => [e.id, e]));
  const cite = (where, c) => {
    if (!c) return problems.push(`workload-overlay.json ${where}: not cited`);
    const p = citationProblem(c, cctx);
    if (p) problems.push(`workload-overlay.json ${where}: ${p}`);
  };
  const known = (where, id) => byId.has(id) || problems.push(`workload-overlay.json ${where}: unknown endpoint ${id}`);
  for (const [id, v] of Object.entries(ov.priorities)) {
    known(`priorities['${id}']`, id);
    cite(`priorities['${id}']`, v?.citation);
  }
  const mixNames = new Set();
  const inMix = new Map();
  for (const [i, m] of ov.mixes.entries()) {
    const w = `mixes[${i}]`;
    if (mixNames.has(m.name)) problems.push(`workload-overlay.json ${w}: duplicate mix '${m.name}'`);
    mixNames.add(m.name);
    cite(w, m.citation);
    for (const x of m.endpoints ?? []) {
      if (!known(`${w}`, x.endpoint)) continue;
      if (byId.get(x.endpoint).mutates) problems.push(`workload-overlay.json ${w}: ${x.endpoint} mutates; writes are loaded only through flows`);
      if (inMix.has(x.endpoint)) problems.push(`workload-overlay.json ${w}: ${x.endpoint} is already in mix '${inMix.get(x.endpoint)}'`);
      inMix.set(x.endpoint, m.name);
    }
  }
  const flowNames = new Set();
  for (const [i, f] of ov.flows.entries()) {
    const w = `flows[${i}]`;
    if (flowNames.has(f.name)) problems.push(`workload-overlay.json ${w}: duplicate flow '${f.name}'`);
    flowNames.add(f.name);
    if (!(f.citations ?? []).length) problems.push(`workload-overlay.json ${w}: not cited`);
    for (const c of f.citations ?? []) cite(w, c);
    for (const p of flowProblems(f, byId)) problems.push(`workload-overlay.json ${w} '${f.name}': ${p}`);
  }
  for (const [target, v] of Object.entries(ov.thinkTime)) {
    const ok = target.startsWith("mix:") ? mixNames.has(target.slice(4)) : target.startsWith("flow:") ? flowNames.has(target.slice(5)) : byId.has(target);
    if (!ok) problems.push(`workload-overlay.json thinkTime['${target}']: names no endpoint, mix:<name> or flow:<name> of this workload`);
    cite(`thinkTime['${target}']`, v?.citation);
  }
  for (const [i, d] of ov.data.entries()) {
    const ok = d.target?.startsWith("flow:") ? flowNames.has(d.target.slice(5)) : d.target?.startsWith("mix:") ? mixNames.has(d.target.slice(4)) : byId.has(d.target);
    if (!ok) problems.push(`workload-overlay.json data[${i}]: names no endpoint, mix:<name> or flow:<name> of this workload`);
    cite(`data[${i}]`, d.citation);
  }
  const seen = new Set();
  for (const [i, x] of ov.exclude.entries()) {
    known(`exclude[${i}]`, x.endpoint);
    if (seen.has(x.endpoint)) problems.push(`workload-overlay.json exclude[${i}]: ${x.endpoint} excluded twice`);
    seen.add(x.endpoint);
    cite(`exclude[${i}]`, x.citation);
  }
  return problems;
}

// A write flow touches only entities it created (D-005):
//   - step 0 is a top-level create (no path parameter: a parent it did not create would be pre-existing data);
//   - every path parameter of every later step is bound, and every bind is {from: <a create step of this flow>,
//     pointer: that create's id pointer (createIdPointer)}, never a read step and never another field (/ownerId);
//   - a bound parameter names an item of the collection its create created in (the path before "{param}" equals the
//     create's path, parameters erased), and a read, update or delete is on its entity's resource (the last
//     parameter's create has the step's resource); a nested child path binds the parent to step 0 and the child to a
//     child create of this flow;
//   - a later create has path parameters (a child under a created parent), each tracked by the generator;
//   - an entity's delete (the only step the generator follows with trackDeleted) is a DELETE on the created entity's
//     own item path: the create's collection path plus exactly one {param}, bound to that create's id (isItemDeleteOf).
//     A DELETE on a sub-path (/contacts/{id}/assign) is an ordinary write step under the bind rules, never a cleanup;
//     a create with no such delete keeps its entity tracked as a leftover (the ledger, D-005);
//   - the entity deletes are the last steps, each created entity at most once, children before their parent.
// st.bind may be one bind or an array of them. The same rules run in workload build and check and k6-code build and
// check. -> problems[]
export function flowProblems(f, byId) {
  return analyzeFlow(f, byId).problems;
}
// The entity deletes of a valid flow: Map(step -> the create step whose entity it deletes).
export function flowDeletes(f, byId) {
  return new Map(analyzeFlow(f, byId).deletes);
}
function analyzeFlow(f, byId) {
  const out = [];
  const steps = f.steps ?? [];
  const catalogue = [...byId.values()];
  if (steps.length < 2) out.push("a flow needs a create and at least one more step");
  const eps = steps.map((st) => byId.get(st.endpoint));
  const created = new Map(); // step -> {e, pointer}
  const deletes = []; // [step, the create step it deletes]
  for (const [i, st] of steps.entries()) {
    const e = eps[i];
    if (!e) {
      out.push(`step ${i}: unknown endpoint ${st.endpoint}`);
      continue;
    }
    const params = pathParamsOf(e);
    const by = new Map();
    for (const b of bindsOf(st)) {
      const w = `step ${i}: bind '${b.param}'`;
      if (by.has(b.param)) {
        out.push(`${w} is bound twice`);
        continue;
      }
      by.set(b.param, b);
      if (!params.includes(b.param)) out.push(`${w} is not a path parameter of ${e.id} ${e.path}`);
      else if (!(Number.isInteger(b.from) && b.from >= 0 && b.from < i)) out.push(`${w}: bind.from must name an earlier step`);
      else if (!created.has(b.from)) out.push(`${w} comes from step ${b.from} (${steps[b.from].endpoint}), which is not a create of this flow: a bind names only an entity the flow created, never what a read returned (it may be pre-existing data, D-005)`);
      else {
        const c = created.get(b.from);
        if (b.pointer !== c.pointer) out.push(`${w} reads ${b.pointer} of step ${b.from}'s response, not the created entity's id ${c.pointer}: another field may name pre-existing data (D-005)`);
        const col = collectionOf(e, b.param);
        if (col !== erase(c.e.path)) out.push(`${w}: ${e.path} names an item of ${col}, but step ${b.from} creates in ${c.e.path}: a bind names only what that create created`);
      }
    }
    if (i === 0) {
      if (!isCreate(e)) out.push(`step 0: ${e.id} is not a create; a flow starts by creating its own entity`);
      else if (params.length) out.push(`step 0: ${e.id} ${e.path} creates under a parent the flow did not create (pre-existing data); start with the parent's create`);
      else created.set(0, { e, pointer: createIdPointer(catalogue, e).pointer });
      continue;
    }
    const unbound = params.filter((p) => !by.has(p));
    if (unbound.length) out.push(`step ${i}: ${e.id} path parameter${unbound.length > 1 ? "s" : ""} ${unbound.join(", ")} ha${unbound.length > 1 ? "ve" : "s"} no bind to a create of this flow (it would target pre-existing data)`);
    if (isCreate(e)) {
      if (!params.length) out.push(`step ${i}: ${e.id} creates again; one flow creates one top-level entity (start another flow)`);
      else created.set(i, { e, pointer: createIdPointer(catalogue, e).pointer });
    } else if (params.length) {
      const entity = by.get(params.at(-1));
      const c = entity && created.get(entity.from);
      if (c && c.e.resource && e.resource && c.e.resource !== e.resource) out.push(`step ${i}: ${e.id} is on ${e.resource}, but '${params.at(-1)}' names step ${entity.from}'s ${c.e.resource}: a step acts only on an entity the flow created`);
      if (c && isItemDeleteOf(e, c.e)) deletes.push([i, entity.from]);
    } else if (isWrite(e)) out.push(`step ${i}: ${e.id} writes without naming the flow's entity`);
  }
  const first = deletes.length ? deletes[0][0] : -1;
  if (first >= 0) for (let i = first + 1; i < steps.length; i++) if (eps[i] && !deletes.some(([j]) => j === i)) out.push(`step ${i}: comes after a delete: the deletes are the last steps (children before their parent)`);
  deletes.forEach(([i, from], k) => {
    if (deletes.slice(0, k).some(([, x]) => x === from)) out.push(`step ${i}: deletes step ${from}'s entity again`);
    else if (k > 0 && from > deletes[k - 1][1]) out.push(`step ${i}: deletes step ${from}'s entity after step ${deletes[k - 1][1]}'s: children before their parent (the reverse order of the creates)`);
  });
  return { problems: out, deletes };
}

// The step whose delete removes step 0's entity (the flow's cleanup: a DELETE on its item path), or null.
export function rootDeleteStep(flow, byId) {
  const step = [...flowDeletes(flow, byId)].find(([, from]) => from === 0)?.[0];
  return step === undefined ? null : flow.steps[step];
}

// ---------- functional evidence (D-068, decision 16) ----------
// The module's playwright-api results.json that counts: this run's when it ran, else the latest recorded (recordedAt,
// then run id) of the earlier runs that ran. -> {file, runId, results} | null (no results: every case is load-tested).
// A results.json of status not-run is no evidence.
export function functionalResults(wp, runId) {
  const ran = (id) => {
    const results = readJson(wp.results(id), null);
    return results?.status === "ran" ? { file: wp.results(id), runId: id, results } : null;
  };
  const own = runId ? ran(runId) : null;
  if (own) return own;
  const runs = existsSync(wp.resultsDir) ? readdirSync(wp.resultsDir, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== runId).map((d) => d.name) : [];
  return runs.map(ran).filter(Boolean).sort((a, b) => String(b.results.recordedAt ?? "").localeCompare(String(a.results.recordedAt ?? "")) || b.runId.localeCompare(a.runId))[0] ?? null;
}

// A generated API test's results item carries its plan scenario id (results.mjs scenarioId, parsed from the literal
// title, D-056/D-058). -> {byScenario: Map(id -> passed|failed|skipped), unmapped: [title]} (no scenarioId, an id of
// another module, or an id the plan does not have): conservative, never guessed from the title. Flaky counts as failed.
function scenarioStatuses(results, module, planIds) {
  const byScenario = new Map();
  const unmapped = [];
  for (const it of results?.items ?? []) {
    const id = it.scenarioId;
    if (typeof id !== "string" || !id.startsWith(`API-${module}-`) || !planIds.has(id)) {
      unmapped.push(it.title);
      continue;
    }
    const st = it.status === "failed" || it.status === "flaky" ? "failed" : it.status === "passed" ? "passed" : "skipped";
    const before = byScenario.get(id);
    byScenario.set(id, before === "failed" || st === "failed" ? "failed" : before === "passed" || st === "passed" ? "passed" : "skipped");
  }
  return { byScenario, unmapped };
}
const touches = (s) => [...new Set([s.endpoint, ...(s.steps ?? []).map((x) => x.endpoint), ...(s.request?.setup ?? []).map((x) => x.endpoint)].filter(Boolean))];

// The functional verdict per endpoint from the chosen results and the API plan (the pre-S2b D-057 rules). -> {fr,
// verdict(epId) -> {reason: failed-functional|blocked, detail} | null, notes[]}. No results (or no plan to map them
// through): verdict is always null, and a note says why.
export function functionalEvidence(wp, module, runId) {
  const fr = functionalResults(wp, runId);
  const notes = [];
  const none = { fr, verdict: () => null, notes };
  const own = runId ? readJson(wp.results(runId), null) : null;
  if (own && own.status !== "ran") notes.push(`the playwright-api tests of run ${runId} did not run: ${own.reason ?? "no reason recorded"}`);
  if (!fr) {
    notes.push("no playwright-api results.json for this module in this or an earlier run: every case is load-tested without functional evidence (decision 16)");
    return none;
  }
  const plan = readJson(wp.plan, null);
  if (!Array.isArray(plan)) {
    notes.push(`playwright-api results of run ${fr.runId} exist but api/plan.json is missing: they cannot be mapped to endpoints, every case is load-tested`);
    return none;
  }
  notes.push(`functional evidence: the playwright-api results of run ${fr.runId}${fr.runId === runId ? "" : " (an earlier run)"}`);
  const { byScenario, unmapped } = scenarioStatuses(fr.results, module, new Set(plan.map((s) => s.id)));
  if (unmapped.length) notes.push(`${unmapped.length} playwright-api result(s) of run ${fr.runId} name no single plan scenario and were not mapped (no scenarioId in results.json: record them with results.mjs)`);
  const verdict = (epId, { flow = false } = {}) => {
    const ss = plan.filter((s) => touches(s).includes(epId));
    const failed = ss.filter((s) => byScenario.get(s.id) === "failed");
    if (failed.length) {
      const multi = failed.filter((s) => touches(s).length > 1);
      return { reason: "failed-functional", detail: `${epId} failed functionally in run ${fr.runId}: ${failed.map((s) => s.id).join(", ")}${multi.length ? `; ambiguous: ${multi.map((s) => `${s.id} touches ${touches(s).join(", ")}`).join("; ")}, excluded conservatively` : ""}` };
    }
    if (flow) return null;
    const ownSs = ss.filter((s) => s.endpoint === epId);
    const functional = ownSs.filter((s) => s.type === "functional");
    const blockedSet = functional.length ? functional : ownSs;
    if (blockedSet.length && blockedSet.every((s) => s.blocked) && !blockedSet.some((s) => byScenario.get(s.id) === "passed")) return { reason: "blocked", detail: `${epId} is blocked functionally (run ${fr.runId}): ${blockedSet.map((s) => `${s.id} (${s.blocked})`).join("; ")}` };
    return null;
  };
  return { fr, verdict, notes };
}

// ---------- build ----------
// The approved @performance cases of a Map TC id -> case (the CLI passes every human-approved case, D-053), in id order.
export function performanceCases(cases) {
  return [...cases.entries()].filter(([, c]) => c?.performance || c?.type === "performance").map(([id, c]) => ({ ...c, id })).sort((a, b) => idNum(a.id) - idNum(b.id));
}

// The type a case gets in this run (D-057's caps): readonly -> smoke; an opt-in type without
// k6.modules.<m>.types opting in -> average-load. -> {type, note?}
export function caseType(requested, types) {
  if (types.includes(requested)) return { type: requested };
  const type = types.includes("average-load") ? "average-load" : "smoke";
  const why = types.includes("average-load") ? `${requested} is an opt-in type the run-config does not opt this module into (k6.modules.<m>.types)` : "a readonly run gets smoke only";
  return { type, note: `${requested} capped to ${type}: ${why}` };
}

// A case's SLO over the run-config's (k6.slo, field by field), each field with its source: case:<TC> | slo:* (none =
// the assumed default, marked in the thresholds).
const caseSlo = (k6, module, e, c) => {
  const out = sloFor(k6, module, e);
  for (const k of ["p95_ms", "p99_ms", "error_rate"]) if (c.load?.slo?.[k] !== undefined) out[k] = { value: c.load.slo[k], source: `case:${c.id}` };
  return out;
};

// opts: {module, cfg (resolved run-config), mode, runId (the run building it), cases: Map TC id -> {performance?,
// endpoint?, flow?, load?, priority?} (the human-approved cases), registryFile}. Reads the catalogue and the overlay from
// disk. -> {problems[], notes[], workload, coverage, summary}. Pure but for the registry (assignIds), which a dry run
// points at a copy.
export function compute(wp, { module, cfg, mode, runId, cases = new Map(), registryFile = wp.registry }) {
  const problems = [];
  const catalogue = readJson(wp.catalogue, null);
  if (!catalogue) return { problems: ["api/discovered-endpoints.json is missing (the api-discovery stage builds it with endpoints.mjs build)"] };
  const k6 = k6Config(cfg);
  const ov = readOverlay(wp.overlay);
  const cctx = { rows: readRows(csvPath(wp.productDir, module)), cases, productDir: wp.productDir, moduleDir: wp.moduleDir, apiDir: wp.apiDir };
  problems.push(...overlayProblems(ov, catalogue, cctx));
  const byId = new Map(catalogue.map((e) => [e.id, e]));
  const byKey = new Map(catalogue.map((e) => [e.key, e]));
  for (const k of Object.keys(k6.modules?.[module]?.slo?.endpoints ?? {})) {
    if (!byId.has(k) && !byKey.has(k)) problems.push(`k6.modules.${module}.slo.endpoints['${k}']: no endpoint of this catalogue has that id or key`);
    else if (byKey.has(k) && Object.hasOwn(k6.modules[module].slo.endpoints, byKey.get(k).id)) problems.push(`k6.modules.${module}.slo.endpoints: '${k}' and '${byKey.get(k).id}' name the same endpoint`);
  }
  const { types, notes } = typesFor(mode, k6, module);
  const perf = performanceCases(cases);
  const fe = functionalEvidence(wp, module, runId);
  notes.push(...fe.notes);
  if (!perf.length) notes.push("no human-approved @performance test case: nothing to load (the workload is built only from approved @performance cases)");

  const peakCap = new Map(catalogue.map((e) => [e.id, rateLimitRps(e.rateLimit)?.rps ? rateLimitRps(e.rateLimit).rps * RATE_LIMIT_SHARE : Infinity]));
  // per-endpoint caps: rps for average-load and its source
  const capOf = (e) => {
    const slo = sloFor(k6, module, e);
    const rlCap = peakCap.get(e.id);
    const base = Math.min(k6.caps.rps, rlCap);
    // a write and a query-like POST (D-057): the write cap in every type, so a ramp's peak is never below the average
    if (slo.rps) return { rps: Math.min(slo.rps.value, rlCap), source: slo.rps.value > rlCap ? "rate-limit" : slo.rps.source };
    if (e.mutates) return { rps: base * WRITE_SHARE, source: rlCap < k6.caps.rps ? "rate-limit-write-half" : "default-write-half" };
    return { rps: base, source: rlCap < k6.caps.rps ? "rate-limit" : "default" };
  };
  // the write cap: half the read cap (itself at most 50% of a documented rate limit), unless an SLO sets the rate
  const writeCapOf = (e) => {
    const slo = sloFor(k6, module, e);
    const rlCap = peakCap.get(e.id);
    return slo.rps ? Math.min(slo.rps.value, rlCap) : Math.min(k6.caps.rps, rlCap) * WRITE_SHARE;
  };
  const thinkOf = (target) => ov.thinkTime[target] ?? null;
  const excludeOv = new Map(ov.exclude.map((x) => [x.endpoint, x]));
  const flows = new Map(ov.flows.map((f) => [f.name, f]));
  const mixes = new Map(ov.mixes.map((m) => [m.name, m]));

  // one load unit per approved @performance case, or the reason it cannot load
  const ledger = createLedger({ reasons: EXCLUSION_REASONS });
  const exclusion = new Map(); // TC id -> {reason, detail, citation?}
  const units = [];
  const typeNotes = new Map(); // TC id -> requested type, when capped
  for (const c of perf) {
    const x = (reason, detail, extra = {}) => {
      exclusion.set(c.id, { reason, detail, ...extra });
      if (["unknown-endpoint", "unresolved-flow", "failed-functional", "blocked"].includes(reason)) notes.push(`${c.id} is not loaded: ${detail}`);
    };
    let u = null;
    if (c.endpoint) {
      const e = byId.get(c.endpoint);
      if (!e) x("unknown-endpoint", `${c.id} names ${c.endpoint}, which is not in the endpoint catalogue (discovered-endpoints.json)`);
      else u = { kind: "endpoint", name: e.id, target: e.id, endpoints: [e.id] };
    } else if (c.flow && flows.has(c.flow)) {
      const f = flows.get(c.flow);
      const eps = f.steps.map((s) => byId.get(s.endpoint));
      if (eps.some((e) => !e)) x("unresolved-flow", `flow '${c.flow}' names an endpoint the catalogue lacks: ${f.steps.filter((s) => !byId.has(s.endpoint)).map((s) => s.endpoint).join(", ")}`);
      else u = { kind: "flow", name: f.name, target: `flow:${f.name}`, endpoints: [...new Set(eps.map((e) => e.id))], flow: f };
    } else if (c.flow && mixes.has(c.flow)) {
      const m = mixes.get(c.flow);
      const members = (m.endpoints ?? []).filter((y) => byId.has(y.endpoint) && !byId.get(y.endpoint).mutates);
      if (!members.length) x("unresolved-flow", `mix '${c.flow}' has no read endpoint of the catalogue`);
      else u = { kind: "mix", name: m.name, target: `mix:${m.name}`, endpoints: members.map((y) => y.endpoint), weights: Object.fromEntries(members.map((y) => [y.endpoint, y.weight])), citation: m.citation };
    } else if (c.flow) x("unresolved-flow", `${c.id} names the user flow '${c.flow}': no workload-overlay.json flow or mix has that name (the designer adds it, cited)`);
    else x("unresolved-flow", `${c.id} names neither an endpoint (EP id) nor a user flow`);
    if (!u) continue;
    u.case = c;
    u.key = `case:${c.id}`;
    const eps = u.endpoints.map((id) => byId.get(id));
    const ovx = eps.find((e) => excludeOv.has(e.id));
    const unreadable = eps.find((e) => rateLimitRps(e.rateLimit)?.unreadable);
    // known functional failures (decision 16): a flow or mix only when a member endpoint failed
    const functional = eps.map((e) => fe.verdict(e.id, { flow: u.kind !== "endpoint" })).find(Boolean);
    if (ovx) x("overlay-excluded", `${ovx.id}: ${excludeOv.get(ovx.id).reason}`, { citation: excludeOv.get(ovx.id).citation });
    else if (mode !== "full-run" && eps.some((e) => e.mutates)) x("mutating-readonly", `${eps.filter((e) => e.mutates).map((e) => `${e.id} ${e.method ?? e.kind} mutates${e.queryLike ? " (query-like, still a write for the guard)" : ""}`).join("; ")}; a readonly run loads no writes`);
    else if (functional) x(functional.reason, functional.detail);
    else if (u.kind === "flow" && flowProblems(u.flow, byId).length) x("no-safe-data", `flow '${u.name}': ${flowProblems(u.flow, byId).join("; ")}`);
    // a query-like request on an item path is loaded only as a flow step bound to a create: standalone, its {param}
    // would come from a slot, that is pre-existing data, and a wrong query-like flag would write to it (D-005)
    else if (u.kind === "endpoint" && eps[0].queryLike && pathParamsOf(eps[0]).length) x("no-safe-data", `query-like on an item path (${eps[0].path}): loaded only as a step of a cited flow bound to an entity the run creates; name that flow in the case`);
    else if (u.kind === "endpoint" && eps[0].mutates && !eps[0].queryLike) x("no-safe-data", `${eps[0].id} writes: a write is loaded only through a cited workload-overlay.json flow on an entity the run creates; name that flow in the case`);
    else if (unreadable) x("rate-limited", `${unreadable.id}: a rate limit is documented but no rate could be read from it`);
    else units.push(u);
  }
  for (const c of perf) ledger.addItem(c.id, { target: c.endpoint ?? (c.flow ? (mixes.has(c.flow) && !flows.has(c.flow) ? `mix:${c.flow}` : `flow:${c.flow}`) : "-") });

  // budget: the best-ranked cases; the rest deferred (D-049): case priority, then the overlay's endpoint priority
  const items = units.map((u, n) => ({ id: u.key, status: "pending", unit: u, n }));
  const rank = (i) => Math.min(PRIORITY[i.unit.case.priority] ?? 3, ...i.unit.endpoints.map((id) => PRIORITY[ov.priorities[id]?.priority] ?? 3)) * 1e6 + idNum(i.unit.case.id);
  applyBudget(items, k6.budget, rank);
  const kept = items.filter((i) => i.status === "pending").map((i) => i.unit);
  const deferredUnits = items.filter((i) => i.status === "deferred").map((i) => i.unit);

  // scenarios: one per kept case, its type capped by the mode and the opt-ins, its rate by the caps
  const drafts = [];
  const skippedTypes = [];
  for (const u of kept) {
    const c = u.case;
    const eps = u.endpoints.map((id) => byId.get(id));
    const sloOf = (e) => caseSlo(k6, module, e, c);
    const p95Of = (e) => (sloOf(e).p95_ms?.value ?? ASSUMED.p95_ms) / 1000;
    let cap;
    let capSource;
    if (u.kind === "flow") {
      const caps = u.flow.steps.map((s) => capOf(byId.get(s.endpoint)));
      cap = Math.min(...caps.map((x) => x.rps));
      capSource = caps.find((x) => x.rps === cap).source;
    } else if (u.kind === "mix") {
      const total = Object.values(u.weights).reduce((a, b) => a + b, 0);
      cap = Math.min(k6.caps.rps, ...eps.map((e) => capOf(e).rps * (total / u.weights[e.id])));
      capSource = cap < k6.caps.rps ? "member-cap" : "default";
    } else ({ rps: cap, source: capSource } = capOf(eps[0]));
    // the case's target rate, never above the caps
    const r = Math.min(c.load?.rps ?? cap, cap);
    if (c.load?.rps !== undefined && c.load.rps <= cap) capSource = `case:${c.id}`;
    const { type, note } = caseType(c.load?.type ?? "smoke", types);
    if (note) {
      notes.push(`${c.id}: ${note}`);
      typeNotes.set(c.id, c.load.type);
    }
    // 50% of each rate limit, per iteration: a mix member gets weight/total of the iterations
    const total = u.kind === "mix" ? Object.values(u.weights).reduce((a, b) => a + b, 0) : 1;
    const pc = Math.min(...eps.map((e) => peakCap.get(e.id) * (u.kind === "mix" ? total / u.weights[e.id] : 1)));
    const target = u.target;
    const think = thinkOf(target);
    const requestS = u.kind === "flow" ? u.flow.steps.reduce((n, s) => n + p95Of(byId.get(s.endpoint)), 0) : Math.max(...eps.map(p95Of));
    const expectedS = requestS + (think?.ms ?? 0) / 1000;
    const data = ov.data.filter((d) => d.target === target || (u.kind !== "endpoint" && u.endpoints.includes(d.target))).map((d) => ({ target: d.target, need: d.need, citation: d.citation }));
    // the write cap holds at every peak (D-7): a flow's writes and a query-like POST
    const writes = u.kind === "flow" ? u.flow.steps.map((s) => byId.get(s.endpoint)).filter((e) => e.mutates) : u.kind === "endpoint" && eps[0].mutates ? [eps[0]] : [];
    const wc = writes.length ? Math.min(...writes.map(writeCapOf)) : Infinity;
    const prof = profileFor(type, r, pc, k6.caps, wc);
    if (prof.skip) {
      skippedTypes.push({ unit: u.key, type, reason: prof.skip, detail: prof.detail });
      exclusion.set(c.id, { reason: "rate-limited", detail: `${type}: ${prof.detail}` });
      continue;
    }
    drafts.push({ u, type, prof, r, capSource, pc, wc, eps, think, expectedS, data, sloOf });
  }
  const reg = assignIds(registryFile, drafts.map((d) => `${d.u.key}|${d.type}`), { module, runId, prefix: "K6", field: "scenarios" });
  const scenarios = drafts.map((d) => scenarioOf(d, reg.scenarios[`${d.u.key}|${d.type}`].id, { byId })).sort((a, b) => idNum(a.id) - idNum(b.id));

  // the ledger: every approved @performance case loaded, excluded with a reason, or deferred
  const scenarioOfCase = new Map(scenarios.map((s) => [s.case, s]));
  const deferredCases = new Set(deferredUnits.map((u) => u.case.id));
  for (const c of perf) {
    const s = scenarioOfCase.get(c.id);
    if (s) ledger.resolve(c.id, { status: "mapped", refs: [s.id], endpoints: s.endpoints, type: s.type, ...(typeNotes.has(c.id) ? { requestedType: typeNotes.get(c.id) } : {}) });
    else if (exclusion.has(c.id)) ledger.resolve(c.id, { status: "excluded", ...exclusion.get(c.id) });
    else if (deferredCases.has(c.id)) ledger.resolve(c.id, { status: "deferred", reason: "budget", detail: `over k6.budget (${k6.budget} load units)` });
  }
  problems.push(...ledger.problems().map((p) => `workload-coverage: ${p}`));
  const sum = ledger.summary();
  const coverage = {
    module, runId, mode, types, budget: k6.budget,
    inputs: { catalogue: sha256(wp.catalogue), cases: sha256(wp.cases), approvals: sha256(wp.approvals), overlay: sha256(wp.overlay), plan: sha256(wp.plan), results: fe.fr ? sha256(fe.fr.file) : null },
    counts: { total: sum.total, loaded: sum.mapped, excluded: sum.excluded, deferred: sum.deferred },
    loaded: ledger.items.filter((i) => i.status === "mapped").map((i) => ({ case: i.id, target: i.target, endpoints: i.endpoints, type: i.type, ...(i.requestedType ? { requestedType: i.requestedType } : {}), ids: i.refs })),
    excluded: ledger.items.filter((i) => i.status === "excluded").map((i) => ({ case: i.id, target: i.target, reason: i.reason, detail: i.detail, ...(i.citation ? { citation: i.citation } : {}) })),
    deferred: ledger.items.filter((i) => i.status === "deferred").map((i) => ({ case: i.id, target: i.target, reason: "budget", detail: i.detail })),
    skippedTypes,
    notes,
  };
  const workload = { module, runId, mode, types, notes, scenarios };
  return { problems, notes, workload, coverage, summary: { scenarios: scenarios.length, ...coverage.counts, types } };
}

function scenarioOf(d, id, { byId }) {
  const { u, type, prof, r, capSource, pc, wc, eps, think, expectedS, data, sloOf } = d;
  const name = `${type}-${idNum(id)}`;
  const size = sizing(prof.peakRps, expectedS);
  const abort = type === "breakpoint";
  const reqEps = u.kind === "flow" ? [...new Set(u.flow.steps.map((s) => s.endpoint))].map((x) => byId.get(x)) : eps;
  const thresholds = [
    ...reqEps.flatMap((e) => endpointThresholds(e, sloOf(e), abort)),
    { metric: "dropped_iterations", stat: "dropped-iterations", limit: droppedLimit(prof.planned), expr: `count<${droppedLimit(prof.planned)}`, source: "open-model", assumed: false },
  ];
  const exec = prof.executor === "constant-arrival-rate"
    ? { executor: prof.executor, rate: prof.rate, timeUnit: prof.timeUnit, duration: `${prof.durationS}s`, preAllocatedVUs: size.preAllocatedVUs, maxVUs: size.maxVUs }
    : { executor: prof.executor, startRate: prof.startRate, timeUnit: prof.timeUnit, preAllocatedVUs: size.preAllocatedVUs, maxVUs: size.maxVUs, stages: prof.stages.map((s) => ({ target: s.target, duration: `${s.durationS}s` })) };
  const options = { scenarios: { [name]: exec }, thresholds: {} };
  for (const t of thresholds) (options.thresholds[t.metric] ??= []).push(t.abortOnFail ? { threshold: t.expr, abortOnFail: true } : t.expr);
  const mutates = reqEps.some((e) => e.mutates);
  const deleteStep = u.kind === "flow" ? rootDeleteStep(u.flow, byId) : null;
  return {
    id, key: `${u.key}|${type}`, case: u.case.id, name, type, kind: u.kind, endpoints: u.endpoints,
    ...(u.kind === "mix" ? { weights: u.weights, citation: u.citation } : {}),
    ...(u.kind === "flow" ? { flow: { name: u.flow.name, steps: u.flow.steps.map((s) => ({ endpoint: s.endpoint, method: byId.get(s.endpoint).method ?? null, path: byId.get(s.endpoint).path ?? null, ...(s.bind ? { bind: s.bind } : {}) })), citations: u.flow.citations } } : {}),
    mutates,
    ...(u.kind === "flow" ? { cleanup: { endpoint: deleteStep?.endpoint ?? null, trackLeftover: true } } : {}),
    ...(u.kind === "endpoint" && eps[0].queryLike && eps[0].mutates ? { queryLike: true } : {}),
    executor: prof.executor,
    load: { rps: round(prof.peakRps), averageRps: round(r), capSource, ...(Number.isFinite(pc) ? { rateLimitCapRps: round(pc) } : {}), ...(Number.isFinite(wc) ? { writeCapRps: round(wc) } : {}), ...(prof.durationS ? { durationS: prof.durationS } : {}) },
    sizing: size,
    thinkTimeMs: think?.ms ?? 0, ...(think ? { thinkTimeCitation: think.citation } : {}),
    data,
    thresholds,
    options,
  };
}

const stable = (x) => JSON.stringify(x, null, 2) + "\n";

export function build(wp, opts) {
  const r = compute(wp, opts);
  if (!r.problems.length) {
    writeJson(wp.workload, r.workload);
    writeJson(wp.coverage, r.coverage); // unstamped: it must pass check again
  }
  return r;
}

// check: schemas, a fresh (dry) build equal to the files, ids, the open-model and safety rules; stamps `verified`.
// opts.extra(ctx) -> problems[]: the hook for the script rules (S7-2: generated scripts and their drift).
export async function check(wp, validateData, opts) {
  const problems = [];
  for (const [file, schema] of [[wp.workload, "workload"], [wp.coverage, "workload-coverage"]]) {
    if (!existsSync(file)) {
      problems.push(`${path.basename(file)}: missing (run workload.mjs build)`);
      continue;
    }
    for (const e of await validateData(schema, readJson(file))) problems.push(`${path.basename(file)}: ${e}`);
  }
  if (existsSync(wp.overlay)) for (const e of await validateData("workload-overlay", readJson(wp.overlay))) problems.push(`workload-overlay.json: ${e}`);
  if (problems.length) return problems;
  const wl = readJson(wp.workload);
  const cov = readJson(wp.coverage);
  // the build is bound to the run it was built in: a workload of another run is not this run's
  if (wl.runId !== opts.runId) {
    const { verified, ...rest } = cov;
    writeJson(wp.coverage, rest);
    return [`workload.json was built from run ${wl.runId}, not ${opts.runId}, the run being checked: rebuild with that run (workload.mjs build <product> <module> --run ${opts.runId}), then check`];
  }
  // a fresh build against a copy of the registry: check never assigns ids
  const tmp = mkdtempSync(path.join(tmpdir(), "atf-workload-"));
  let fresh;
  try {
    const regCopy = path.join(tmp, "registry.json");
    if (existsSync(wp.registry)) copyFileSync(wp.registry, regCopy);
    fresh = compute(wp, { ...opts, registryFile: regCopy });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  problems.push(...fresh.problems);
  if (!fresh.workload) return problems;
  if (stable(wl) !== stable(fresh.workload)) problems.push("workload.json differs from a fresh build (a hand edit, or an input changed since): run workload.mjs build");
  const { verified, ...rest } = cov;
  if (stable(rest) !== stable(fresh.coverage)) problems.push("workload-coverage.json differs from a fresh build (a hand edit, or an input changed since): run workload.mjs build");
  problems.push(...workloadRules(wl, cov, readJson(wp.registry, { scenarios: {} }), readJson(wp.catalogue, []), performanceCases(opts.cases ?? new Map()).map((c) => c.id)));
  if (opts.extra) problems.push(...(await opts.extra({ wp, workload: wl, coverage: cov })));
  writeJson(wp.coverage, problems.length ? rest : { ...rest, verified: stampVerified(verifiedInputs(wp, opts.runId)) });
  return problems;
}

// The rules on the files themselves (also hold if a build were wrong).
// caseIds: the approved @performance cases, each accounted for in the coverage.
export function workloadRules(wl, cov, reg, catalogue, caseIds = []) {
  const out = [];
  const byId = new Map(catalogue.map((e) => [e.id, e]));
  const ids = new Map();
  const keys = new Set();
  const names = new Set();
  for (const s of wl.scenarios) {
    ids.set(s.id, (ids.get(s.id) ?? 0) + 1);
    if (keys.has(s.key)) out.push(`${s.id}: key '${s.key}' used twice`);
    keys.add(s.key);
    if (names.has(s.name)) out.push(`${s.id}: scenario name '${s.name}' used twice`);
    names.add(s.name);
    if (reg.scenarios?.[s.key]?.id !== s.id) out.push(`${s.id}: does not match workload-registry.json for '${s.key}' (rebuild; never edit ids by hand)`);
    const execs = Object.values(s.options?.scenarios ?? {});
    if (execs.length !== 1 || !Object.hasOwn(s.options.scenarios, s.name)) out.push(`${s.id}: options.scenarios must hold exactly its own scenario '${s.name}'`);
    for (const x of execs) if (!["constant-arrival-rate", "ramping-arrival-rate"].includes(x.executor)) out.push(`${s.id}: executor ${x.executor} is not an arrival-rate (open model) executor`);
    if (!(s.options?.thresholds?.dropped_iterations ?? []).length || !s.thresholds.some((t) => t.metric === "dropped_iterations")) out.push(`${s.id}: no dropped_iterations threshold`);
    if (wl.mode !== "full-run" && s.mutates) out.push(`${s.id}: a write scenario in a readonly workload`);
    if (s.kind === "flow" && !(s.mutates && s.cleanup?.trackLeftover)) out.push(`${s.id}: a write flow must record mutates and cleanup with trackLeftover`);
    if (s.kind === "flow") for (const p of flowProblems(s.flow ?? {}, byId)) out.push(`${s.id}: flow '${s.flow?.name}' ${p}`);
    if (wl.mode !== "full-run" && !["smoke"].includes(s.type)) out.push(`${s.id}: ${s.type} in a readonly workload (smoke only)`);
  }
  for (const [id, n] of ids) if (n > 1) out.push(`${id}: listed ${n} times`);
  const listed = [...cov.loaded, ...cov.excluded, ...cov.deferred].map((x) => x.case);
  for (const id of caseIds) if (!listed.includes(id)) out.push(`workload-coverage.json: ${id} is not accounted for`);
  for (const x of cov.loaded) for (const id of x.ids) if (!ids.has(id)) out.push(`workload-coverage.json: ${x.case} maps to unknown ${id}`);
  for (const s of wl.scenarios) if (!s.case || !String(s.key).startsWith(`case:${s.case}|`)) out.push(`${s.id}: not keyed by its approved @performance case (case:<TC>|<type>)`);
  return out;
}

// the plan and the chosen playwright-api results (decision 16): a run's new results make the workload stale
const verifiedInputs = (wp, runId) => ({ workload: wp.workload, catalogue: wp.catalogue, cases: wp.cases, approvals: wp.approvals, overlay: wp.overlay, plan: wp.plan, results: functionalResults(wp, runId)?.file ?? wp.results(runId) });

// For the domain flow (S7-3): null when the workload on disk passed check and nothing changed since, else why not.
// runId (the active run, D-6 of G7): a workload built from another run is not this run's, whatever its stamp says.
export function workloadUnverified(wp, runId) {
  const cov = readJson(wp.coverage, null);
  const wl = readJson(wp.workload, null);
  if (!cov || !wl) return "k6/workload.json or workload-coverage.json is missing: the designer must finish with workload.mjs check";
  if (runId && wl.runId !== runId) return `workload.json was built from run ${wl.runId}, not ${runId}, the active run: rebuild with that run (workload.mjs build <product> <module> --run ${runId}), then check`;
  return unverifiedReason(cov.verified, verifiedInputs(wp, wl.runId), { unstamped: "the workload did not pass workload.mjs check", changed: "the workload or one of its inputs changed after workload.mjs check" });
}
