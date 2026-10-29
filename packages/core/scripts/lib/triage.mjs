// The script-built triage of a run's results (G8, D-058): one row per non-passed result item, plus rows for what the
// run never showed (a hidden @mutates test in a readonly run, an unapproved case, a test that never ran). The script
// decides every class a rule can decide; the triager judges the rest in triage-overlay.json; `check` rebuilds and
// compares, so a typed table can never differ from the results.
//
//   results/<run>/<m>/<framework>/results.json  (results.mjs)   ->  triage.json (script-owned), triage.md (rendered)
//                                                triage-overlay.json (the agent)  -> applied by build, checked by check
//   modules/<m>/triage/triage-registry.json     stable BUG-<m>-<n> ids, keyed by <domain>|<signature> (lib/registry.mjs)
//   artifacts/<p>/known-issues.json              human-edited; an exact signature match is class known-issue
//
// Classes (8 values; the interview's seventh class is awaiting-approval / known-issue):
//   product-bug  test-bug (healable)  locator-drift (healable)  flaky  environment  blocked-by-mode  awaiting-approval  known-issue
// Rules, in order, the first that matches decides (RULES below documents each):
//   awaiting-approval, blocked-by-mode, flaky, known-issue, ledger-guard (ui), environment, locator-drift, api-class-only
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { readJson, writeAtomic, writeJson } from "./files.mjs";
import { citationProblem } from "./citations.mjs";
import { csvPath, readRows } from "./clarifications.mjs";
import { planPaths } from "./api-plan.mjs";
import { assignIds } from "./registry.mjs";
import { approvalStatus, approvalSummary, readApprovals, testcasePaths } from "./testcases.mjs";
import { sha256, stampVerified, unverifiedReason } from "./verified.mjs";
import { workloadPaths, workloadScenarios } from "./workload.mjs";
import { LEDGER_GUARD_RE } from "./ledger.mjs";

export const DOMAINS = { ui: "playwright-ui", api: "playwright-api", k6: "k6" };
export const CLASSES = ["product-bug", "test-bug", "locator-drift", "flaky", "environment", "blocked-by-mode", "awaiting-approval", "known-issue"];
export const HEALABLE_CLASSES = ["test-bug", "locator-drift"];
// classes only the script may decide: the mode and approval facts, and the human's known-issues list
const SCRIPT_ONLY = ["blocked-by-mode", "awaiting-approval", "known-issue"];
export const RULES = {
  "awaiting-approval": "the case is not approved (D-053): its test is absent or test.fixme",
  "hidden-mutates": "an approved @mutates test or scenario in a readonly run: grepInvert keeps it out of the report (D-005)",
  "readonly-not-run": "k6 load only runs in full-run: the workload scenario was not run",
  "pass-on-retry": "failed, then passed on a retry: flaky, never a product bug",
  "known-issue": "the signature equals a known-issues.json entry",
  environment: "connection refused, DNS, a 5xx from the auth setup, a missing env variable or session, every k6 request failed",
  "setup-failed": "an auth setup test failed, so the tests that depend on it never ran",
  "locator-drift": "the locator smoke found a locator with count 0, or a page-object locator timed out",
  "api-class-only": "a class-only API expectation: an actual status in the class is not a failure, outside it a candidate product bug",
  "ledger-guard": "the UI guard refused a destructive request on an entity this run did not create (D-074): the test's fault, never the product's",
};

const clip = (s, n) => String(s ?? "").slice(0, n);
const stripAnsi = (s) => String(s ?? "").replace(/\u001b\[[0-9;]*m/g, "");
const slash = (p) => String(p).replaceAll("\\", "/");

// ---------- the signature ----------
// ONE definition, used for clustering, BUG ids and the known-issues match:
//   <error class> | <message> | <frame> | <step>
//   error class  the first `<Name>Error` in the first three lines of the message, else `expect.<matcher>` of the
//                assertion, else `Timeout` for "Timeout <n>ms exceeded", else `Error` (k6: `k6-threshold`)
//   message      the first non-empty line without its `Error:` prefix; every id (EP-, API-, TC-, K6-, NI-, CL-, BUG-),
//                uuid, long hex string and number replaced by <id>, <uuid>, <hex>, <n>; whitespace collapsed; 200 chars
//   frame        the first stack frame outside tests/ and node_modules (the spec itself when no other frame), as a path
//                from its known folder (pages/, helpers/, clients/ ...) without the line number
//   step         ui: the locator or call the failure waited for (call log "waiting for" or "Locator:" line, erased the same way)
//                api: the scenario's endpoint id; k6: the failed metrics, sorted
// -> null when there is no error text.
export function erase(s) {
  return String(s)
    .replace(/\b(?:EP|API|TC|K6|NI|CL|BUG)-[A-Za-z0-9-]*\d+\b/g, "<id>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>")
    .replace(/\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{12,}\b/gi, "<hex>")
    .replace(/\d+(?:\.\d+)?/g, "<n>")
    .replace(/\s+/g, " ")
    .trim();
}
const NOT_SPEC = /(^|\/)node_modules\/|@playwright|playwright-core/;
function frameOf(frames) {
  const list = (frames ?? []).map(slash).filter((f) => !NOT_SPEC.test(f));
  const pick = list.find((f) => !/(^|\/)tests\//.test(f.replace(/:\d+$/, ""))) ?? list[0];
  if (!pick) return "";
  const file = pick.replace(/:\d+$/, "");
  return /(?:^|\/)((?:pages|components|helpers|clients|fixtures|utils|config|lib|tests)\/.*)$/.exec(file)?.[1] ?? path.posix.basename(file);
}
export function signatureOf({ kind, error, frames, step } = {}) {
  const text = stripAnsi(error);
  if (!text.trim()) return null;
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let cls;
  if (kind === "k6") cls = "k6-threshold";
  else {
    cls = /\b([A-Za-z]*Error)\b/.exec(lines.slice(0, 3).join("\n"))?.[1];
    if (!cls || cls === "Error") cls = /\bexpect\([^)]*\)\.(?:not\.)?(\w+)/.exec(text) ? `expect.${/\bexpect\([^)]*\)\.(?:not\.)?(\w+)/.exec(text)[1]}` : /Timeout \d+ms exceeded/.test(text) ? "Timeout" : "Error";
  }
  const message = erase(clip(lines[0].replace(/^(?:[A-Za-z]*Error):\s*/, ""), 400)).slice(0, 200);
  return [cls, message, kind === "k6" ? "" : frameOf(frames), erase(step ?? "") || ""].join(" | ");
}

// ---------- paths ----------
export function triagePaths(productDir, module, runId, domain) {
  const fw = DOMAINS[domain];
  const dir = path.join(productDir, "results", runId, module, fw);
  return {
    framework: fw, dir, productDir, module, runId, domain,
    results: path.join(dir, "results.json"),
    triage: path.join(dir, "triage.json"),
    md: path.join(dir, "triage.md"),
    overlay: path.join(dir, "triage-overlay.json"),
    registry: path.join(productDir, "modules", module, "triage", "triage-registry.json"),
    knownIssues: path.join(productDir, "known-issues.json"),
  };
}

const inputsOf = (tp) => ({ results: tp.results, knownIssues: tp.knownIssues, overlay: tp.overlay });

// null when triage.json exists and its verified stamp is current (the flow's `verify`), else why not.
export function triageUnverified(tp) {
  const t = readJson(tp.triage, null);
  if (!t) return "triage.json is missing: run triage.mjs build and check";
  return unverifiedReason(t.verified, inputsOf(tp), { unstamped: "the triage did not pass triage.mjs check", changed: "the results, the overlay or known-issues.json changed after triage.mjs check" });
}

// ---------- evidence and expectation ----------
// ctx: {root, product, productDir, moduleDir, pwProject, k6Project, cases (Set of approved ids), rows (clarifications), plan (Map), workload (Map)}
export function evidenceProblem(p, ctx) {
  const rel = slash(String(p));
  if (!rel || path.isAbsolute(rel) || /^[a-z]:/i.test(rel) || rel.includes(":")) return `evidence '${p}': give a path relative to the repo root`;
  const abs = path.resolve(ctx.root, rel);
  const bases = [ctx.productDir, ctx.pwProject, ctx.k6Project].map((b) => path.resolve(b));
  if (!bases.some((b) => path.relative(b, abs) && !path.relative(b, abs).startsWith("..") && !path.isAbsolute(path.relative(b, abs)))) return `evidence '${p}': must be a file of this product (artifacts/, playwright-tests/ or k6-tests/)`;
  if (!existsSync(abs) || !statSync(abs).isFile()) return `evidence '${p}': no such file`;
  return null;
}

// scenario:<API or K6 id> | testcase:<id> | clarification:<id> | knowledge:<path> (spec: and observation: too) -> null or why not.
// Compared exactly: a plan or workload id is looked up in its Map, a citation resolves through lib/citations.mjs.
export function expectationProblem(exp, row, ctx) {
  if (!exp) return "no expectation source (scenario:<id>, testcase:<id>, clarification:<id> or knowledge:<path>)";
  const m = /^scenario:(.+)$/.exec(exp);
  if (!m) return citationProblem(exp, ctx);
  if (m[1].startsWith("API-")) return ctx.plan.has(m[1]) ? null : `'${exp}': no such scenario in the API plan`;
  if (m[1].startsWith("K6-")) {
    const sc = ctx.workload.get(m[1]);
    if (!sc) return `'${exp}': no such scenario in workload.json`;
    // an assumed threshold (G7) is the framework's guess, never an expectation source: a failed SLO threshold is
    const failed = row?.k6Id === m[1] ? (row.failedThresholds ?? []) : sc.thresholds.map((t) => ({ source: t.source }));
    return failed.some((t) => String(t.source).startsWith("slo:")) ? null : `'${exp}': its failed thresholds are assumed or generated, not an SLO: cite a clarification, test case or knowledge instead`;
  }
  return `'${exp}': a scenario is an API-<m>-<n> or K6-<m>-<n> id`;
}

// ---------- the rules ----------
const ENV_PATTERNS = [
  /\b(ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|ETIMEDOUT|EHOSTUNREACH)\b/,
  /net::ERR_(CONNECTION_REFUSED|NAME_NOT_RESOLVED|CONNECTION_RESET|INTERNET_DISCONNECTED|CONNECTION_TIMED_OUT|ADDRESS_UNREACHABLE)/,
  /getaddrinfo\b/i,
  /connection refused/i,
  /\b(BASE_URL|API_BASE_URL|STORAGE_STATE|ATF_[A-Z_]+)\b[^.\n]{0,40}\b(is not set|not set|undefined|missing|required)\b/i,
  /(storage ?state|auth state|\.auth[\\/])[^\n]{0,60}(not found|ENOENT|missing|expired|does not exist)/i,
  /\bsession\b[^.\n]{0,20}\b(expired|is missing|missing|not found)\b/i,
];
const SERVER_ERROR = /\b(?:status(?: code)?:?\s*|Received:\s*|HTTP\/\d(?:\.\d)?\s+|returned\s+)5\d\d\b|\b5\d\d\s+(?:Internal Server Error|Bad Gateway|Service Unavailable|Gateway Time-?out)\b/i;
const LOCATOR_ZERO = /expect\(locator\)\.not\.toHaveCount\(expected\)|Expected:\s*1\s*\n\s*Received:\s*0\b/;
const LOCATOR_TIMEOUT = /Timeout \d+ms exceeded[\s\S]*waiting for (?:getBy[A-Za-z]+|locator|frameLocator)\(/;

export function isEnvironment(item, { setup } = {}) {
  const e = stripAnsi(item.error);
  if (ENV_PATTERNS.some((re) => re.test(e))) return "the error names an unreachable target, a missing environment variable or a missing session";
  if ((item.project ?? "").startsWith("setup-") && SERVER_ERROR.test(e)) return "the auth setup got a server error (5xx)";
  if (setup) return null;
  if (typeof item.httpFailRate === "number" && item.httpFailRate >= 0.999 && item.status !== "passed") return "every request failed: the target was unreachable or refused them";
  return null;
}
export function isLocatorDrift(item, domain) {
  if (domain !== "ui") return null;
  const e = stripAnsi(item.error);
  if (item.smoke && LOCATOR_ZERO.test(e)) return "the locator smoke found a page-object locator (or a recorded control) with count 0";
  if (!item.smoke && LOCATOR_TIMEOUT.test(e)) return "a page-object locator timed out waiting for its element";
  return null;
}
const inClass = (cls, n) => (cls === "2xx" ? n >= 200 && n < 300 : cls === "4xx" ? n >= 400 && n < 500 : cls === "non-5xx" ? n < 500 : null);

// ---------- rows ----------
const idOf = (r) => r.tcId ?? r.scenarioId ?? r.k6Id ?? r.key;
const KEEP = ["tcId", "scenarioId", "tcIds", "k6Id", "attempts", "passedOnRetry", "error"];

function relEvidence(p, root) {
  const s = slash(p);
  if (path.isAbsolute(s) || /^[a-z]:/i.test(s)) {
    const r = path.relative(root, s);
    return r && !r.startsWith("..") && !path.isAbsolute(r) ? slash(r) : null;
  }
  return s;
}

function gather(ctx, tp) {
  const root = ctx.root;
  const results = readJson(tp.results, null);
  const known = readJson(tp.knownIssues, { issues: [] }).issues ?? [];
  const sum = approvalSummary(ctx.productDir, ctx.module);
  const status = approvalStatus(sum.cases, readApprovals(testcasePaths(ctx.productDir, ctx.module), ctx.module));
  const mine = (c) => (ctx.domain === "ui" ? !c.api : ctx.domain === "api" ? !!c.api : false);
  const cases = new Map(sum.cases.filter(mine).map((c) => [c.id, { ...c, st: status.get(c.id)?.status }]));
  const planFile = planPaths(ctx.productDir, ctx.module).plan;
  const plan = new Map((Array.isArray(readJson(planFile, [])) ? readJson(planFile, []) : []).map((s) => [s.id, s]));
  const wl = new Map((workloadScenarios(workloadPaths(ctx.productDir, ctx.module).workload) ?? []).map((s) => [s.id, s]));
  const approved = new Set(sum.approved);
  let csv = [];
  try {
    csv = readRows(csvPath(ctx.productDir, ctx.module));
  } catch {
    csv = [];
  }
  const cctx = { root, product: ctx.product, productDir: ctx.productDir, moduleDir: path.join(ctx.productDir, "modules", ctx.module), pwProject: ctx.pwProject, k6Project: ctx.k6Project, cases: approved, rows: csv, plan, workload: wl };
  return { results, known, cases, plan, wl, approved, cctx };
}

// -> {rows, notFailures, problems}: the rule-decided rows, before the overlay.
function ruleRows(ctx, tp, g) {
  const { results, known, cases, plan, wl } = g;
  const mode = ctx.run.mode;
  const rows = [];
  const notFailures = [];
  const problems = [];
  if (!results) return { rows, notFailures, problems: [`${path.relative(ctx.root, tp.results).replaceAll("\\", "/")} is missing: record the results first (results.mjs)`] };
  const items = results.items ?? [];
  const seen = new Set();
  const keyOf = (prefix, id) => {
    let k = `${prefix}:${id}`;
    for (let n = 2; seen.has(k); n++) k = `${prefix}:${id}#${n}`;
    seen.add(k);
    return k;
  };
  const withItem = new Set(items.map((i) => i.tcId ?? i.scenarioId ?? i.k6Id).filter(Boolean));
  const setupFailed = items.some((i) => (i.project ?? "").startsWith("setup-") && i.status === "failed");
  const idFor = (i) => i.tcId ?? i.scenarioId ?? i.k6Id;
  const mutates = (id) => (ctx.domain === "ui" ? cases.get(id)?.mutates : ctx.domain === "api" ? plan.get(id)?.mutates : wl.get(id)?.mutates);
  const base = (extra) => ({ evidence: [], class: null, classSource: null, rule: null, reason: null, cite: null, healable: false, fixHint: null, expectation: null, knownIssue: null, note: null, cluster: null, signature: null, ...extra });
  const set = (row, cls, rule, reason, extra = {}) => Object.assign(row, { class: cls, classSource: "rule", rule, reason, ...extra });

  for (const it of items.filter((i) => i.status !== "passed")) {
    const id = idFor(it);
    const row = base({ key: keyOf(ctx.domain, id ?? `~${it.file ?? ""}|${it.title}`), title: clip(it.title, 300), ...(it.file ? { file: it.file } : {}), status: it.status });
    for (const k of KEEP) if (it[k] !== undefined) row[k] = k === "error" ? clip(stripAnsi(it[k]), 2000) : it[k];
    if (it.thresholds) row.failedThresholds = it.thresholds.filter((t) => !t.ok).map((t) => ({ metric: t.metric, expr: t.expr, source: wl.get(id)?.thresholds.find((x) => x.metric === t.metric && x.expr === t.expr)?.source ?? "unknown", assumed: !!wl.get(id)?.thresholds.find((x) => x.metric === t.metric && x.expr === t.expr)?.assumed }));
    row.evidence = [...new Set((it.attachments ?? []).map((a) => relEvidence(a.path, ctx.root)).filter((p) => p && !evidenceProblem(p, g.cctx)))];
    const step = ctx.domain === "ui" ? /waiting for ([^\n]+)|Locator:\s*([^\n]+)/.exec(stripAnsi(it.error))?.slice(1).find(Boolean) : ctx.domain === "api" ? plan.get(id)?.endpoint : [...new Set((row.failedThresholds ?? []).map((t) => t.metric))].sort().join(",");
    row.signature = signatureOf({ kind: ctx.domain === "k6" ? "k6" : "pw", error: it.error, frames: it.frames, step });
    const unapproved = cases.has(id) && !["approved", "rejected"].includes(cases.get(id).st);
    if (it.smoke && it.status === "skipped") {
      notFailures.push({ key: row.key, reason: `locator smoke skipped by the generator: ${it.skipReason ?? "no reason recorded"}` });
      seen.delete(row.key);
      continue;
    }
    if (unapproved || (it.status === "skipped" && /awaiting approval/i.test(it.skipReason ?? ""))) set(row, "awaiting-approval", "awaiting-approval", RULES["awaiting-approval"]);
    else if (mode === "readonly" && it.status === "skipped" && mutates(id)) set(row, "blocked-by-mode", "hidden-mutates", RULES["hidden-mutates"]);
    else if (it.passedOnRetry || it.status === "flaky") set(row, "flaky", "pass-on-retry", `${RULES["pass-on-retry"]} (${it.attempts ?? 2} attempts)`);
    else if (row.signature && known.some((k) => k.signature === row.signature && (!k.module || k.module === ctx.module))) {
      const k = known.find((x) => x.signature === row.signature && (!x.module || x.module === ctx.module));
      set(row, "known-issue", "known-issue", `known issue ${k.id}: ${k.title} (${k.reference})`, { knownIssue: k.id });
    } else {
      const env = isEnvironment(it);
      const drift = env ? null : isLocatorDrift(it, ctx.domain);
      if (ctx.domain === "ui" && LEDGER_GUARD_RE.test(stripAnsi(it.error ?? ""))) set(row, "test-bug", "ledger-guard", RULES["ledger-guard"], { healable: true, fixHint: "record the entity with the id the product uses as its ref (recordCreated), and delete only what owns() confirms this run created" });
      else if (env) set(row, "environment", "environment", env);
      else if (drift) set(row, "locator-drift", "locator-drift", drift, { healable: true, fixHint: "re-ground the page-object locator in the exploration snapshot of its state (the locator smoke names it)" });
      else if (ctx.domain === "api" && it.status === "failed") {
        const exp = plan.get(id)?.expect;
        const n = Number(/Received:\s*(\d{3})\b/.exec(stripAnsi(it.error))?.[1]);
        if (exp?.statusClass && exp.source === "class-only" && !plan.get(id)?.steps?.length && Number.isInteger(n) && inClass(exp.statusClass, n) !== null) {
          if (inClass(exp.statusClass, n)) {
            notFailures.push({ key: row.key, reason: `actual ${n} is inside the class-only expectation ${exp.statusClass}` });
            seen.delete(row.key);
            continue;
          }
          set(row, "product-bug", "api-class-only", `actual ${n} is outside the class-only expectation ${exp.statusClass}: a candidate product bug`, { expectation: `scenario:${id}` });
        }
      }
    }
    if (it.status === "skipped" && !row.class && it.skipReason) row.note = clip(`skipped: ${it.skipReason}`, 300);
    rows.push(row);
  }

  // what the run never showed
  if (results.status === "ran") {
    for (const [id, c] of cases) {
      if (withItem.has(id)) continue;
      const title = clip(`${id} ${c.title ?? ""}`.trim(), 300);
      if (!["approved", "rejected"].includes(c.st)) rows.push(set(base({ key: keyOf(ctx.domain, id), title, status: "unapproved", [ctx.domain === "ui" ? "tcId" : "tcIds"]: ctx.domain === "ui" ? id : [id] }), "awaiting-approval", "awaiting-approval", RULES["awaiting-approval"]));
      else if (c.st === "approved" && mode === "readonly" && c.mutates && ctx.domain === "ui") rows.push(set(base({ key: keyOf(ctx.domain, id), title, status: "hidden", tcId: id }), "blocked-by-mode", "hidden-mutates", RULES["hidden-mutates"]));
      else if (c.st === "approved") rows.push(setupFailed ? set(base({ key: keyOf(ctx.domain, id), title, status: "missing", tcId: id }), "environment", "setup-failed", RULES["setup-failed"]) : base({ key: keyOf(ctx.domain, id), title, status: "missing", tcId: id, note: "approved, but the run reported no result for it" }));
    }
    if (ctx.domain === "api") {
      for (const [id, s] of plan) {
        if (withItem.has(id)) continue;
        const title = clip(`${id} ${s.title ?? ""}`.trim(), 300);
        if (mode === "readonly" && s.mutates) rows.push(set(base({ key: keyOf("api", id), title, status: "hidden", scenarioId: id }), "blocked-by-mode", "hidden-mutates", RULES["hidden-mutates"]));
        else rows.push(setupFailed ? set(base({ key: keyOf("api", id), title, status: "missing", scenarioId: id }), "environment", "setup-failed", RULES["setup-failed"]) : base({ key: keyOf("api", id), title, status: "missing", scenarioId: id, note: "in the plan, but the run reported no result for it" }));
      }
    }
    if (ctx.domain === "k6") {
      for (const [id, s] of wl) {
        if (withItem.has(id)) continue;
        rows.push(base({ key: keyOf("k6", id), title: clip(`${id} ${s.name}`, 300), status: "missing", k6Id: id, note: "in workload.json, but the run reported no result for it (a failed smoke stops the heavier scripts)" }));
      }
    }
  } else if (ctx.domain === "k6" && mode === "readonly") {
    for (const [id, s] of wl) rows.push(set(base({ key: keyOf("k6", id), title: clip(`${id} ${s.name}`, 300), status: "hidden", k6Id: id }), "blocked-by-mode", "readonly-not-run", RULES["readonly-not-run"]));
  }
  return { rows, notFailures, problems };
}

// ---------- the overlay ----------
// -> {rows (with the agent's judgments), problems}
export function applyOverlay(rows, overlay, g) {
  const problems = [];
  const entries = new Map();
  for (const e of overlay?.rows ?? []) {
    if (entries.has(e.key)) problems.push(`triage-overlay.json: row '${e.key}' appears twice`);
    entries.set(e.key, e);
  }
  const keys = new Set(rows.map((r) => r.key));
  for (const k of entries.keys()) if (!keys.has(k)) problems.push(`triage-overlay.json: no row '${k}' in triage.json (rebuild, then re-key)`);
  const out = rows.map((r) => {
    const e = entries.get(r.key);
    if (!e) return r;
    const row = { ...r, evidence: [...r.evidence] };
    const ruled = r.classSource === "rule";
    if (e.class !== r.class) {
      if (ruled) {
        if (["blocked-by-mode", "awaiting-approval"].includes(r.class)) problems.push(`${r.key}: '${r.class}' is decided by the mode or the approval and cannot be overridden`);
        else if (r.class === "flaky" && e.class === "product-bug") problems.push(`${r.key}: a test that passed on retry is never a product bug`);
        else {
          const why = e.cite ? citationProblem(e.cite, g.cctx) : "an override of a rule-decided class needs a cite (clarification:, testcase:, knowledge:, spec: or observation:)";
          if (why) problems.push(`${r.key}: overriding ${r.rule} (${r.class}) -> ${e.class}: ${why}`);
        }
      } else if (SCRIPT_ONLY.includes(e.class)) problems.push(`${r.key}: '${e.class}' is decided by the script (mode, approval, known-issues.json), not by the triager`);
      row.class = e.class;
      row.classSource = "agent";
      row.rule = null;
      row.cite = e.cite ?? null;
      if (!HEALABLE_CLASSES.includes(e.class)) { row.healable = false; row.fixHint = null; }
    }
    row.reason = e.reason;
    if (e.healable !== undefined) row.healable = e.healable;
    if (e.fixHint) row.fixHint = e.fixHint;
    for (const p of e.evidence ?? []) if (!row.evidence.includes(p)) row.evidence.push(p);
    if (e.expectation) row.expectation = e.expectation;
    return row;
  });
  return { rows: out, problems };
}

// the rules `check` enforces on the final rows; overlayEvidence = the paths the agent named
export function rowProblems(rows, overlay, g) {
  const problems = [];
  const named = new Map((overlay?.rows ?? []).map((e) => [e.key, e.evidence ?? []]));
  for (const r of rows) {
    if (!r.class) problems.push(`${r.key}: unclassified (the rules left it open: add it to triage-overlay.json rows with a class and a reason)`);
    if (r.classSource === "agent" && !r.reason) problems.push(`${r.key}: the agent's class needs a reason`);
    for (const p of named.get(r.key) ?? []) {
      const why = evidenceProblem(p, g.cctx);
      if (why) problems.push(`${r.key}: ${why}`);
    }
    if (r.class === "product-bug") {
      if (!r.evidence.length) problems.push(`${r.key}: a product-bug needs evidence (a trace, screenshot or response capture that exists)`);
      const why = expectationProblem(r.expectation, r, g.cctx);
      if (why) problems.push(`${r.key}: product-bug expectation: ${why}`);
    }
    if (r.healable && !HEALABLE_CLASSES.includes(r.class)) problems.push(`${r.key}: healable is only for ${HEALABLE_CLASSES.join(" and ")}, not ${r.class}`);
    if (r.class === "test-bug" && r.classSource === "agent" && !(overlay?.rows ?? []).some((e) => e.key === r.key && typeof e.healable === "boolean")) problems.push(`${r.key}: a test-bug needs healable true or false`);
    if (r.healable && !r.fixHint) problems.push(`${r.key}: healable without a fix hint`);
  }
  return problems;
}

// ---------- clusters and bug drafts ----------
function clusterRows(rows, tp, { dry }) {
  const groups = new Map();
  for (const r of rows) if (r.signature && (r.class === null || r.class === "product-bug") && ["failed", "flaky"].includes(r.status)) (groups.get(r.signature) ?? groups.set(r.signature, []).get(r.signature)).push(r);
  const reg = readJson(tp.registry, null);
  const keyFor = (sig) => `${tp.domain}|${sig}`;
  const problems = [];
  let ids = new Map();
  if (dry) {
    for (const sig of groups.keys()) {
      const e = reg?.clusters?.[keyFor(sig)];
      if (!e) problems.push(`no stable BUG id for a failure signature (run triage.mjs build): ${sig.slice(0, 80)}`);
      else ids.set(sig, e.id);
    }
  } else {
    // keys of the module's other domains stay present, so assignIds does not mark them gone
    const others = Object.keys(reg?.clusters ?? {}).filter((k) => !k.startsWith(`${tp.domain}|`));
    const r = assignIds(tp.registry, [...groups.keys()].map(keyFor).concat(others), { module: tp.module, runId: tp.runId, prefix: "BUG", field: "clusters" });
    for (const sig of groups.keys()) ids.set(sig, r.clusters[keyFor(sig)].id);
  }
  const clusters = [...groups.entries()].map(([signature, rs]) => ({ id: ids.get(signature) ?? "BUG-?", signature, rows: rs.map((r) => r.key), ids: rs.map(idOf) })).sort((a, b) => Number(a.id.split("-").at(-1)) - Number(b.id.split("-").at(-1)) || a.signature.localeCompare(b.signature));
  const byKey = new Map(rows.map((r) => [r.key, r]));
  for (const c of clusters) for (const k of c.rows) byKey.get(k).cluster = c.id;
  return { clusters, problems };
}

function textOf(file, ctx) {
  try {
    const abs = path.resolve(ctx.root, file);
    return statSync(abs).size < 1_000_000 ? readFileSync(abs, "utf8") : "";
  } catch {
    return "";
  }
}
const norm = (s) => stripAnsi(s).replace(/\s+/g, " ").trim();

export function bugProblems(rows, clusters, overlay, g) {
  const problems = [];
  const drafts = new Map();
  for (const b of overlay?.bugs ?? []) {
    if (drafts.has(b.cluster)) problems.push(`${b.cluster}: two bug drafts`);
    drafts.set(b.cluster, b);
  }
  const byKey = new Map(rows.map((r) => [r.key, r]));
  for (const c of clusters) {
    const bugs = c.rows.map((k) => byKey.get(k)).filter((r) => r.class === "product-bug");
    const d = drafts.get(c.id);
    if (!bugs.length) {
      if (d) problems.push(`${c.id}: a bug draft, but no row of the cluster is a product-bug`);
      continue;
    }
    if (!d) {
      problems.push(`${c.id}: a product-bug cluster without a bug draft (${bugs.map(idOf).join(", ")})`);
      continue;
    }
    const want = [...new Set(bugs.map(idOf))].sort();
    const have = [...new Set(d.affected)].sort();
    if (want.length !== have.length || want.some((x, i) => x !== have[i])) problems.push(`${c.id}: affected must be exactly the product-bug rows' ids (${want.join(", ")})`);
    for (const p of d.evidence) {
      const why = evidenceProblem(p, g.cctx);
      if (why) problems.push(`${c.id}: ${why}`);
    }
    const why = expectationProblem(d.expected.source, bugs[0], g.cctx);
    if (why) problems.push(`${c.id}: expected.source: ${why}`);
    const quote = norm(d.actual.quote);
    const corpus = [...bugs.map((r) => norm(r.error ?? "")), ...d.evidence.filter((p) => !evidenceProblem(p, g.cctx)).map((p) => norm(textOf(p, g.cctx)))];
    if (!quote || !corpus.some((t) => t.includes(quote))) problems.push(`${c.id}: actual.quote must be quoted from a row's error or a cited evidence file`);
  }
  for (const k of drafts.keys()) if (!clusters.some((c) => c.id === k)) problems.push(`${k}: a bug draft for no cluster of triage.json`);
  return problems;
}

// ---------- build / check ----------
function compute(ctx, { dry }) {
  const tp = triagePaths(ctx.productDir, ctx.module, ctx.run.runId, ctx.domain);
  const g = gather(ctx, tp);
  const r = ruleRows(ctx, tp, g);
  if (r.problems.length) return { problems: r.problems, tp, g };
  const overlay = existsSync(tp.overlay) ? readJson(tp.overlay, null) : null;
  const applied = applyOverlay(r.rows, overlay, g);
  const cl = clusterRows(applied.rows, tp, { dry });
  const byClass = Object.fromEntries(CLASSES.map((c) => [c, applied.rows.filter((x) => x.class === c).length]).filter(([, n]) => n));
  const totals = g.results?.totals ?? null;
  const triage = {
    module: ctx.module, domain: ctx.domain, framework: tp.framework, runId: ctx.run.runId, mode: ctx.run.mode,
    inputs: { results: sha256(tp.results), knownIssues: sha256(tp.knownIssues), overlay: sha256(tp.overlay) },
    summary: { rows: applied.rows.length, open: applied.rows.filter((x) => !x.class).length, byClass, clusters: cl.clusters.length },
    rows: applied.rows, clusters: cl.clusters, notFailures: r.notFailures,
  };
  const overlayProblems = [...applied.problems, ...rowProblems(applied.rows, overlay, g), ...bugProblems(applied.rows, cl.clusters, overlay, g)];
  return { problems: cl.problems, tp, g, triage, overlay, overlayProblems, totals };
}

export function renderMd(triage, totals, overlay) {
  const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
  const L = [
    `# Triage -- ${triage.framework} / ${triage.module}`,
    `Run: ${triage.runId} (${triage.mode})   Totals: ${totals ? `${totals.passed}/${totals.total} passed, ${totals.failed} failed, ${totals.flaky} flaky, ${totals.skipped} skipped` : "no results"}`,
    "| Test | File | Classification | Healable | Evidence | Suggested action |",
    "|---|---|---|---|---|---|",
  ];
  for (const r of triage.rows) L.push(`| ${cell(r.title)} | ${cell(r.file ?? "")} | ${r.class ?? "OPEN"}${r.cluster ? ` (${r.cluster})` : ""} | ${r.healable ? "yes" : "no"} | ${cell(r.evidence.join(", "))} | ${cell(r.fixHint ?? r.reason ?? r.note ?? "")} |`);
  L.push("", `Classes: ${Object.entries(triage.summary.byClass).map(([c, n]) => `${c} ${n}`).join(", ") || "none"}${triage.summary.open ? `; ${triage.summary.open} open` : ""}`, "");
  if (triage.clusters.length) {
    L.push("Failure clusters (one bug draft per product-bug cluster):");
    for (const c of triage.clusters) L.push(`- ${c.id}: ${c.ids.join(", ")} -- ${c.signature}`);
    L.push("");
  }
  for (const b of overlay?.bugs ?? []) L.push(`Bug draft ${b.cluster} [${b.severity}]: ${b.title}`, `- expected: ${b.expected.text} (${b.expected.source})`, `- actual: "${b.actual.quote}"`, `- affected: ${b.affected.join(", ")}`, `- evidence: ${b.evidence.join(", ")}`, "");
  if (triage.notFailures.length) {
    L.push("Not failures:");
    for (const n of triage.notFailures) L.push(`- ${n.key}: ${n.reason}`);
    L.push("");
  }
  return L.join("\n");
}

// -> {problems, overlayProblems, summary}; writes triage.json, triage.md (and the registry) only without problems.
export async function build(ctx, validate) {
  const tp = triagePaths(ctx.productDir, ctx.module, ctx.run.runId, ctx.domain);
  for (const [name, file, schema] of [["triage-overlay.json", tp.overlay, "triage-overlay"], ["known-issues.json", tp.knownIssues, "known-issues"]]) {
    if (!existsSync(file)) continue;
    let data;
    try {
      data = JSON.parse(readFileSync(file, "utf8"));
    } catch (e) {
      return { problems: [`${name}: not valid JSON`] };
    }
    const bad = await validate(schema, data);
    if (bad.length) return { problems: bad.map((e) => `${name}: ${e}`) };
  }
  const r = compute(ctx, { dry: false });
  if (r.problems.length) return { problems: r.problems };
  const bad = await validate("triage", r.triage);
  if (bad.length) return { problems: bad.map((e) => `triage.json: ${e}`) };
  writeJson(tp.triage, r.triage);
  writeMd(tp, renderMd(r.triage, r.totals, r.overlay));
  return { problems: [], overlayProblems: r.overlayProblems, summary: r.triage.summary, tp };
}
const writeMd = (tp, text) => writeAtomic(tp.md, text);

export async function check(ctx, validate) {
  const tp = triagePaths(ctx.productDir, ctx.module, ctx.run.runId, ctx.domain);
  const problems = [];
  const have = readJson(tp.triage, null);
  if (!have) return ["triage.json is missing: run triage.mjs build"];
  problems.push(...(await validate("triage", have)).map((e) => `triage.json: ${e}`));
  for (const [name, file, schema] of [["triage-overlay.json", tp.overlay, "triage-overlay"], ["known-issues.json", tp.knownIssues, "known-issues"]]) {
    if (!existsSync(file)) continue;
    try {
      problems.push(...(await validate(schema, JSON.parse(readFileSync(file, "utf8")))).map((e) => `${name}: ${e}`));
    } catch {
      problems.push(`${name}: not valid JSON`);
    }
  }
  if (problems.length) return problems;
  if (have.inputs?.results !== sha256(tp.results)) return ["stale: results.json changed after triage.mjs build (record again if needed, then build)"];
  const r = compute(ctx, { dry: true });
  if (r.problems.length) return r.problems;
  const { verified, ...mine } = have;
  if (JSON.stringify(mine) !== JSON.stringify(r.triage)) problems.push("triage.json differs from a fresh build (an edited file, or the overlay, known-issues.json or the cases changed): run triage.mjs build");
  problems.push(...r.overlayProblems);
  if (!problems.length) writeJson(tp.triage, { ...r.triage, verified: stampVerified(inputsOf(tp)) });
  else if (have.verified) writeJson(tp.triage, mine);
  return problems;
}

// ---------- prepare ----------
// Clears the stale output of the previous run so evidence and summaries can never be mistaken for this run's:
// k6: k6-tests/<p>/results/<m>-*.{summary,created,untracked}.json (a longer module's files are left alone);
// ui/api: playwright-tests/<p>/test-results/<side>/<m>/ and <m>-report.json (other modules' evidence is kept).
export function prepare(ctx) {
  const removed = [];
  if (ctx.domain === "k6") {
    const dir = path.join(ctx.k6Project, "results");
    const longer = ctx.run.modules.filter((m) => m !== ctx.module && m.startsWith(`${ctx.module}-`));
    if (existsSync(dir))
      for (const f of readdirSync(dir)) {
        if (!f.startsWith(`${ctx.module}-`) || !/\.(summary|created|untracked)\.json$/.test(f) || longer.some((m) => f.startsWith(`${m}-`))) continue;
        rmSync(path.join(dir, f));
        removed.push(slash(path.relative(ctx.root, path.join(dir, f))));
      }
  } else {
    // only this module's output dir and report: other modules' cited evidence stays
    const side = path.join(ctx.pwProject, "test-results", ctx.domain);
    for (const p of [path.join(side, ctx.module), path.join(side, `${ctx.module}-report.json`)])
      if (existsSync(p)) {
        rmSync(p, { recursive: true, force: true });
        removed.push(slash(path.relative(ctx.root, p)));
      }
  }
  return { removed };
}
