#!/usr/bin/env node
// Reads every k6 summary-export JSON file in api-tests/k6/results/ and renders them into a single
// static HTML report at api-tests/k6/results/report.html. Purely a function of whatever *.json
// files are present at run time -- no network calls, no live k6 execution. Safe to re-run any
// number of times, including in `readonly` mode.
//
// Usage: node scripts/generate-k6-report.mjs [--results-dir <dir>] [--out <file>]

import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const args = { resultsDir: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--results-dir") args.resultsDir = argv[++i];
    else if (argv[i] === "--out") args.out = argv[++i];
  }
  return args;
}

const cliArgs = parseArgs(process.argv.slice(2));
const resultsDir = path.resolve(cliArgs.resultsDir ?? path.join(repoRoot, "api-tests", "k6", "results"));
const scriptsDir = path.join(path.dirname(resultsDir), "scripts");
const outPath = path.resolve(cliArgs.out ?? path.join(resultsDir, "report.html"));

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatMs(value) {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(2)}ms` : "n/a";
}

function formatPct(rate) {
  if (typeof rate !== "number" || !Number.isFinite(rate)) return "n/a";
  return `${Number((rate * 100).toFixed(2))}%`;
}

// Endpoint tags are embedded as string literals in the generated k6 script, e.g.
// `tags: { name: 'GET /events' }` or `tagName = 'POST /auth/login'`. Extracting them from the
// script source (rather than the result JSON, which doesn't carry them) keeps this deterministic
// and avoids guessing at endpoint shape from metric names.
function extractEndpoints(scriptSource) {
  const matches = scriptSource.matchAll(/'((?:GET|POST|PUT|PATCH|DELETE)[^']*)'/g);
  const seen = new Set();
  for (const [, endpoint] of matches) seen.add(endpoint);
  return [...seen];
}

function collectChecks(group, acc = []) {
  if (!group) return acc;
  for (const check of Object.values(group.checks ?? {})) acc.push(check);
  for (const sub of Object.values(group.groups ?? {})) collectChecks(sub, acc);
  return acc;
}

function collectThresholds(metrics) {
  const rows = [];
  for (const [metricName, metricData] of Object.entries(metrics ?? {})) {
    if (!metricData?.thresholds) continue;
    for (const [expr, breached] of Object.entries(metricData.thresholds)) {
      rows.push({ metric: metricName, expr, breached: Boolean(breached) });
    }
  }
  rows.sort((a, b) => (a.metric + a.expr).localeCompare(b.metric + b.expr));
  return rows;
}

function loadResultFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => path.join(dir, name));
}

function buildSection(resultFile) {
  const base = path.basename(resultFile, ".json").replace(/-result$/, "");
  const scriptName = `${base}.js`;
  const scriptPath = path.join(scriptsDir, scriptName);

  let raw;
  try {
    raw = JSON.parse(readFileSync(resultFile, "utf8"));
  } catch (err) {
    return {
      scriptName,
      parseError: err.message,
    };
  }

  const metrics = raw.metrics ?? {};
  const checks = collectChecks(raw.root_group);
  const thresholds = collectThresholds(metrics);

  let endpoints = [];
  if (existsSync(scriptPath)) {
    endpoints = extractEndpoints(readFileSync(scriptPath, "utf8"));
  }

  const requests = metrics.http_reqs?.count ?? metrics.iterations?.count ?? null;
  const failedRate = metrics.http_req_failed?.value ?? null;
  const p95 = metrics.http_req_duration?.["p(95)"] ?? null;
  const avg = metrics.http_req_duration?.avg ?? null;
  const maxVus = metrics.vus_max?.max ?? metrics.vus?.max ?? null;

  const anyThresholdBreached = thresholds.some((t) => t.breached);
  const anyCheckFailed = checks.some((c) => (c.fails ?? 0) > 0);
  const passed = !anyThresholdBreached && !anyCheckFailed;

  return {
    scriptName,
    endpoints,
    requests,
    failedRate,
    p95,
    avg,
    maxVus,
    checks,
    thresholds,
    passed,
  };
}

function renderSection(section) {
  if (section.parseError) {
    return `
    <section class="card">
      <div class="card-head">
        <h2>${escapeHtml(section.scriptName)}</h2>
        <span class="badge breached">UNREADABLE</span>
      </div>
      <p class="muted">Could not parse result JSON: ${escapeHtml(section.parseError)}</p>
    </section>`;
  }

  const statRow = [
    { value: section.requests ?? "n/a", label: "requests" },
    { value: formatPct(section.failedRate), label: "http_req_failed rate" },
    { value: formatMs(section.p95), label: "p95 duration" },
    { value: formatMs(section.avg), label: "avg duration" },
  ];
  if (section.maxVus !== null) statRow.push({ value: section.maxVus, label: "max VUs" });

  const statHtml = statRow
    .map(
      (s) =>
        `<div class="stat"><div class="stat-value">${escapeHtml(s.value)}</div><div class="stat-label">${escapeHtml(
          s.label
        )}</div></div>`
    )
    .join("");

  const checksTable =
    section.checks.length === 0
      ? ""
      : `<table><thead><tr><th>Check</th><th>Pass/Total</th></tr></thead><tbody>${section.checks
          .map((c) => {
            const total = (c.passes ?? 0) + (c.fails ?? 0);
            const pct = total > 0 ? Number(((c.passes / total) * 100).toFixed(1)) : 0;
            const cls = (c.fails ?? 0) > 0 ? "breached" : "ok";
            return `<tr class='${cls}'><td>${escapeHtml(c.name)}</td><td>${c.passes}/${total} (${pct}%)</td></tr>`;
          })
          .join("")}</tbody></table>`;

  const thresholdsTable =
    section.thresholds.length === 0
      ? ""
      : `<table><thead><tr><th>Metric</th><th>Threshold</th><th>Status</th></tr></thead><tbody>${section.thresholds
          .map((t) => {
            const cls = t.breached ? "breached" : "ok";
            const status = t.breached ? "&#10007; FAILED" : "&#10003; passed";
            return `<tr class='${cls}'><td>${escapeHtml(t.metric)}</td><td><code>${escapeHtml(
              t.expr
            )}</code></td><td class='${cls}'>${status}</td></tr>`;
          })
          .join("")}</tbody></table>`;

  return `
    <section class="card">
      <div class="card-head">
        <h2>${escapeHtml(section.scriptName)}</h2>
        <span class="badge ${section.passed ? "ok" : "breached"}">${section.passed ? "PASSED" : "FAILED"}</span>
      </div>
      <p class="muted">${section.endpoints.length ? escapeHtml(section.endpoints.join(", ")) : "(endpoint not found in script)"}</p>
      <div class="stat-row">${statHtml}</div>
      ${checksTable}
      ${thresholdsTable}
    </section>`;
}

function renderReport(sections, generatedAt) {
  const total = sections.length;
  const passedCount = sections.filter((s) => !s.parseError && s.passed).length;
  const failedCount = total - passedCount;

  const summaryCard = `
  <div class="card">
    <div class="stat-row">
      <div class="stat"><div class="stat-value">${total}</div><div class="stat-label">scripts</div></div>
      <div class="stat"><div class="stat-value">${passedCount}</div><div class="stat-label">passed</div></div>
      <div class="stat"><div class="stat-value">${failedCount}</div><div class="stat-label">failed</div></div>
    </div>
  </div>`;

  const body =
    total === 0
      ? `<div class="card"><p class="note">No k6 result files found in <code>${escapeHtml(
          path.relative(repoRoot, resultsDir)
        )}</code>. Run a live k6 load test (<code>k6 run --summary-export</code>) to produce one, then re-run this script.</p></div>`
      : `${summaryCard}\n${sections.map(renderSection).join("\n")}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>k6 load test report</title>
<style>
  :root {
    --bg: #0f1115; --card: #171a21; --text: #e6e8eb; --muted: #9aa2ab;
    --ok: #2ecc71; --fail: #e5544d; --border: #262b34;
  }
  * { box-sizing: border-box; }
  body { background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; margin: 0; padding: 32px 16px 64px; }
  .wrap { max-width: 880px; margin: 0 auto; }
  h1 { font-size: 22px; margin-bottom: 4px; }
  .subtitle { color: var(--muted); font-size: 14px; margin-bottom: 28px; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 20px 22px; margin-bottom: 18px; }
  .card-head { display: flex; align-items: center; justify-content: space-between; }
  h2 { font-size: 16px; margin: 0; }
  .muted { color: var(--muted); font-size: 13px; margin: 4px 0 16px; }
  .badge { font-size: 11px; font-weight: 600; padding: 3px 10px; border-radius: 999px; letter-spacing: .03em; }
  .badge.ok { background: rgba(46,204,113,.15); color: var(--ok); }
  .badge.breached { background: rgba(229,84,77,.15); color: var(--fail); }
  .stat-row { display: flex; gap: 14px; margin-bottom: 16px; flex-wrap: wrap; }
  .stat { flex: 1; min-width: 100px; background: #12151b; border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; }
  .stat-value { font-size: 18px; font-weight: 600; }
  .stat-label { font-size: 11px; color: var(--muted); margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; margin-top: 10px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border); }
  th { color: var(--muted); font-weight: 500; }
  tr.breached td { color: var(--fail); }
  tr.ok td.ok { color: var(--ok); }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .note { font-size: 13px; color: var(--muted); line-height: 1.5; }
</style>
</head>
<body>
<div class="wrap">
  <h1>k6 load test report</h1>
  <p class="subtitle">Generated ${escapeHtml(generatedAt)} from ${total} result file(s) in <code>${escapeHtml(
    path.relative(repoRoot, resultsDir)
  )}</code></p>
  ${body}
</div>
</body>
</html>
`;
}

function main() {
  const resultFiles = loadResultFiles(resultsDir).filter((f) => path.resolve(f) !== outPath);
  const sections = resultFiles.map(buildSection);
  const generatedAt = new Date().toISOString();
  const html = renderReport(sections, generatedAt);

  writeFileSync(outPath, html, "utf8");

  console.log(`k6 report: ${resultFiles.length} result file(s) processed`);
  console.log(outPath);
}

main();
