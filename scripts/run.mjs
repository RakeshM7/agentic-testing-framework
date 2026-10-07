#!/usr/bin/env node
// Run lifecycle + state machine (layout v2, product-level). One active run per product, enforced by
// artifacts/<product>/state/lock.json. State lives in state/run.json; a stage is complete only when it is marked
// done AND its declared outputs exist and validate.
//
//   run.mjs init <config.yaml> [--resume] [--run-id ID]   start a run (or --resume the active one)
//   run.mjs status <product>                              per-stage status + output verification
//   run.mjs next <product>                                stages whose dependencies are complete and that still need running
//   run.mjs stage <product> <stage> start|done|fail [--module M] [--error MSG]
//   run.mjs end <product> [--abandon]                     write state/history/<run-id>.json and release the lock
//   run.mjs validate <product>                            schema-check run.json, ledger, permissions, module outputs
//
// All commands print JSON; exit 1 = refused/invalid, 2 = usage error.

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { validateRunConfig } from "./run-config.mjs";
import { LAYOUT_VERSION, SLUG_RE, STAGES, loadJson, paths, repoRoot, stageKey, validateData, validateFile, verifyOutputs } from "./lib/contract.mjs";
import { read as readLedger } from "./lib/ledger.mjs";
import { csvPath, ensureCsv } from "./lib/clarifications.mjs";
import { resolvePermissions } from "./lib/permissions.mjs";

const now = () => new Date().toISOString();
const writeJson = (file, data) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf8");
};
const rel = (root, p) => path.relative(root, p).replaceAll("\\", "/");

export const makeRunId = (product, date = new Date()) =>
  `${product}-${date.toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-")}`; // eventhub-20261007-1230

export function initRun(configFile, { resume = false, runId, root = repoRoot } = {}) {
  const { errors, normalized: cfg } = validateRunConfig(yaml.load(readFileSync(configFile, "utf8")));
  if (errors?.length) return { errors };
  const p = paths(cfg.product, root);

  if (existsSync(p.lockFile)) {
    const lock = loadJson(p.lockFile);
    if (resume) return { resumed: true, product: cfg.product, run: loadJson(p.runFile) };
    return { errors: [`run ${lock.runId} is active for product '${cfg.product}' (started ${lock.createdAt}). Use --resume, or end it: run.mjs end ${cfg.product} --abandon`] };
  }
  if (resume) return { errors: [`no active run for product '${cfg.product}' to resume`] };

  const permPath = path.resolve(root, cfg.permissions_file);
  if (!existsSync(permPath)) return { errors: [`permissions_file ${cfg.permissions_file} not found`] };
  const perms = resolvePermissions(yaml.load(readFileSync(permPath, "utf8")));
  if (perms.errors.length) return { errors: perms.errors.map((e) => `permissions: ${e}`) };

  let id = runId ?? makeRunId(cfg.product);
  if (!SLUG_RE.test(id)) return { errors: [`run id '${id}' must be lowercase kebab-case`] };
  for (let n = 2; existsSync(path.join(p.historyDir, `${id}.json`)) || existsSync(p.results(id)); n++) id = `${runId ?? makeRunId(cfg.product)}-${n}`;

  const run = {
    layoutVersion: LAYOUT_VERSION,
    product: cfg.product,
    runId: id,
    createdAt: now(),
    target: { url: cfg.target.url },
    mode: cfg.authorizations.mode,
    configPath: rel(root, path.resolve(configFile)),
    permissionsPath: rel(root, permPath),
    modules: cfg.modules.map((m) => m.slug),
    stages: {},
  };
  writeJson(p.lockFile, { runId: id, createdAt: run.createdAt, configPath: run.configPath });
  writeJson(p.runFile, run);
  writeJson(p.configFile, cfg);
  writeJson(p.permissionsFile, perms.resolved);
  mkdirSync(p.results(id), { recursive: true });
  for (const m of run.modules) {
    mkdirSync(p.module(m), { recursive: true });
    ensureCsv(csvPath(p.productDir, m)); // header-only file, so a module with no open questions still has its CSV
  }
  return { product: cfg.product, run };
}

function ctxFor(product, root) {
  const p = paths(product, root);
  if (!existsSync(p.runFile)) throw new Error(`no run state for product '${product}' (run.mjs init first)`);
  const run = loadJson(p.runFile);
  const cfg = existsSync(p.configFile) ? loadJson(p.configFile) : {};
  return { p, run, root, product, runId: run.runId, active: existsSync(p.lockFile), clarificationsPolicy: cfg.clarifications?.unresolved_policy ?? "stop", testcasesFormat: cfg.testcases?.output_format ?? "gherkin" };
}

const scopesFor = (run, stage) => (STAGES[stage].scope === "product" ? [null] : run.modules);

export async function status(product, { root = repoRoot } = {}) {
  const ctx = ctxFor(product, root);
  const rows = [];
  for (const stage of Object.keys(STAGES))
    for (const module of scopesFor(ctx.run, stage)) {
      const rec = ctx.run.stages[stageKey(stage, module)] ?? { status: "pending" };
      const problems = rec.status === "done" ? await verifyOutputs(ctx, stage, module) : [];
      const attempts = rec.attempts ?? 0;
      rows.push({
        stage, module, orchestrator: STAGES[stage].orchestrator, status: rec.status, attempts,
        complete: rec.status === "done" && !problems.length,
        exhausted: rec.status === "failed" && attempts >= MAX_ATTEMPTS,
        problems, error: rec.error,
      });
    }
  // A stage is blocked when something it depends on is exhausted (failed MAX_ATTEMPTS times) or itself blocked.
  // STAGES is declared in dependency order, so one pass suffices.
  const depRows = (row, dep) => rows.filter((r) => r.stage === dep && (STAGES[dep].scope === "product" || r.module === row.module));
  for (const row of rows) {
    const needs = STAGES[row.stage].needs.filter((d) => d !== "*");
    row.blocked = !row.complete && needs.some((d) => depRows(row, d).some((r) => r.exhausted || r.blocked));
  }
  return { product, runId: ctx.runId, active: ctx.active, mode: ctx.run.mode, modules: ctx.run.modules, stages: rows };
}

export const MAX_ATTEMPTS = 2;

export async function next(product, { root = repoRoot } = {}) {
  const st = await status(product, { root });
  if (!st.active) return [];
  const complete = (stage, module) =>
    st.stages.filter((r) => r.stage === stage && (STAGES[stage].scope === "product" || r.module === module)).every((r) => r.complete);
  const settled = (r) => r.complete || r.exhausted || r.blocked;
  const ready = [];
  for (const row of st.stages) {
    if (settled(row) || row.status === "running") continue;
    const needs = STAGES[row.stage].needs;
    const ok = needs.includes("*") ? st.stages.every((r) => r.stage === row.stage || settled(r)) : needs.every((dep) => complete(dep, row.module));
    if (ok) ready.push({ stage: row.stage, module: row.module, orchestrator: row.orchestrator, attempt: row.attempts + 1, retry: row.status !== "pending" });
  }
  return ready;
}

export async function setStage(product, stage, module, action, error, { root = repoRoot } = {}) {
  if (!STAGES[stage]) return { errors: [`unknown stage '${stage}' (one of ${Object.keys(STAGES).join(", ")})`] };
  const ctx = ctxFor(product, root);
  if (!ctx.active) return { errors: [`run ${ctx.runId} has ended; start a new run`] };
  if (STAGES[stage].scope === "module" && !ctx.run.modules.includes(module)) return { errors: [`--module must be one of [${ctx.run.modules.join(", ")}]`] };
  const key = stageKey(stage, module);
  const prev = ctx.run.stages[key] ?? {};
  if (action === "start") {
    if (prev.status === "failed" && (prev.attempts ?? 0) >= MAX_ATTEMPTS) return { errors: [`${key} already failed ${MAX_ATTEMPTS} times this run`] };
    ctx.run.stages[key] = { status: "running", startedAt: now(), attempts: (prev.attempts ?? 0) + 1 };
  }
  else if (action === "fail") ctx.run.stages[key] = { ...prev, status: "failed", finishedAt: now(), error: error ?? "unspecified" };
  else if (action === "done") {
    const problems = await verifyOutputs(ctx, stage, module);
    if (problems.length) return { errors: ["cannot mark done; declared outputs are incomplete:", ...problems] };
    ctx.run.stages[key] = { ...prev, status: "done", finishedAt: now() };
    delete ctx.run.stages[key].error;
    if (STAGES[stage].onDone === "record-knowledge-inputs") {
      const k = await import("./lib/knowledge.mjs");
      k.recordInputs(k.knowledgePaths(ctx.p.productDir), loadJson(ctx.p.configFile), root, module);
    }
  } else return { errors: [`action must be start|done|fail, got '${action}'`] };
  writeJson(ctx.p.runFile, ctx.run);
  return { key, ...ctx.run.stages[key] };
}

export async function endRun(product, { abandon = false, root = repoRoot } = {}) {
  const ctx = ctxFor(product, root);
  if (!ctx.active) return { errors: [`no active run for product '${product}'`] };
  const st = await status(product, { root });
  const summary = {
    runId: ctx.runId,
    product,
    mode: ctx.run.mode,
    createdAt: ctx.run.createdAt,
    endedAt: now(),
    outcome: abandon ? "abandoned" : st.stages.every((r) => r.complete) ? "completed" : "incomplete",
    stages: st.stages.map(({ stage, module, status: s, complete }) => ({ stage, module, status: s, complete })),
  };
  writeJson(path.join(ctx.p.historyDir, `${ctx.runId}.json`), summary);
  unlinkSync(ctx.p.lockFile);
  return summary;
}

export async function validateProduct(product, { root = repoRoot } = {}) {
  const ctx = ctxFor(product, root);
  const problems = [];
  const check = (label, errs) => errs.forEach((e) => problems.push(`${label}: ${e}`));
  check("state/run.json", await validateFile("run", ctx.p.runFile));
  if (ctx.active) check("state/lock.json", await validateFile("lock", ctx.p.lockFile));
  try {
    for (const [i, e] of readLedger(ctx.p.ledgerFile).entries()) check(`state/ledger.jsonl:${i + 1}`, await validateData("ledger-entry", e));
  } catch (e) {
    problems.push(`state/ledger.jsonl: ${e.message}`);
  }
  for (const m of ctx.run.modules) {
    const sm = path.join(ctx.p.module(m), "explore", "sitemap.json");
    if (existsSync(sm)) check(`modules/${m}/explore/sitemap.json`, await validateFile("sitemap", sm));
    const csv = path.join(ctx.p.module(m), "clarifications.csv");
    if (existsSync(csv)) {
      const { readRows } = await import("./lib/clarifications.mjs");
      try {
        readRows(csv);
      } catch (e) {
        problems.push(`modules/${m}/clarifications.csv: ${e.message}`);
      }
    }
  }
  return problems;
}

async function main() {
  const [cmd, a, ...rest] = process.argv.slice(2);
  const { values: v, positionals: pos } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: { "run-id": { type: "string" }, module: { type: "string" }, error: { type: "string" }, resume: { type: "boolean" }, abandon: { type: "boolean" } },
  });
  const out = (x, code = 0) => {
    console.log(JSON.stringify(x, null, 2));
    process.exit(code);
  };
  if (!cmd || !a) {
    console.error("usage: run.mjs init|status|next|stage|end|validate ... (see header comment)");
    process.exit(2);
  }
  try {
    if (cmd === "init") {
      const r = initRun(a, { resume: v.resume, runId: v["run-id"] });
      out(r.errors ? r : { product: r.product, runId: r.run.runId, mode: r.run.mode, modules: r.run.modules, resumed: !!r.resumed }, r.errors ? 1 : 0);
    } else if (cmd === "status") out(await status(a));
    else if (cmd === "next") out(await next(a));
    else if (cmd === "stage") {
      const r = await setStage(a, pos[0], v.module, pos[1], v.error);
      out(r, r.errors ? 1 : 0);
    } else if (cmd === "end") {
      const r = await endRun(a, { abandon: v.abandon });
      out(r, r.errors ? 1 : 0);
    } else if (cmd === "validate") {
      const problems = await validateProduct(a);
      out({ valid: !problems.length, problems }, problems.length ? 1 : 0);
    } else out({ errors: [`unknown command ${cmd}`] }, 2);
  } catch (e) {
    out({ errors: [e.message] }, 1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
