#!/usr/bin/env node
// Normalizes raw execution output into artifacts/<product>/results/<run-id>/<module>/<framework>/results.json
// (schemas/results.schema.json), so the orchestrators and the report never parse tool-specific formats.
//
//   results.mjs playwright <product> <module> ui|api <playwright-json-report>   (reporter: json)
//   results.mjs k6 <product> <module> <summary.json>...                          (written by lib/summary.js handleSummary)
//   results.mjs not-run <product> <module> playwright-ui|playwright-api|k6 --reason TEXT
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { loadJson, paths, repoRoot } from "./lib/contract.mjs";

export const FRAMEWORKS = ["playwright-ui", "playwright-api", "k6"];

function target(product, module, framework, root) {
  const p = paths(product, root);
  if (!existsSync(p.lockFile)) throw new Error(`no active run for product '${product}'`);
  const run = loadJson(p.runFile);
  if (!run.modules.includes(module)) throw new Error(`module must be one of [${run.modules}]`);
  if (!FRAMEWORKS.includes(framework)) throw new Error(`framework must be one of [${FRAMEWORKS}]`);
  return { run, file: path.join(p.results(run.runId), module, framework, "results.json") };
}

function write(file, data) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf8");
  return data;
}

// Playwright JSON reporter: suites[] (nested) -> specs[] -> tests[] -> results[]; test.status is
// expected | unexpected | flaky | skipped.
export function fromPlaywright(report) {
  const items = [];
  const walk = (suite, file) => {
    for (const spec of suite.specs ?? [])
      for (const t of spec.tests ?? []) {
        const last = t.results?.[t.results.length - 1];
        const status = { expected: "passed", unexpected: "failed", flaky: "flaky", skipped: "skipped" }[t.status] ?? t.status;
        items.push({ title: [...(suite.title && suite.title !== file ? [suite.title] : []), spec.title].join(" > "), file: spec.file ?? file, status, durationMs: last?.duration ?? 0, ...(status === "failed" && last?.error?.message ? { error: last.error.message.slice(0, 2000) } : {}) });
      }
    for (const s of suite.suites ?? []) walk(s, file ?? s.file);
  };
  for (const s of report.suites ?? []) walk(s, s.file);
  const count = (st) => items.filter((i) => i.status === st).length;
  return { totals: { total: items.length, passed: count("passed"), failed: count("failed"), flaky: count("flaky"), skipped: count("skipped") }, durationMs: Math.round(report.stats?.duration ?? 0), items };
}

// k6 handleSummary data: metrics.<name>.thresholds.<expr>.ok, metrics.checks.values.{passes,fails}
export function fromK6(summaries) {
  const items = summaries.map(({ name, data }) => {
    const thresholds = Object.entries(data.metrics ?? {}).flatMap(([metric, m]) => Object.entries(m.thresholds ?? {}).map(([expr, t]) => ({ metric, expr, ok: !!t.ok })));
    const failed = thresholds.filter((t) => !t.ok);
    return {
      title: name,
      status: failed.length ? "failed" : "passed",
      durationMs: Math.round(data.state?.testRunDurationMs ?? 0),
      checks: { passes: data.metrics?.checks?.values?.passes ?? 0, fails: data.metrics?.checks?.values?.fails ?? 0 },
      p95Ms: data.metrics?.http_req_duration?.values?.["p(95)"] ?? null,
      httpFailRate: data.metrics?.http_req_failed?.values?.rate ?? null,
      thresholds,
      ...(failed.length ? { error: failed.map((t) => `${t.metric} ${t.expr}`).join("; ") } : {}),
    };
  });
  const count = (st) => items.filter((i) => i.status === st).length;
  return { totals: { total: items.length, passed: count("passed"), failed: count("failed"), flaky: 0, skipped: 0 }, durationMs: items.reduce((n, i) => n + i.durationMs, 0), items };
}

export function record(product, module, framework, body, { root = repoRoot } = {}) {
  const { run, file } = target(product, module, framework, root);
  return write(file, { framework, module, runId: run.runId, mode: run.mode, recordedAt: new Date().toISOString(), ...body });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, product, module, ...rest] = process.argv.slice(2);
  const { values: v, positionals: pos } = parseArgs({ args: rest, allowPositionals: true, options: { reason: { type: "string" } } });
  const out = (x, code = 0) => {
    console.log(JSON.stringify(x, null, 2));
    process.exit(code);
  };
  try {
    const json = (f) => JSON.parse(readFileSync(path.resolve(f), "utf8"));
    let r;
    if (cmd === "playwright") {
      if (!["ui", "api"].includes(pos[0])) throw new Error("side must be ui|api");
      r = record(product, module, `playwright-${pos[0]}`, { status: "ran", ...fromPlaywright(json(pos[1])) });
    } else if (cmd === "k6") {
      if (!pos.length) throw new Error("give at least one summary.json");
      r = record(product, module, "k6", { status: "ran", ...fromK6(pos.map((f) => ({ name: path.basename(f).replace(/\.summary\.json$|\.json$/, ""), data: json(f) }))) });
    } else if (cmd === "not-run") {
      if (!v.reason) throw new Error("--reason is required");
      r = record(product, module, pos[0], { status: "not-run", reason: v.reason, totals: { total: 0, passed: 0, failed: 0, flaky: 0, skipped: 0 }, durationMs: 0, items: [] });
    } else out({ errors: ["usage: results.mjs playwright|k6|not-run <product> <module> ..."] }, 2);
    out({ framework: r.framework, status: r.status, totals: r.totals });
  } catch (e) {
    out({ errors: [e.message] }, 1);
  }
}
