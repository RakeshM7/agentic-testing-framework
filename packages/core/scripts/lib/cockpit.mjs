// The data behind the VS Code Cockpit (D-111): one read-only JSON object that joins what the run state, the test cases,
// the results, the triage and the ledger already say. It computes nothing the scripts did not decide and writes nothing:
// no run state, no lock, no report file, no bug draft (bug-export.mjs writes, so its draft paths are computed here).
// Reused as is: report-data collect() (queues, triage classes, failed, blocked and unverified stages, effort, leftovers,
// customConfig), run.mjs status() and next() (never nextStep, which writes), testcases approvalSummary/approvalStatus,
// ledger read/live, triagePaths, the results.json items, and the ui-code, api-code and workload coverage ledgers.
//
//   import { cockpitData } from "./lib/cockpit.mjs";  await cockpitData(product, { root })
//
// The shape is docs/cockpit-plan.md C1. A source that is not there is listed in `missing`, never a silent zero. With no
// run yet the object is empty and `missing` says so. The environment comes from ATF_ENV, as for every script.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { STEPS, paths, workspaceRoot } from "./contract.mjs";
import { tryReadJson } from "./files.mjs";
import { read as readLedger, live as liveEntries } from "./ledger.mjs";
import yaml from "js-yaml";
import { CONFIG_FILES, configLocation } from "./config.mjs";
import { approvalStatus, approvalSummary, caseTypeOf, readApprovals, testcasePaths } from "./testcases.mjs";
import { triagePaths } from "./triage.mjs";
import { workloadPaths } from "./workload.mjs";
import { effort } from "./telemetry.mjs";
import { readIssues, issuesPath } from "./framework-issues.mjs";
import { collect } from "../report-data.mjs";
import { FRAMEWORKS } from "../results.mjs";
import { approvedOfType, next as runNext, status as runStatus } from "../run.mjs";

export const COCKPIT_VERSION = 1;

const DOMAIN = { "playwright-ui": "ui", "playwright-api": "api", k6: "k6" };
const slash = (f) => String(f).replaceAll("\\", "/");
const ms = (a, b) => (a && b ? Math.max(0, Date.parse(b) - Date.parse(a)) : null);
const arr = (x) => (Array.isArray(x) ? x : []);
const clip = (ids) => ids.slice(0, 20);

const EXPLAIN = {
  readonly: "Read-only: the agents observe the product and never create, change or delete anything in it.",
  "full-run": "Full run: the agents may create and change data the run needs, and delete only what this run created (the ledger).",
};

const emptyData = (product, environment, generatedAt, reason, root) => ({
  schemaVersion: COCKPIT_VERSION,
  product,
  environment,
  generatedAt,
  run: null,
  overview: { stages: [], next: [], needsYou: [], intents: {} },
  timeline: { stages: [], totals: { durationMs: 0, spawns: 0 }, history: history(null) },
  trace: { modules: [] },
  failures: { byClass: {}, clusters: [], healable: [], unverified: [] },
  safety: { ...plannedSafety(product, environment, root), ledger: { file: null, entries: [], live: 0, cleaned: 0 }, frameworkIssues: 0 },
  missing: [{ section: "run", module: null, reason }],
});

// Before the first run: the mode and permissions the next run would take from the product's run-config
// (config/<product>[-<env>].yaml, read only; run.mjs start resolves the mode into run.json when the run starts, and a
// missing mode is readonly there too). `planned: true` says it is not a run's resolved mode.
function plannedSafety(product, environment, root) {
  const rel = `config/${product}${environment === "default" ? "" : `-${environment}`}.yaml`;
  const none = { mode: null, planned: false, configFile: null, explanation: "No run yet, and no run-config to read a safety mode from.", customConfig: null };
  let cfg;
  try {
    cfg = yaml.load(readFileSync(path.join(root, rel), "utf8"));
  } catch {
    return none;
  }
  const mode = cfg?.authorizations?.mode ?? "readonly";
  if (!EXPLAIN[mode]) return { ...none, configFile: rel, explanation: `No run yet; ${rel} sets an unknown safety mode, so a run would not start.` };
  // which files exist decides, as report-data customConfig shows it for a run; nothing is read or merged
  const own = typeof cfg.permissions_file === "string" && cfg.permissions_file;
  const at = (name) => configLocation(name, { workspace: root });
  const loc = at("permissions.yaml");
  const permissions = own ? { source: "run-config", files: [slash(own)] } : loc.source === "framework" ? null : { source: loc.source, files: loc.files };
  const other = CONFIG_FILES.filter((n) => n !== "permissions.yaml").map(at).filter((c) => c.source !== "framework");
  return {
    mode,
    planned: true,
    configFile: rel,
    explanation: `Before the first run: ${rel} sets this mode, and the run takes it when it starts. ${EXPLAIN[mode]}`,
    customConfig: { permissions, other },
  };
}

// Ended runs of this environment, newest first (state/history/<run>.json), with the report when it was rendered.
function history(p) {
  if (!p || !existsSync(p.historyDir)) return [];
  const out = [];
  for (const f of readdirSync(p.historyDir).filter((n) => n.endsWith(".json"))) {
    const h = tryReadJson(path.join(p.historyDir, f));
    if (!h?.runId) continue;
    const rep = path.join(p.results(h.runId), "report", "index.html");
    out.push({ runId: h.runId, outcome: h.outcome ?? null, createdAt: h.createdAt ?? null, endedAt: h.endedAt ?? null, report: existsSync(rep) ? slash(path.relative(p.root, rep)) : null });
  }
  return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || b.runId.localeCompare(a.runId)).slice(0, 20);
}

// The run's stages with their orchestration steps (state/orchestration/<stage>-<module>.json of this run).
function timelineStages(p, run) {
  return Object.entries(run.stages ?? {}).map(([key, s]) => {
    const [scope, stage] = key.split("/");
    const module = scope === "_product" ? null : scope;
    const orch = tryReadJson(path.join(p.orchestrationDir, `${stage}-${module}.json`));
    const steps = orch && orch.runId === run.runId ? Object.entries(orch.steps ?? {}).map(([name, x]) => ({ name, status: x.status ?? null, at: x.at ?? null, durationMs: x.status === "running" ? null : ms(x.startedAt, x.at) })) : [];
    return { key, stage, module, status: s.status, attempts: s.attempts ?? 0, startedAt: s.startedAt ?? null, finishedAt: s.finishedAt ?? null, durationMs: s.status === "running" ? null : ms(s.startedAt, s.finishedAt), error: s.error ?? null, reviewFailed: !!s.reviewFailed, findings: s.findings ?? [], steps };
  });
}

// The case -> automation -> result join of one module.
function traceModule(p, run, module, miss) {
  const tp = testcasePaths(p.productDir, module);
  const { built, cases } = approvalSummary(p.productDir, module);
  if (!built) {
    miss("trace", module, "testcases/coverage.json does not exist: no case to trace yet");
    return { module, cases: [] };
  }
  const st = approvalStatus(cases, readApprovals(tp, module));
  const mdir = p.module(module);
  const ledgerOf = (file, what) => {
    const d = tryReadJson(file);
    if (!d) miss("trace", module, `${what} is missing: its automation is not traced`);
    return d;
  };
  const uiLedger = ledgerOf(path.join(mdir, "ui-code", "coverage.json"), "ui-code/coverage.json");
  const apiLedger = ledgerOf(path.join(mdir, "api-code", "coverage.json"), "api-code/coverage.json");
  const plan = tryReadJson(path.join(mdir, "api", "plan.json"));
  const planCov = tryReadJson(path.join(mdir, "api", "plan-coverage.json"));
  const wl = ledgerOf(workloadPaths(p.productDir, module).coverage, "workload-coverage.json");
  const results = Object.fromEntries(FRAMEWORKS.map((fw) => [fw, tryReadJson(path.join(p.results(run.runId), module, fw, "results.json"))]));
  const triage = Object.fromEntries(FRAMEWORKS.map((fw) => [fw, tryReadJson(triagePaths(p.productDir, module, run.runId, DOMAIN[fw]).triage)]));
  const triageClass = (fw, it) => {
    const id = it.tcId ?? it.scenarioId ?? it.k6Id;
    const row = id ? arr(triage[fw]?.rows).find((r) => (r.tcId ?? r.scenarioId ?? r.k6Id) === id && r.status === it.status) : null;
    return row?.class ?? null;
  };
  const codeItem = (ledger, id) => arr(ledger?.items).find((i) => i.id === id);
  const reasonOf = (i) => i?.reason ?? i?.detail ?? i?.why ?? null;

  return {
    module,
    cases: cases.map((c) => {
      const type = caseTypeOf(c);
      const approval = st.get(c.id).invalidated ? "stale" : st.get(c.id).status === "awaiting" ? "pending" : st.get(c.id).status;
      const approved = approval === "approved";
      const none = { status: "none", reason: null };
      let ui = { ...none, files: [] };
      let api = { ...none, scenarios: [], files: [] };
      let k6 = { ...none, ids: [] };

      if (type === "ui") {
        const it = codeItem(uiLedger, c.id);
        ui = it ? { status: it.status, files: arr(it.refs).map(slash), reason: reasonOf(it) } : { status: approved ? "pending" : "none", files: [], reason: approved ? "no UI code ledger entry yet" : null };
      } else if (type === "api") {
        const scenarios = arr(plan?.scenarios).filter((s) => arr(s.testcases).includes(c.id)).map((s) => s.id);
        const items = scenarios.map((id) => codeItem(apiLedger, id)).filter(Boolean);
        const files = [...new Set(items.flatMap((i) => arr(i.refs)).map(slash))];
        const planItem = [...arr(planCov?.excluded), ...arr(planCov?.deferred)].find((x) => x.item === `testcase:${c.id}`);
        const status = items.length && items.every((i) => i.status === "mapped") ? "mapped" : planItem && !scenarios.length ? (arr(planCov?.excluded).includes(planItem) ? "excluded" : "deferred") : scenarios.length ? "pending" : approved ? "pending" : "none";
        api = { status, scenarios, files, reason: planItem ? (planItem.reason ?? planItem.detail ?? null) : status === "pending" && scenarios.length ? "scenarios planned, test code not mapped yet" : null };
      } else {
        const loaded = arr(wl?.loaded).find((x) => x.case === c.id);
        const ex = arr(wl?.excluded).find((x) => x.case === c.id);
        const de = arr(wl?.deferred).find((x) => x.case === c.id);
        k6 = loaded ? { status: "mapped", ids: arr(loaded.ids), reason: null } : ex ? { status: "excluded", ids: [], reason: ex.reason ?? ex.detail ?? null } : de ? { status: "deferred", ids: [], reason: de.detail ?? de.reason ?? null } : { status: approved ? "pending" : "none", ids: [], reason: null };
      }

      const rows = [];
      const push = (fw, it) => rows.push({ framework: fw, title: it.title, status: it.status, attempts: it.attempts ?? 1, passedOnRetry: !!it.passedOnRetry, triageClass: triageClass(fw, it) });
      for (const it of arr(results["playwright-ui"]?.items)) if (it.tcId === c.id) push("playwright-ui", it);
      for (const it of arr(results["playwright-api"]?.items)) if (arr(it.tcIds).includes(c.id) || (it.scenarioId && api.scenarios.includes(it.scenarioId) && !it.tcIds?.length)) push("playwright-api", it);
      for (const it of arr(results.k6?.items)) if (it.k6Id && k6.ids.includes(it.k6Id)) push("k6", it);
      return { id: c.id, title: c.title ?? null, types: [type], approval, automation: { ui, api, k6 }, results: rows };
    }),
  };
}

// Failures of every module and framework, from triage.json (rows, clusters) and its overlay (severity, bug drafts).
function failuresOf(p, run, report) {
  const clusters = [];
  const healable = [];
  for (const m of run.modules)
    for (const fw of FRAMEWORKS) {
      const tp = triagePaths(p.productDir, m, run.runId, DOMAIN[fw]);
      const t = tryReadJson(tp.triage);
      if (!t) continue;
      const drafts = arr(tryReadJson(tp.overlay)?.bugs);
      const n = arr(t.rows).filter((r) => r.healable).length;
      if (n) healable.push({ module: m, framework: fw, stage: fw, count: n });
      const bugFile = (id) => path.join(p.results(run.runId), "bugs", `${id}.md`);
      for (const c of arr(t.clusters)) {
        const rows = arr(t.rows).filter((r) => r.cluster === c.id);
        const d = drafts.find((b) => b.cluster === c.id);
        clusters.push({
          module: m, framework: fw, id: c.id, class: rows[0]?.class ?? null, severity: d?.severity ?? null, signature: c.signature, count: rows.length,
          rows: rows.map((r) => ({ key: r.key, title: r.title, ...(r.tcId ? { tcId: r.tcId } : {}), ...(r.scenarioId ? { scenarioId: r.scenarioId } : {}), ...(r.k6Id ? { k6Id: r.k6Id } : {}), error: r.error ?? null, ...(r.fixHint ? { fixHint: r.fixHint } : {}), evidence: arr(r.evidence).map(slash) })),
          // the draft's file exists once report-data.mjs exported it (bug-export.mjs); before that there is nothing to open
          bugDraft: d && existsSync(bugFile(c.id)) ? { file: slash(path.relative(p.root, bugFile(c.id))), title: d.title ?? null } : null,
        });
      }
    }
  return { byClass: report.totals.triage.byClass, clusters, healable, unverified: report.totals.triage.unverified };
}

export async function cockpitData(product, { root = workspaceRoot } = {}) {
  const p = paths(product, root);
  const generatedAt = new Date().toISOString();
  if (!existsSync(p.productDir)) throw new Error(`unknown product '${product}': no artifacts/${product} in this workspace`);
  if (!existsSync(p.runFile)) return emptyData(product, p.environment, generatedAt, "no run yet", root);
  const run = tryReadJson(p.runFile);
  if (!run) return emptyData(product, p.environment, generatedAt, "run.json is not valid JSON", root);

  const report = await collect(product, { root });
  const st = await runStatus(product, { root });
  const next = (await runNext(product, { root })).map(({ stage, module }) => ({ stage, module: module ?? null }));
  const missing = [...report.missing];
  const miss = (section, module, reason) => missing.push({ section, module: module ?? null, reason });

  const steps = run.steps ?? STEPS;
  const rowOf = (stage, module) => st.stages.find((r) => r.stage === stage && (r.module ?? null) === (module ?? null));

  // ---- needs you ----
  const needsYou = [];
  const clar = {};
  for (const q of report.queues.clarifications) (clar[q.module] ??= []).push(q.id);
  for (const [module, ids] of Object.entries(clar)) needsYou.push({ kind: "clarifications", module, stage: "clarifications", count: ids.length, text: `${ids.length} clarification${ids.length === 1 ? "" : "s"} of ${module} wait for your answer or approval.`, ids: clip(ids) });
  for (const q of report.queues.testcaseApprovals) {
    if (!q.built || !(q.awaiting + q.changes)) continue;
    const { cases } = approvalSummary(p.productDir, q.module);
    const stt = approvalStatus(cases, readApprovals(testcasePaths(p.productDir, q.module), q.module));
    const ids = cases.filter((c) => ["awaiting", "changes"].includes(stt.get(c.id).status)).map((c) => c.id);
    needsYou.push({ kind: "approval", module: q.module, stage: "testcases", count: ids.length, text: `${ids.length} test case${ids.length === 1 ? "" : "s"} of ${q.module} wait for your approval.`, ids: clip(ids) });
  }
  for (const b of report.blockedStages) needsYou.push({ kind: "blocked", module: b.module, stage: b.stage, count: 1, text: `${b.stage}${b.module ? ` of ${b.module}` : ""} is blocked by a stage it depends on.`, ids: [] });
  for (const f of report.failedStages) {
    const [scope, stage] = f.key.split("/");
    needsYou.push({ kind: "failed", module: scope === "_product" ? null : scope, stage, count: 1, text: `${stage}${scope === "_product" ? "" : ` of ${scope}`} failed${f.error ? `: ${String(f.error).split("\n")[0].slice(0, 160)}` : ""}.`, ids: [] });
  }
  for (const u of report.totals.triage.unverified) needsYou.push({ kind: "unverified", module: u.module, stage: u.framework, count: 1, text: `The triage of ${u.framework} for ${u.module} has not passed its check since the results changed.`, ids: [] });
  if (report.assumptions.k6Leftovers.length) needsYou.push({ kind: "leftovers", module: null, stage: null, count: report.assumptions.k6Leftovers.length, text: `${report.assumptions.k6Leftovers.length} entit${report.assumptions.k6Leftovers.length === 1 ? "y" : "ies"} this run created in the product ${report.assumptions.k6Leftovers.length === 1 ? "is" : "are"} still live (not cleaned up).`, ids: clip(report.assumptions.k6Leftovers.map((e) => `${e.type}:${e.ref}`)) });
  if (st.guard && st.guard.ready === false) needsYou.push({ kind: "guard", module: null, stage: null, count: 1, text: `The safety guard is not verified for this session: ${String(st.guard.reason ?? "").split(":")[0].slice(0, 200)}.`, ids: [] });

  // ---- intents ----
  const failures = failuresOf(p, run, report);
  const healableBy = {};
  for (const h of failures.healable) (healableBy[h.module] ??= []).push(h);
  const intents = {};
  for (const m of run.modules) {
    // An active run (its lock) never disables an intent: each one resumes it (lib/cli.mjs), and the orchestrator resolves
    // a missing prerequisite with the human (D-077), so only what the run's steps rule out is disabled here.
    const chosen = (step, label) => (steps.includes(step) ? null : `the ${label} step was not chosen for this run`);
    const ui = approvedOfType(p.productDir, m, "ui").approved.length;
    const api = approvedOfType(p.productDir, m, "api").approved.length;
    const perf = approvedOfType(p.productDir, m, "performance").approved.length;
    const automateWhy = !steps.some((s) => ["playwright-ui", "playwright-api"].includes(s)) ? "neither Playwright UI nor API was chosen for this run" : !ui && !api ? "no approved test case of this module yet" : null;
    const k6Why = !steps.includes("k6") ? "the k6 step was not chosen for this run" : !perf ? "no approved @performance test case of this module yet" : null;
    const heal = (healableBy[m] ?? []).find((h) => !rowOf(h.stage, m)?.exhausted && !rowOf(h.stage, m)?.notChosen);
    const flag = (why) => ({ enabled: !why, why: why ?? "" });
    intents[m] = {
      explore: flag(chosen("explore", "explore")),
      testcases: flag(chosen("testcases", "test cases")),
      automate: flag(automateWhy),
      k6: flag(k6Why),
      heal: { ...flag(heal ? null : (healableBy[m] ?? []).length ? "the stage that could heal it is exhausted or not chosen" : "no healable failure"), stage: heal?.stage ?? null },
    };
  }

  // ---- safety ----
  const all = readLedger(p.ledgerFile).filter((e) => e.runId === run.runId);
  const liveKeys = new Set(liveEntries(p.ledgerFile, run.runId).map((e) => `${e.type}\u0000${e.ref}`));
  const entries = all.map((e) => ({ ts: e.ts ?? null, event: e.event, type: e.type, ref: e.ref, ...(e.label ? { label: e.label } : {}), module: e.module ?? null, stage: e.stage ?? null, agent: e.agent ?? null, live: e.event === "created" && liveKeys.has(`${e.type}\u0000${e.ref}`) }));
  const resultsDir = p.results(run.runId);
  if (!existsSync(p.ledgerFile)) miss("safety", null, "ledger.jsonl does not exist: nothing was recorded as created");
  const timeline = timelineStages(p, run);
  const eff = effort({ run, stateDir: p.state });

  return {
    schemaVersion: COCKPIT_VERSION,
    product,
    environment: p.environment,
    generatedAt,
    run: { runId: run.runId, mode: run.mode, active: !!st.active, createdAt: run.createdAt ?? null, target: run.target?.url ?? null, modules: run.modules, steps },
    overview: { stages: st.stages, next, needsYou, intents },
    timeline: { stages: timeline, totals: { durationMs: eff.totals.stageMs, spawns: eff.totals.spawns }, history: history(p) },
    trace: { modules: run.modules.map((m) => traceModule(p, run, m, miss)) },
    failures,
    safety: {
      mode: run.mode ?? null,
      planned: false,
      configFile: run.configPath ?? null,
      explanation: EXPLAIN[run.mode] ?? "The run's safety mode is not recorded.",
      ledger: { file: slash(path.relative(root, p.ledgerFile)), entries, live: liveKeys.size, cleaned: all.filter((e) => e.event !== "created").length },
      customConfig: report.customConfig,
      frameworkIssues: arr(readIssues(issuesPath(resultsDir)).issues).length,
    },
    missing,
  };
}
