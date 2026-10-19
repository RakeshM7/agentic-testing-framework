#!/usr/bin/env node
// Collects every number the report shows, deterministically, into
// artifacts/<product>/results/<run-id>/report/report.json. The report-generator only presents this data.
//
//   report-data.mjs <product>
//
// modules explored        modules with a valid explore/sitemap.json
// clarifications          rows / answered / unconfirmed across modules/<m>/clarifications.csv
// test cases              "Total test cases: N" line of modules/<m>/testcases/testcases-summary.md
// test case approvals     approved / rejected / changes / awaiting per module (lib/testcases.mjs approvalSummary, D-053)
// Playwright scripts      *.spec.ts under playwright-tests/<product>/tests/{ui,api}/<module>/
// k6 scripts              *.js under k6-tests/<product>/scripts/ named <module>-*.js
// execution results       results/<run-id>/<module>/<framework>/results.json
// failed stages          stages of run.json that failed, a failed review with its open findings (G10)
// triage                  results/<run-id>/<module>/<framework>/triage.json (script-built, D-058): class counts and the
//                         product-bug clusters with their bug drafts; G11 renders them
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadJson, paths, repoRoot } from "./lib/contract.mjs";
import { csvPath, status as csvStatus } from "./lib/clarifications.mjs";
import { FRAMEWORKS } from "./results.mjs";
import { approvalSummary } from "./lib/testcases.mjs";
import { triagePaths, triageUnverified } from "./lib/triage.mjs";

const TRIAGE_DOMAIN = { "playwright-ui": "ui", "playwright-api": "api", k6: "k6" };
const TOTAL_RE = /^Total test cases:\s*(\d+)\s*$/im;

function walk(dir, pred) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const f = path.join(dir, d.name);
    return d.isDirectory() ? walk(f, pred) : pred(d.name) ? [f] : [];
  });
}

export function testcaseTotal(summaryFile) {
  if (!existsSync(summaryFile)) return null;
  const m = TOTAL_RE.exec(readFileSync(summaryFile, "utf8"));
  return m ? Number(m[1]) : null;
}

// Class counts and product-bug clusters of one framework's triage.json, or null when there is none. `verified` says
// whether triage.mjs check passed against the results on disk.
export function triageSummary(productDir, module, runId, fw) {
  const tp = triagePaths(productDir, module, runId, TRIAGE_DOMAIN[fw]);
  if (!existsSync(tp.triage)) return null;
  let t;
  try {
    t = loadJson(tp.triage);
  } catch {
    return null;
  }
  let drafts = [];
  try {
    drafts = existsSync(tp.overlay) ? (loadJson(tp.overlay).bugs ?? []) : [];
  } catch {}
  const bugClusters = (t.clusters ?? [])
    .filter((c) => t.rows.some((r) => r.cluster === c.id && r.class === "product-bug"))
    .map((c) => {
      const d = drafts.find((b) => b.cluster === c.id);
      return { id: c.id, ids: c.ids, signature: c.signature, title: d?.title ?? null, severity: d?.severity ?? null, evidence: d?.evidence ?? [] };
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

export function collect(product, { root = repoRoot } = {}) {
  const p = paths(product, root);
  const run = loadJson(p.runFile);
  const perModule = run.modules.map((m) => {
    const mdir = p.module(m);
    let explored = false;
    try {
      explored = Array.isArray(loadJson(path.join(mdir, "explore", "sitemap.json")));
    } catch {}
    const csv = csvPath(p.productDir, m);
    const clar = existsSync(csv) ? csvStatus(csv) : { total: 0, answered: 0, unconfirmed: [] };
    const results = Object.fromEntries(
      FRAMEWORKS.map((fw) => {
        const f = path.join(p.results(run.runId), m, fw, "results.json");
        return [fw, existsSync(f) ? (({ status, reason, totals, durationMs }) => ({ status, reason, totals, durationMs }))(loadJson(f)) : null];
      })
    );
    const triage = Object.fromEntries(FRAMEWORKS.map((fw) => [fw, triageSummary(p.productDir, m, run.runId, fw)]));
    return {
      module: m,
      explored,
      clarifications: { total: clar.total, answered: clar.answered, unconfirmed: clar.unconfirmed.length },
      testcases: testcaseTotal(path.join(mdir, "testcases", "testcases-summary.md")),
      approvals: (({ approved, rejected, changes, awaiting }) => ({ approved, rejected, changes, awaiting }))(approvalSummary(p.productDir, m).counts),
      playwrightUiSpecs: walk(path.join(p.pwProject, "tests", "ui", m), (n) => n.endsWith(".spec.ts")).length,
      playwrightApiSpecs: walk(path.join(p.pwProject, "tests", "api", m), (n) => n.endsWith(".spec.ts")).length,
      k6Scripts: walk(path.join(p.k6Project, "scripts"), (n) => n.startsWith(`${m}-`) && n.endsWith(".js")).length,
      results,
      triage,
    };
  });
  const sum = (k) => perModule.reduce((n, r) => n + (r[k] ?? 0), 0);
  const fwTotals = Object.fromEntries(
    FRAMEWORKS.map((fw) => {
      const t = { total: 0, passed: 0, failed: 0, flaky: 0, skipped: 0, modulesRun: 0, modulesNotRun: 0 };
      for (const r of perModule) {
        const x = r.results[fw];
        if (!x) continue;
        if (x.status === "not-run") t.modulesNotRun++;
        else t.modulesRun++;
        for (const k of ["total", "passed", "failed", "flaky", "skipped"]) t[k] += x.totals[k];
      }
      return [fw, t];
    })
  );
  const classCounts = {};
  const bugClusters = [];
  for (const r of perModule)
    for (const [fw, t] of Object.entries(r.triage)) {
      if (!t) continue;
      for (const [cls, n] of Object.entries(t.byClass)) classCounts[cls] = (classCounts[cls] ?? 0) + n;
      for (const c of t.bugClusters) bugClusters.push({ module: r.module, framework: fw, ...c });
    }
  return {
    product,
    runId: run.runId,
    mode: run.mode,
    target: run.target.url,
    generatedAt: new Date().toISOString(),
    totals: {
      modules: run.modules.length,
      modulesExplored: perModule.filter((r) => r.explored).length,
      clarifications: perModule.reduce((a, r) => ({ total: a.total + r.clarifications.total, answered: a.answered + r.clarifications.answered, unconfirmed: a.unconfirmed + r.clarifications.unconfirmed }), { total: 0, answered: 0, unconfirmed: 0 }),
      testcases: sum("testcases"),
      approvals: Object.fromEntries(["approved", "rejected", "changes", "awaiting"].map((k) => [k, perModule.reduce((n, r) => n + r.approvals[k], 0)])),
      playwrightUiSpecs: sum("playwrightUiSpecs"),
      playwrightApiSpecs: sum("playwrightApiSpecs"),
      k6Scripts: sum("k6Scripts"),
      execution: fwTotals,
      triage: { byClass: classCounts, bugClusters },
    },
    // stages that failed this run; a failed review carries its open findings (G10)
    failedStages: Object.entries(run.stages)
      .filter(([, s]) => s.status === "failed")
      .map(([key, s]) => ({ key, error: s.error ?? null, attempts: s.attempts ?? 0, ...(s.reviewFailed ? { reviewFailed: true, findings: s.findings ?? [] } : {}) })),
    modules: perModule,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const product = process.argv[2];
  try {
    if (!product) throw new Error("usage: report-data.mjs <product>");
    const data = collect(product);
    const file = path.join(paths(product).results(data.runId), "report", "report.json");
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf8");
    console.log(JSON.stringify({ written: path.relative(repoRoot, file).replaceAll("\\", "/"), totals: data.totals }, null, 2));
  } catch (e) {
    console.log(JSON.stringify({ errors: [e.message] }));
    process.exit(1);
  }
}
