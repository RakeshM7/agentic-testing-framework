#!/usr/bin/env node
// Collects every number the report shows, deterministically, into
// artifacts/<product>/results/<run-id>/report/report.json (schema `report`, G11). The report is rendered from it by
// scripts/report.mjs; the report-generator only writes a cited narrative on top.
//
//   report-data.mjs <product>
//
// Data that is not there is never a silent zero: `missing` lists {section, module, reason} for every source that was
// absent or unreadable, and a ledger without its file is {available: false, reason}.
//
// modules[]            per module: explored (a non-empty sitemap), clarifications, test cases, approvals, Playwright
//                      specs, k6 scripts (ids of workload.json scenarios: <module>-<scenario name>.js), results, triage
// totals               the sums, execution totals per framework, triage class counts
// bugs                 product-bug clusters of triage.json: severity, evidence, affected ids (D-058)
// queues               test cases awaiting a human (approval.csv path per module), clarifications unanswered or
//                      awaiting approval with their next step
// coverage             every ledger (knowledge, explore, testcases, api plan, api code, ui code, workload): counts,
//                      per technique, what was deferred (budget) and excluded (reason)
// assumptions          assumed k6 thresholds, @assumption cases, agent-captured or stale rule facts, known limits (D-052)
// k6                   leftover entities of this run in the ledger, and the untracked creates of each script
// failedStages, blockedStages, awaitingApprovalStages   what the run did not finish, with open review findings
// customConfig         the framework config the run did not take from the framework's own copy: permissions.yaml (the
//                      safety ceiling: overlaid, ejected, or a run-config permissions_file) apart from the rest
// steps, notChosenStages  each step chosen or not for this run, and the stages it did not choose (never failed or blocked;
//                      `satisfiedBy` when an earlier run's outputs or an imported file stood in for one)
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STEPS, loadJson, paths, workspaceRoot } from "./lib/contract.mjs";
import { tryReadJson, writeJson } from "./lib/files.mjs";
import { csvPath, readRows, isAnswered, isAuthoritative } from "./lib/clarifications.mjs";
import { live as liveEntities } from "./lib/ledger.mjs";
import { FRAMEWORKS } from "./results.mjs";
import { status as runStatus } from "./run.mjs";
import { approvalSummary, testcasePaths } from "./lib/testcases.mjs";
import { triagePaths, triageUnverified } from "./lib/triage.mjs";
import { workloadPaths } from "./lib/workload.mjs";
import { effort } from "./lib/telemetry.mjs";
import { exportBugs } from "./lib/bug-export.mjs";

export const REPORT_VERSION = 1;
const TRIAGE_DOMAIN = { "playwright-ui": "ui", "playwright-api": "api", k6: "k6" };
const TOTAL_RE = /^Total test cases:\s*(\d+)\s*$/im;
const slash = (f) => f.replaceAll("\\", "/");

// Documented limits of the exploration's shape rule (D-052, docs/agent-handoffs.md): they hold for every explored module.
export const KNOWN_LIMITS = [
  { id: "D-052-split", source: "docs/agent-handoffs.md", text: "Some data still splits states: a record's status shown as a badge, a heading that names the record without repeating the page title, a record name in a dialog title, an owner shown as a plain button." },
  { id: "D-052-merge", source: "docs/agent-handoffs.md", text: "Some different screens still merge: section headings, a name equal to a part of the page title, record sub-page links such as Edit and Clone whose targets both erase to an id." },
];

function walk(dir, pred) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const f = path.join(dir, d.name);
    return d.isDirectory() ? walk(f, pred) : pred(d.name) ? [f] : [];
  });
}


// The run's customized framework config (docs/packaging.md §3.4), from run.json alone, or null for a run that predates
// provenance.config (nothing is guessed). permissions.yaml is the ceiling on every agent, so it is set apart: the
// recorded entry is the workspace's default (overlaid or ejected, or the framework's), and a run-config's own
// permissions_file replaced it when run.json permissionsPath is not that entry's files[0] (the framework's copy, or the
// ejected file, which is where init reads the default from). A run-config naming the framework's copy by path while an
// overlay exists reads as the overlay: a notice too many, never one too few.
export function customConfig(run, root = workspaceRoot) {
  const config = run.provenance?.config;
  if (!Array.isArray(config)) return null;
  const at = (f) => path.resolve(root, f);
  const perms = config.find((c) => c.name === "permissions.yaml");
  const ownFile = !perms || at(run.permissionsPath) !== at(perms.files[0]);
  const permissions = ownFile ? { source: "run-config", files: [slash(run.permissionsPath)] } : perms.source === "framework" ? null : { source: perms.source, files: perms.files };
  const other = config.filter((c) => c.name !== "permissions.yaml" && c.source !== "framework").map(({ name, source, files }) => ({ name, source, files }));
  return { permissions, other };
}

export function testcaseTotal(summaryFile) {
  if (!existsSync(summaryFile)) return null;
  const m = TOTAL_RE.exec(readFileSync(summaryFile, "utf8"));
  return m ? Number(m[1]) : null;
}

// The k6 scripts of a module: the scenarios of its workload.json name them (<module>-<scenario name>.js), so a module
// `deals` never counts the scripts of a module `deals-pipeline`. -> {planned, scripts, names} or null (no workload.json)
export function k6ScriptsOf(productDir, k6Project, module) {
  const wl = tryReadJson(workloadPaths(productDir, module).workload);
  const scenarios = wl && !Array.isArray(wl) && Array.isArray(wl.scenarios) ? wl.scenarios : null;
  if (!scenarios) return null;
  const names = [...new Set(scenarios.map((s) => s.name))].map((n) => `${module}-${n}`);
  const dir = path.join(k6Project, "scripts");
  const present = names.filter((n) => existsSync(path.join(dir, `${n}.js`)));
  return { planned: names.length, scripts: present.length, names, scenarios };
}

// Class counts and product-bug clusters of one framework's triage.json, or null when there is none. `verified` says
// whether triage.mjs check passed against the results on disk.
export function triageSummary(productDir, module, runId, fw) {
  const tp = triagePaths(productDir, module, runId, TRIAGE_DOMAIN[fw]);
  if (!existsSync(tp.triage)) return null;
  const t = tryReadJson(tp.triage);
  if (!t) return null;
  const drafts = existsSync(tp.overlay) ? (tryReadJson(tp.overlay)?.bugs ?? []) : [];
  const bugClusters = (t.clusters ?? [])
    .filter((c) => t.rows.some((r) => r.cluster === c.id && r.class === "product-bug"))
    .map((c) => {
      const d = drafts.find((b) => b.cluster === c.id);
      return { id: c.id, ids: c.ids, signature: c.signature, title: d?.title ?? null, severity: d?.severity ?? null, evidence: d?.evidence ?? [], affected: d?.affected ?? c.ids, draft: !!d };
    });
  return {
    verified: triageUnverified(tp) === null,
    rows: t.summary?.rows ?? t.rows.length,
    open: t.summary?.open ?? 0,
    byClass: t.summary?.byClass ?? {},
    healable: t.rows.filter((r) => r.healable).length,
    bugClusters,
  };
}

// ---------- ledgers ----------

const entry = (id, status, reason, detail) => ({ id: String(id), status, reason: reason ?? null, detail: detail ?? null });
const fromItems = (items) => (items ?? []).map((i) => entry(i.id, i.status, i.reason, i.detail ?? i.why));
const arrayItems = (x) => (Array.isArray(x) ? x : []);

// name -> (coverage json) -> {entries[], byTechnique?}. The ledgers differ in shape; each reader normalizes to
// {id, status: mapped|excluded|pending|deferred, reason, detail}.
const READERS = {
  testcases: (d) => ({ entries: fromItems(d.items), byTechnique: d.byTechnique }),
  "api-plan": (d) => ({
    entries: [
      ...arrayItems(d.mapped).map((i) => entry(i.item, "mapped")),
      ...arrayItems(d.excluded).map((i) => entry(i.item, "excluded", i.reason, i.detail)),
      ...arrayItems(d.deferred).map((i) => entry(i.item, "deferred", i.reason, i.detail)),
      ...arrayItems(d.pending).map((i) => (typeof i === "string" ? entry(i, "pending") : entry(i.item ?? i.id, "pending", null, i.why ?? i.detail))),
    ],
  }),
  "api-code": (d) => ({ entries: fromItems(d.items) }),
  "ui-code": (d) => ({ entries: fromItems(d.items) }),
  // one entry per approved @performance case (D-068); a ledger of an older build listed endpoints
  workload: (d) => ({
    entries: [
      ...arrayItems(d.loaded).map((i) => entry(i.case ?? i.endpoint, "mapped")),
      ...arrayItems(d.excluded).map((i) => entry(i.case ?? i.endpoint, "excluded", i.reason, i.detail)),
      ...arrayItems(d.deferred).map((i) => entry(i.case ?? i.endpoint, "deferred", i.reason, i.detail)),
    ],
  }),
  knowledge: (d) => ({ entries: fromItems(d.items) }),
};

const countsOf = (entries) => {
  const c = { total: entries.length, mapped: 0, excluded: 0, deferred: 0, pending: 0 };
  for (const e of entries) if (e.status in c) c[e.status]++;
  return c;
};

function ledger(name, module, file, read, miss) {
  const where = module ?? "product";
  if (!existsSync(file)) {
    miss("coverage", module, `${name} ledger: ${slash(path.basename(file))} does not exist`);
    return { ledger: name, module, available: false, reason: `${name} ledger not written`, file: null };
  }
  const data = tryReadJson(file);
  if (!data) {
    miss("coverage", module, `${name} ledger of ${where} is not valid JSON`);
    return { ledger: name, module, available: false, reason: "not valid JSON", file: null };
  }
  const { entries, byTechnique } = read(data);
  return {
    ledger: name,
    module,
    available: true,
    reason: null,
    counts: countsOf(entries),
    ...(byTechnique ? { byTechnique } : {}),
    deferred: entries.filter((e) => e.status === "deferred").map((e) => ({ id: e.id, detail: e.detail ?? e.reason })),
    excluded: entries.filter((e) => e.status === "excluded").map((e) => ({ id: e.id, reason: e.reason, detail: e.detail })),
  };
}

// ---------- collect ----------

export async function collect(product, { root = workspaceRoot, now = new Date() } = {}) {
  const p = paths(product, root);
  const run = loadJson(p.runFile);
  const rel = (f) => slash(path.relative(root, f));
  const missing = [];
  const miss = (section, module, reason) => missing.push({ section, module: module ?? null, reason });
  const ledgers = [];
  const queues = { testcaseApprovals: [], clarifications: [] };
  const assumptions = { k6Thresholds: [], assumptionCases: [], ruleFacts: [], knownLimits: [], k6Leftovers: [], k6Untracked: [] };
  const k6Dir = path.join(p.k6Project, "results");

  ledgers.push(ledger("knowledge", null, path.join(p.knowledge, "coverage.json"), READERS.knowledge, miss));

  const perModule = run.modules.map((m) => {
    const mdir = p.module(m);
    // explored: a valid, non-empty sitemap (an empty one means nothing was found)
    const sitemap = tryReadJson(path.join(mdir, "explore", "sitemap.json"));
    const explored = Array.isArray(sitemap) && sitemap.length > 0;
    if (!explored) miss("modules", m, Array.isArray(sitemap) ? "explore/sitemap.json is empty: no page was explored" : "explore/sitemap.json is missing or not a list");

    // clarifications and their human queue
    const csv = csvPath(p.productDir, m);
    let rows = [];
    let clarAvailable = existsSync(csv);
    try {
      rows = readRows(csv);
    } catch (e) {
      clarAvailable = false;
      miss("clarifications", m, `clarifications.csv unreadable: ${e.message}`);
    }
    if (!existsSync(csv)) miss("clarifications", m, "clarifications.csv does not exist");
    const answered = rows.filter(isAnswered);
    const unconfirmed = rows.filter((r) => !isAnswered(r));
    for (const r of rows) {
      const kind = !isAnswered(r) ? "unanswered" : !isAuthoritative(r) ? "awaiting-approval" : null;
      if (!kind) continue;
      const nextStep = /Next step:\s*(.+)/.exec(r.notes ?? "")?.[1]?.trim() ?? null;
      queues.clarifications.push({ module: m, id: r.id, kind, question: String(r.question ?? "").replace(/\s+/g, " ").trim(), nextStep, file: rel(csv) });
    }

    // test cases and approvals
    const tc = testcaseTotal(path.join(mdir, "testcases", "testcases-summary.md"));
    if (tc === null) miss("testcases", m, "testcases-summary.md has no 'Total test cases' line");
    const appr = approvalSummary(p.productDir, m);
    const tpaths = testcasePaths(p.productDir, m);
    if (!appr.built) miss("approvals", m, "testcases/coverage.json does not exist: no case to approve yet");
    const apprCounts = (({ approved, rejected, changes, awaiting }) => ({ approved, rejected, changes, awaiting }))(appr.counts);
    queues.testcaseApprovals.push({ module: m, built: appr.built, approvalCsv: appr.built && existsSync(tpaths.approvalCsv) ? rel(tpaths.approvalCsv) : null, ...apprCounts });

    // results, triage
    const results = Object.fromEntries(
      FRAMEWORKS.map((fw) => {
        const f = path.join(p.results(run.runId), m, fw, "results.json");
        const r = tryReadJson(f);
        if (!r) miss("results", m, `${fw}: results.json is missing`);
        return [fw, r ? (({ status, reason, totals, durationMs }) => ({ status, reason, totals, durationMs }))(r) : null];
      })
    );
    const triage = Object.fromEntries(FRAMEWORKS.map((fw) => [fw, triageSummary(p.productDir, m, run.runId, fw)]));

    // k6 scripts, assumed thresholds, untracked creates
    const k6 = k6ScriptsOf(p.productDir, p.k6Project, m);
    if (!k6) miss("k6", m, "k6/workload.json is missing: k6 scripts cannot be counted");
    for (const s of k6?.scenarios ?? [])
      for (const t of s.thresholds ?? [])
        if (t.assumed) assumptions.k6Thresholds.push({ module: m, scenario: s.id, script: `${m}-${s.name}`, endpoint: t.endpoint ?? null, metric: t.metric, stat: t.stat ?? null, limit: t.limit });
    for (const name of k6?.names ?? [])
      for (const retry of [false, true]) {
        const f = path.join(k6Dir, `${name}${retry ? ".retry" : ""}.untracked.json`);
        const list = tryReadJson(f);
        if (Array.isArray(list)) assumptions.k6Untracked.push({ module: m, script: name, retry, file: rel(f), creates: list.reduce((n, x) => n + (Number(x.count) || 0), 0), types: [...new Set(list.map((x) => x.type))].sort() });
      }

    // coverage ledgers of the module
    const exp = path.join(mdir, "explore", "coverage.json");
    if (existsSync(exp)) {
      const d = tryReadJson(exp);
      if (d) {
        for (const [name, key] of [["explore-frontier", "frontier"], ["explore-open-points", "kq"], ["explore-inputs", "inputs"]]) {
          const entries = fromItems(d[key]?.items);
          ledgers.push({ ledger: name, module: m, available: true, reason: null, counts: countsOf(entries), deferred: entries.filter((e) => e.status === "deferred").map((e) => ({ id: e.id, detail: e.detail ?? e.reason })), excluded: entries.filter((e) => e.status === "excluded").map((e) => ({ id: e.id, reason: e.reason, detail: e.detail })) });
        }
      } else miss("coverage", m, "explore ledger is not valid JSON");
    } else miss("coverage", m, "explore ledger: coverage.json does not exist");
    ledgers.push(ledger("knowledge", m, path.join(p.knowledge, "modules", m, "coverage.json"), READERS.knowledge, miss));
    ledgers.push(ledger("testcases", m, tpaths.coverage, READERS.testcases, miss));
    ledgers.push(ledger("api-plan", m, path.join(mdir, "api", "plan-coverage.json"), READERS["api-plan"], miss));
    ledgers.push(ledger("api-code", m, path.join(mdir, "api-code", "coverage.json"), READERS["api-code"], miss));
    ledgers.push(ledger("ui-code", m, path.join(mdir, "ui-code", "coverage.json"), READERS["ui-code"], miss));
    ledgers.push(ledger("workload", m, workloadPaths(p.productDir, m).coverage, READERS.workload, miss));

    // @assumption cases and weak rule facts
    for (const c of tryReadJson(tpaths.coverage)?.cases ?? []) if (c.assumption) assumptions.assumptionCases.push({ module: m, id: c.id, assumptions: arrayItems(c.assumptions).map(String) });
    const rf = path.join(p.knowledge, "modules", m, "rule-facts.json");
    const facts = tryReadJson(rf);
    if (!facts) miss("assumptions", m, "knowledge rule-facts.json is missing: agent-captured and stale facts are unknown");
    for (const f of facts?.facts ?? []) if (f.evidence && f.evidence !== "script-fetched") assumptions.ruleFacts.push({ module: m, file: f.file, line: f.line, evidence: f.evidence, text: String(f.text).slice(0, 300) });

    return {
      module: m,
      explored,
      clarifications: { available: clarAvailable, total: rows.length, answered: answered.length, unconfirmed: unconfirmed.length, awaitingApproval: rows.filter((r) => isAnswered(r) && !isAuthoritative(r)).length },
      testcases: tc,
      approvals: apprCounts,
      playwrightUiSpecs: walk(path.join(p.pwProject, "tests", "ui", m), (n) => n.endsWith(".spec.ts")).length,
      playwrightApiSpecs: walk(path.join(p.pwProject, "tests", "api", m), (n) => n.endsWith(".spec.ts")).length,
      k6Scripts: k6?.scripts ?? 0,
      k6Planned: k6?.planned ?? null,
      results,
      triage,
    };
  });

  const explored = perModule.some((r) => r.explored);
  assumptions.knownLimits = explored ? KNOWN_LIMITS : [];
  assumptions.k6Leftovers = liveEntities(p.ledgerFile, run.runId).map((e) => ({ type: e.type, ref: e.ref, module: e.module, stage: e.stage }));

  const sum = (k) => perModule.reduce((n, r) => n + (r[k] ?? 0), 0);
  const fwTotals = Object.fromEntries(
    FRAMEWORKS.map((fw) => {
      const t = { total: 0, passed: 0, failed: 0, flaky: 0, skipped: 0, modulesRun: 0, modulesNotRun: 0, modulesNoResults: 0 };
      for (const r of perModule) {
        const x = r.results[fw];
        if (!x) {
          t.modulesNoResults++;
          continue;
        }
        if (x.status === "not-run") t.modulesNotRun++;
        else t.modulesRun++;
        for (const k of ["total", "passed", "failed", "flaky", "skipped"]) t[k] += x.totals[k];
      }
      return [fw, t];
    })
  );
  const classCounts = {};
  const bugClusters = [];
  const triagesUnverified = [];
  for (const r of perModule)
    for (const [fw, t] of Object.entries(r.triage)) {
      if (!t) continue;
      if (!t.verified) triagesUnverified.push({ module: r.module, framework: fw });
      for (const [cls, n] of Object.entries(t.byClass)) classCounts[cls] = (classCounts[cls] ?? 0) + n;
      for (const c of t.bugClusters) bugClusters.push({ module: r.module, framework: fw, ...c });
    }
  const sevOrder = ["critical", "major", "minor", "trivial"];
  bugClusters.sort((a, b) => (sevOrder.indexOf(a.severity) + 1 || 9) - (sevOrder.indexOf(b.severity) + 1 || 9) || a.id.localeCompare(b.id));

  // stages that did not finish, with the open findings of a failed review (G10)
  const st = await runStatus(product, { root });
  const rows = st.stages.filter((r) => r.stage !== "report");
  const keyOf = (r) => `${r.module ?? "_product"}/${r.stage}`;
  const failedStages = Object.entries(run.stages)
    .filter(([, s]) => s.status === "failed")
    .map(([key, s]) => ({ key, error: s.error ?? null, attempts: s.attempts ?? 0, ...(s.reviewFailed ? { reviewFailed: true, findings: s.findings ?? [] } : {}) }));
  const blockedStages = rows.filter((r) => r.blocked).map((r) => ({ key: keyOf(r), stage: r.stage, module: r.module ?? null }));
  const awaitingApprovalStages = rows.filter((r) => r.awaitingApproval).map((r) => ({ key: keyOf(r), stage: r.stage, module: r.module ?? null }));
  // a stage not chosen for this run is reported as such, never as failed, blocked or incomplete
  const notChosenStages = rows.filter((r) => r.notChosen).map((r) => ({ key: keyOf(r), stage: r.stage, module: r.module ?? null, ...(r.satisfiedBy ? { satisfiedBy: r.satisfiedBy } : {}) }));
  const steps = STEPS.map((step) => ({ step, chosen: (run.steps ?? STEPS).includes(step) }));
  const incompleteStages = rows.filter((r) => !r.complete && !r.notChosen && r.status !== "failed" && !r.blocked && !r.awaitingApproval).map((r) => ({ key: keyOf(r), stage: r.stage, module: r.module ?? null, status: r.status, problems: r.problems ?? [] }));

  // time and effort (D-079): stage and step durations, and the agent spawns the PostToolUse hook recorded
  const timeAndEffort = effort({ run, stateDir: p.state });
  if (!timeAndEffort.spawnsRecorded) miss("effort", null, "agent spawns were not recorded: the PostToolUse hook is off (config/hooks.yaml), or no agent was started");
  const cov = ledgers.reduce((a, l) => (l.available ? { total: a.total + l.counts.total, mapped: a.mapped + l.counts.mapped, excluded: a.excluded + l.counts.excluded, deferred: a.deferred + l.counts.deferred, pending: a.pending + l.counts.pending } : a), { total: 0, mapped: 0, excluded: 0, deferred: 0, pending: 0 });
  return {
    schemaVersion: REPORT_VERSION,
    product,
    runId: run.runId,
    mode: run.mode,
    target: run.target.url,
    environment: run.environment ?? "default",
    provenance: run.provenance ?? null,
    customConfig: customConfig(run, root),
    generatedAt: now.toISOString(),
    totals: {
      modules: run.modules.length,
      modulesExplored: perModule.filter((r) => r.explored).length,
      clarifications: perModule.reduce((a, r) => ({ total: a.total + r.clarifications.total, answered: a.answered + r.clarifications.answered, unconfirmed: a.unconfirmed + r.clarifications.unconfirmed, awaitingApproval: a.awaitingApproval + r.clarifications.awaitingApproval }), { total: 0, answered: 0, unconfirmed: 0, awaitingApproval: 0 }),
      testcases: sum("testcases"),
      approvals: Object.fromEntries(["approved", "rejected", "changes", "awaiting"].map((k) => [k, perModule.reduce((n, r) => n + r.approvals[k], 0)])),
      playwrightUiSpecs: sum("playwrightUiSpecs"),
      playwrightApiSpecs: sum("playwrightApiSpecs"),
      k6Scripts: sum("k6Scripts"),
      execution: fwTotals,
      triage: { byClass: classCounts, bugClusters, unverified: triagesUnverified },
      coverage: cov,
      assumptions: { k6Thresholds: assumptions.k6Thresholds.length, assumptionCases: assumptions.assumptionCases.length, weakRuleFacts: assumptions.ruleFacts.length, k6Leftovers: assumptions.k6Leftovers.length, k6UntrackedCreates: assumptions.k6Untracked.reduce((n, x) => n + x.creates, 0) },
      stages: { failed: failedStages.length, blocked: blockedStages.length, awaitingApproval: awaitingApprovalStages.length, notChosen: notChosenStages.length },
      missing: missing.length,
      effort: timeAndEffort.totals,
    },
    bugs: bugClusters,
    queues,
    coverage: { ledgers },
    assumptions,
    failedStages,
    blockedStages,
    awaitingApprovalStages,
    incompleteStages,
    steps,
    notChosenStages,
    effort: timeAndEffort,
    missing,
    modules: perModule,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const product = process.argv[2];
  try {
    if (!product) throw new Error("usage: report-data.mjs <product>");
    const data = await collect(product);
    const file = path.join(paths(product).results(data.runId), "report", "report.json");
    writeJson(file, data);
    // the product bugs as issue-ready files beside the report (D-080)
    const bugs = exportBugs(product, { root: workspaceRoot });
    console.log(JSON.stringify({ written: path.relative(workspaceRoot, file).replaceAll("\\", "/"), bugs: { dir: bugs.dir, files: bugs.bugs.filter((b) => b.file).length, withoutDraft: bugs.bugs.filter((b) => !b.draft).length }, totals: data.totals }, null, 2));
  } catch (e) {
    console.log(JSON.stringify({ errors: [e.message] }));
    process.exit(1);
  }
}
