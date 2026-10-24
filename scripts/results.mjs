#!/usr/bin/env node
// Normalizes raw execution output into artifacts/<product>/results/<run-id>/<module>/<framework>/results.json
// (schemas/results.schema.json), so the orchestrators and the report never parse tool-specific formats.
//
//   results.mjs playwright <product> <module> ui|api <playwright-json-report>   (reporter: json)
//   results.mjs k6 <product> <module> <summary.json>...                          (written by lib/summary.js handleSummary;
//                                                                                 <script>.retry.summary.json = the smoke re-run)
//   results.mjs not-run <product> <module> playwright-ui|playwright-api|k6 --reason TEXT
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { loadJson, paths, repoRoot } from "./lib/contract.mjs";
import { writeJson } from "./lib/files.mjs";
import { LEDGER_GUARD_RE } from "./lib/ledger.mjs";
import { HEADER_RE as K6_HEADER_RE } from "./lib/k6-code.mjs";

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
  writeJson(file, data);
  return data;
}

const stripAnsi = (s) => String(s ?? "").replace(/\u001b\[[0-9;]*m/g, "");
const slash = (p) => String(p).replaceAll("\\", "/");
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The ids a generated test carries in its literal title (D-055, D-056): the spec title starts with the case id (UI) or
// the scenario id (API), and an API test's tags carry the approved cases it covers (@TC-<m>-<n>). Anchored and exact:
// a title that merely mentions an id gets none.
export function idsFromTitle(specTitle, module, side) {
  const t = String(specTitle ?? "").trim();
  const m = escRe(module);
  if (side === "ui") {
    const x = new RegExp(`^(TC-${m}-\\d+)(?=\\s|$)`).exec(t);
    return x ? { tcId: x[1] } : {};
  }
  const x = new RegExp(`^(API-${m}-\\d+)(?=\\s|$)`).exec(t);
  const tcIds = [...new Set([...t.matchAll(new RegExp(`(?:^|\\s)@(TC-${m}-\\d+)(?=\\s|$)`, "g"))].map((y) => y[1]))];
  return { ...(x ? { scenarioId: x[1] } : {}), tcIds };
}

// stack -> up to 8 "path:line" frames (ANSI stripped, slashes normalized)
function framesOf(err) {
  const out = [];
  for (const l of stripAnsi(err?.stack).split(/\r?\n/)) {
    const m = /^\s*at\s+(?:.*?\()?(.+?):(\d+):\d+\)?\s*$/.exec(l);
    if (m) out.push(`${slash(m[1])}:${m[2]}`);
    if (out.length >= 8) break;
  }
  if (!out.length && err?.location?.file) out.push(`${slash(err.location.file)}:${err.location.line ?? 0}`);
  return out;
}

// Playwright JSON reporter: suites[] (nested) -> specs[] -> tests[] -> results[]; test.status is
// expected | unexpected | flaky | skipped. `module` and `side` (ui|api) add the ids; without them items carry none.
// A test that failed and then passed on a retry is status flaky with passedOnRetry; attempts is the number of runs.
export function fromPlaywright(report, { module, side } = {}) {
  const items = [];
  const walk = (suite, file) => {
    for (const spec of suite.specs ?? [])
      for (const t of spec.tests ?? []) {
        const runs = t.results ?? [];
        const last = runs[runs.length - 1];
        const status = { expected: "passed", unexpected: "failed", flaky: "flaky", skipped: "skipped" }[t.status] ?? t.status;
        const failedRun = status === "flaky" ? runs.find((r) => r.status !== "passed" && r.status !== "skipped") : status === "failed" ? last : null;
        // the ledger guard's refusal (D-074) is raised when the test ends, after whatever failed because of it: it names the cause
        const err = (failedRun?.errors ?? []).find((e) => LEDGER_GUARD_RE.test(e?.message ?? "")) ?? failedRun?.error;
        const attachments = failedRun ? (failedRun.attachments ?? []).filter((a) => a.path).map((a) => ({ name: String(a.name ?? ""), path: slash(a.path) })) : [];
        const skipReason = status === "skipped" ? (t.annotations ?? []).map((a) => a.description).find(Boolean) : undefined;
        items.push({
          title: [...(suite.title && suite.title !== file ? [suite.title] : []), spec.title].join(" > "),
          file: spec.file ?? file,
          status,
          durationMs: last?.duration ?? 0,
          ...(err?.message && (status === "failed" || status === "flaky") ? { error: stripAnsi(err.message).slice(0, 2000) } : {}),
          ...(module && side ? idsFromTitle(spec.title, module, side) : {}),
          ...(t.projectName ? { project: t.projectName } : {}),
          attempts: runs.length,
          passedOnRetry: status === "flaky",
          ...(err ? { frames: framesOf(err) } : {}),
          ...(attachments.length ? { attachments } : {}),
          ...(skipReason ? { skipReason: String(skipReason).slice(0, 300) } : {}),
          ...(/@locators-smoke/.test(spec.title) ? { smoke: true } : {}),
        });
      }
    for (const s of suite.suites ?? []) walk(s, file ?? s.file);
  };
  for (const s of report.suites ?? []) walk(s, s.file);
  const count = (st) => items.filter((i) => i.status === st).length;
  return { totals: { total: items.length, passed: count("passed"), failed: count("failed"), flaky: count("flaky"), skipped: count("skipped") }, durationMs: Math.round(report.stats?.duration ?? 0), items };
}

// k6 handleSummary data: metrics.<name>.thresholds.<expr>.ok, metrics.checks.values.{passes,fails}. A summary named
// "<script>.retry" is the second attempt of "<script>" (the smoke re-run, D-058): one item, attempts 2, flaky when only
// the retry passed. `ids` maps a script name to its K6 id (the CLI reads it from the generated header).
export function fromK6(summaries, { ids = {} } = {}) {
  const one = ({ name, data }) => {
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
  };
  const isRetry = (s) => /\.retry$/.test(s.name);
  const retries = new Map(summaries.filter(isRetry).map((s) => [s.name.replace(/\.retry$/, ""), s]));
  const items = summaries.filter((s) => !isRetry(s)).map((s) => {
    const a = one(s);
    const id = ids[s.name] ? { k6Id: ids[s.name] } : {};
    const r = retries.get(s.name);
    if (!r) return { ...a, ...id, attempts: 1, passedOnRetry: false };
    if (a.status === "passed") return { ...a, ...id, attempts: 2, passedOnRetry: false };
    const b = one(r);
    return b.status === "passed" ? { ...a, ...id, status: "flaky", attempts: 2, passedOnRetry: true, durationMs: b.durationMs } : { ...b, title: s.name, ...id, attempts: 2, passedOnRetry: false };
  });
  const count = (st) => items.filter((i) => i.status === st).length;
  return { totals: { total: items.length, passed: count("passed"), failed: count("failed"), flaky: count("flaky"), skipped: 0 }, durationMs: items.reduce((n, i) => n + i.durationMs, 0), items };
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
      r = record(product, module, `playwright-${pos[0]}`, { status: "ran", ...fromPlaywright(json(pos[1]), { module, side: pos[0] }) });
    } else if (cmd === "k6") {
      if (!pos.length) throw new Error("give at least one summary.json");
      const names = pos.map((f) => ({ name: path.basename(f).replace(/\.summary\.json$|\.json$/, ""), data: json(f) }));
      const dir = path.join(paths(product).k6Project, "scripts");
      const ids = {};
      for (const { name } of names) {
        const base = name.replace(/\.retry$/, "");
        const f = path.join(dir, `${base}.js`);
        const m = existsSync(f) ? K6_HEADER_RE.exec(readFileSync(f, "utf8").replace(/\r\n/g, "\n")) : null;
        if (m) ids[base] = m[1];
      }
      r = record(product, module, "k6", { status: "ran", ...fromK6(names, { ids }) });
    } else if (cmd === "not-run") {
      if (!v.reason) throw new Error("--reason is required");
      r = record(product, module, pos[0], { status: "not-run", reason: v.reason, totals: { total: 0, passed: 0, failed: 0, flaky: 0, skipped: 0 }, durationMs: 0, items: [] });
    } else out({ errors: ["usage: results.mjs playwright|k6|not-run <product> <module> ..."] }, 2);
    out({ framework: r.framework, status: r.status, totals: r.totals });
  } catch (e) {
    out({ errors: [e.message] }, 1);
  }
}
