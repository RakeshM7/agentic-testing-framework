#!/usr/bin/env node
// Run lifecycle + state machine (layout v2, product-level). One active run per product, enforced by
// artifacts/<product>/state/lock.json. State lives in state/run.json; a stage is complete only when it is marked
// done AND its declared outputs exist and validate.
//
//   run.mjs init <config.yaml> [--resume] [--run-id ID]   start a run (or --resume the active one). After a run that ended
//                                                         awaiting-approval, the new run adopts the stages that run completed whose
//                                                         product-level outputs still verify (carriedFrom), so it continues at the cases a human approved
//   run.mjs guard-check <product>                         liveness canary: a working guard BLOCKS this (lib/guard-check.mjs)
//   run.mjs status <product>                              per-stage status + output verification
//   run.mjs next <product>                                {actions: [{stage, module, agent, prompt, attempt, retry}], concurrency, end?}:
//                                                         the stages to start, each with the agent and the exact prompt (run id, mode,
//                                                         format, module); knowledge that can be reused is marked done here (reused).
//                                                         An automation stage with no human-approved test case is awaiting-approval:
//                                                         never offered, no attempt spent. With nothing left to start, `end` says how
//                                                         the run ends: completed, awaiting-approval (with the approval sheets to review;
//                                                         the report stage is offered before that) or incomplete (failed and blocked stages)
//   run.mjs stage <product> <stage> start|done|fail [--module M] [--error MSG]   (start needs a verified guard)
//                                                         done is refused with the problems and, the first time, a `retry` {agent, prompt}
//                                                         to give the same agent once; the second refusal fails the stage itself (D-011).
//                                                         A domain whose review used up its rounds is failed (reviewFailed, with its open
//                                                         findings) and blocks its dependants at once.
//   run.mjs end <product> [--abandon]                     write state/history/<run-id>.json and release the lock
//   run.mjs validate <product>                            schema-check run.json, ledger, permissions, module outputs
//
// All commands print JSON; exit 1 = refused/invalid, 2 = usage error.

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { validateRunConfig } from "./run-config.mjs";
import { LAYOUT_VERSION, SLUG_RE, STAGES, loadJson, paths, repoRoot, stageKey, validateData, validateFile, verifyOutputs } from "./lib/contract.mjs";
import { read as readLedger } from "./lib/ledger.mjs";
import { csvPath, ensureCsv } from "./lib/clarifications.mjs";
import { resolvePermissions } from "./lib/permissions.mjs";
import { clearGuardChecks, guardStatus, markAbsent } from "./lib/guard-check.mjs";
import { detectShellHost } from "./lib/hosts.mjs";
import { approvalSummary, testcasePaths } from "./lib/testcases.mjs";

const now = () => new Date().toISOString();
const writeJson = (file, data) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf8");
};
const rel = (root, p) => path.relative(root, p).replaceAll("\\", "/");

export const makeRunId = (product, date = new Date()) =>
  `${product}-${date.toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-")}`; // eventhub-20261007-1230

export function initRun(configFile, { resume = false, runId, root = repoRoot, env = process.env } = {}) {
  const { errors, normalized: cfg } = validateRunConfig(yaml.load(readFileSync(configFile, "utf8")));
  if (errors?.length) return { errors };
  const p = paths(cfg.product, root);

  if (existsSync(p.lockFile)) {
    const lock = loadJson(p.lockFile);
    if (resume) {
      clearGuardChecks(cfg.product, root); // a resumed session must verify its own guard
      return { resumed: true, product: cfg.product, run: loadJson(p.runFile) };
    }
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
    target: { url: cfg.target.url, ...(cfg.target.api_urls?.length ? { api_urls: cfg.target.api_urls } : {}) },
    mode: cfg.authorizations.mode,
    configPath: rel(root, path.resolve(configFile)),
    permissionsPath: rel(root, permPath),
    modules: cfg.modules.map((m) => m.slug),
    startedOnHost: detectShellHost(env),
    stages: {},
  };
  clearGuardChecks(cfg.product, root);
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
        // a review that used up its rounds is final: retrying the stage would only repeat it (G10)
        exhausted: rec.status === "failed" && (attempts >= MAX_ATTEMPTS || rec.reviewFailed === true),
        problems, error: rec.error,
        ...(rec.reviewFailed ? { reviewFailed: true, findings: rec.findings ?? [] } : {}),
      });
    }
  // A stage is blocked when something it depends on is exhausted (failed MAX_ATTEMPTS times) or itself blocked.
  // STAGES is declared in dependency order, so one pass suffices.
  const depRows = (row, dep) => rows.filter((r) => r.stage === dep && (STAGES[dep].scope === "product" || r.module === row.module));
  for (const row of rows) {
    const needs = STAGES[row.stage].needs.filter((d) => d !== "*");
    row.blocked = !row.complete && needs.some((d) => depRows(row, d).some((r) => r.exhausted || r.blocked));
    // awaiting-approval (D-053): an automation stage of a module none of whose test cases a human approved yet, once
    // the stages it needs are complete, and every stage that needs one. It is not offered, can't be started, spends no
    // attempt (MAX_ATTEMPTS) and counts as settled for the report; a later run picks the module up once cases are approved.
    const own = STAGES[row.stage].approval && needs.every((d) => depRows(row, d).every((r) => r.complete)) && !approvalSummary(ctx.p.productDir, row.module).approved.length;
    row.awaitingApproval = !row.complete && !row.blocked && (own || needs.some((d) => depRows(row, d).some((r) => r.awaitingApproval)));
    if (row.awaitingApproval && row.status !== "running") row.status = "awaiting-approval";
  }
  return { product, runId: ctx.runId, active: ctx.active, mode: ctx.run.mode, modules: ctx.run.modules, stages: rows };
}

export const MAX_ATTEMPTS = 2;

// The agent and the exact prompt of a stage: the run id, the mode, the module and the test case format come from the
// run's own state, so the orchestrator-agent passes nothing it decided itself (G10).
const kv = (o) => Object.entries(o).map(([k, v]) => `${k}=${v}`).join(" ");
export function stagePrompt(ctx, stage, module) {
  const { product, runId } = ctx;
  const mode = ctx.run.mode;
  const args = {
    knowledge: { product, pass: "product" },
    "module-knowledge": { product, pass: "module", module },
    "playwright-repo": { product, task: "skeleton" },
    explore: { product, module, mode },
    clarifications: { product, module, run: runId, mode },
    testcases: { product, module, run: runId, format: ctx.testcasesFormat },
    report: { product, run: runId },
  }[stage] ?? { product, module, run: runId, mode };
  return { agent: STAGES[stage].orchestrator, prompt: kv(args) };
}

const REVIEWED_STAGES = ["testcases", "playwright-ui", "playwright-api", "k6"];
const HUMAN_GATE = new Set(["clarifications"]); // a refused done waits for a human to answer: no retry, no failure

// The review failure a domain's orchestration state recorded for this run (orchestration.mjs), or null.
function reviewFailure(ctx, stage, module) {
  if (!REVIEWED_STAGES.includes(stage)) return null;
  const file = path.join(ctx.p.orchestrationDir, `${stage}-${module}.json`);
  if (!existsSync(file)) return null;
  const s = loadJson(file);
  if (s.runId !== ctx.runId || s.steps?.review?.status !== "failed") return null;
  return s.reviewFailure ?? { rounds: null, file: null, total: 0, findings: [] };
}

export async function next(product, { root = repoRoot } = {}) {
  const st = await status(product, { root });
  if (!st.active) return [];
  const ctx = ctxFor(product, root);
  const complete = (stage, module) =>
    st.stages.filter((r) => r.stage === stage && (STAGES[stage].scope === "product" || r.module === module)).every((r) => r.complete);
  const settled = (r) => r.complete || r.exhausted || r.blocked || r.awaitingApproval;
  const ready = [];
  for (const row of st.stages) {
    if (settled(row) || row.status === "running") continue;
    const needs = STAGES[row.stage].needs;
    const ok = needs.includes("*") ? st.stages.every((r) => r.stage === row.stage || settled(r)) : needs.every((dep) => complete(dep, row.module));
    if (ok) ready.push({ stage: row.stage, module: row.module, orchestrator: row.orchestrator, attempt: row.attempts + 1, retry: row.status !== "pending", ...stagePrompt(ctx, row.stage, row.module) });
  }
  return ready;
}

// How a run with nothing left to start ends: completed; awaiting-approval (only stages waiting for a human to sign off test
// cases remain: the report is done, the approval sheets are listed); or incomplete (failed or blocked stages).
export function endInfo(st, ctx) {
  const outcome = st.stages.every((r) => r.complete) ? "completed" : st.stages.every((r) => r.complete || r.awaitingApproval) ? "awaiting-approval" : "incomplete";
  const sheets = [...new Set(st.stages.filter((r) => r.awaitingApproval).map((r) => r.module))].map((module) => {
    const a = approvalSummary(ctx.p.productDir, module);
    return { module, file: a.built ? rel(ctx.root, testcasePaths(ctx.p.productDir, module).approvalCsv) : null, built: a.built, awaiting: a.counts.awaiting, approved: a.counts.approved };
  });
  const failed = st.stages.filter((r) => r.status === "failed").map((r) => ({ stage: r.stage, module: r.module, error: r.error, attempts: r.attempts, exhausted: r.exhausted, ...(r.reviewFailed ? { reviewFailed: true, findings: r.findings } : {}) }));
  const blocked = st.stages.filter((r) => r.blocked).map((r) => ({ stage: r.stage, module: r.module }));
  const running = st.stages.filter((r) => r.status === "running").map((r) => ({ stage: r.stage, module: r.module }));
  return { outcome, ...(sheets.length ? { sheets } : {}), ...(failed.length ? { failed } : {}), ...(blocked.length ? { blocked } : {}), ...(running.length ? { running } : {}) };
}

// The orchestrator-agent's loop (G10): what to start now (agent + exact prompt), with reusable knowledge marked done here, or
// how the run ends. `end` is present only when there is nothing to start.
export async function nextStep(product, { root = repoRoot } = {}) {
  const ctx = ctxFor(product, root);
  if (!ctx.active) return { actions: [], end: { outcome: "no-active-run" } };
  for (let round = 0; round < 100; round++) {
    const items = await next(product, { root });
    const reuse = items.filter((i) => i.stage === "knowledge" || i.stage === "module-knowledge");
    let marked = 0;
    if (reuse.length) {
      let plan = null;
      try {
        const k = await import("./lib/knowledge.mjs");
        plan = k.plan(k.knowledgePaths(ctx.p.productDir), loadJson(ctx.p.configFile), root);
      } catch {}
      for (const i of reuse) {
        const verdict = i.stage === "knowledge" ? plan?.product : plan?.modules?.[i.module];
        // only a pass whose outputs verify now is reused; a refusal here must not count as an agent's refused done
        if (verdict === "reuse" && !(await verifyOutputs(ctx, i.stage, i.module)).length && !(await setStage(product, i.stage, i.module, "done", undefined, { root, reused: true })).errors) marked++;
      }
    }
    if (marked) continue;
    if (!items.length) return { actions: [], end: endInfo(await status(product, { root }), ctx) };
    const cfg = existsSync(ctx.p.configFile) ? loadJson(ctx.p.configFile) : {};
    return {
      actions: items.map(({ stage, module, attempt, retry, agent, prompt }) => ({ stage, ...(module ? { module } : {}), agent, prompt, attempt, retry })),
      concurrency: { modules: cfg.concurrency?.modules ?? 1 },
    };
  }
  throw new Error("next: knowledge reuse did not settle");
}

export async function setStage(product, stage, module, action, error, { root = repoRoot, reused = false } = {}) {
  if (!STAGES[stage]) return { errors: [`unknown stage '${stage}' (one of ${Object.keys(STAGES).join(", ")})`] };
  const ctx = ctxFor(product, root);
  if (!ctx.active) return { errors: [`run ${ctx.runId} has ended; start a new run`] };
  if (STAGES[stage].scope === "module" && !ctx.run.modules.includes(module)) return { errors: [`--module must be one of [${ctx.run.modules.join(", ")}]`] };
  const key = stageKey(stage, module);
  const prev = ctx.run.stages[key] ?? {};
  if (action === "start") {
    const row = (await status(product, { root })).stages.find((r) => r.stage === stage && (STAGES[stage].scope === "product" || r.module === module));
    if (row?.awaitingApproval)
      return { errors: [`${key} is awaiting approval: ${approvalSummary(ctx.p.productDir, module).built ? `no test case of ${module} is approved by a human yet (testcases/approval.csv, then node scripts/testcases.mjs approve in a terminal)` : `the test cases of ${module} predate scripts/testcases.mjs, so none can be approved: rebuild them (rerun the testcases stage), then a human approves them`}; a later run picks it up. No attempt was spent.`] };
    const guard = guardStatus(product, ctx.run.mode, root);
    if (!guard.ready) return { errors: [`guard not verified: ${guard.reason}`] };
    if (prev.status === "failed" && prev.reviewFailed) return { errors: [`${key} failed its review this run (${prev.error}); its dependants are blocked`] };
    if (prev.status === "failed" && (prev.attempts ?? 0) >= MAX_ATTEMPTS) return { errors: [`${key} already failed ${MAX_ATTEMPTS} times this run`] };
    ctx.run.stages[key] = { status: "running", startedAt: now(), attempts: (prev.attempts ?? 0) + 1 };
  }
  else if (action === "fail") ctx.run.stages[key] = { ...prev, status: "failed", finishedAt: now(), error: error ?? "unspecified" };
  else if (action === "done") {
    // A review that used up its rounds fails the stage whatever its outputs say; its dependants are blocked at once (G10).
    const rf = reviewFailure(ctx, stage, module);
    if (rf) {
      const error = `review failed: ${rf.rounds ?? "all"} review rounds used and ${rf.total} blocker/major finding(s) still open${rf.file ? ` (${rf.file})` : ""}`;
      ctx.run.stages[key] = { ...prev, status: "failed", finishedAt: now(), error, reviewFailed: true, findings: rf.findings ?? [] };
      writeJson(ctx.p.runFile, ctx.run);
      return { key, ...ctx.run.stages[key], errors: [error] };
    }
    const problems = await verifyOutputs(ctx, stage, module);
    if (problems.length) {
      const errors = ["cannot mark done; declared outputs are incomplete:", ...problems];
      if (HUMAN_GATE.has(stage)) return { errors };
      // One retry (D-011): the first refusal hands the problems back for the same agent to fix; the second fails the stage.
      const refusals = (prev.doneRefusals ?? 0) + 1;
      if (refusals <= 1) {
        ctx.run.stages[key] = { ...prev, status: prev.status ?? "running", doneRefusals: refusals };
        writeJson(ctx.p.runFile, ctx.run);
        const { agent, prompt } = stagePrompt(ctx, stage, module);
        return { errors, retry: { agent, prompt: `${prompt} problems=${JSON.stringify(problems.slice(0, 8).join(" | "))}` } };
      }
      ctx.run.stages[key] = { ...prev, status: "failed", finishedAt: now(), doneRefusals: refusals, error: `done refused twice; outputs incomplete: ${problems.slice(0, 5).join("; ")}` };
      writeJson(ctx.p.runFile, ctx.run);
      return { key, ...ctx.run.stages[key], errors, failed: true };
    }
    ctx.run.stages[key] = { ...prev, status: "done", finishedAt: now(), ...(reused ? { reused: true } : {}) };
    delete ctx.run.stages[key].error;
    delete ctx.run.stages[key].doneRefusals;
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
    ...(({ outcome, ...rest }) => ({ outcome: abandon ? "abandoned" : outcome, ...rest }))(endInfo(st, ctx)),
    stages: st.stages.map(({ stage, module, status: s, complete }) => ({ stage, module, status: s, complete })),
  };
  writeJson(path.join(ctx.p.historyDir, `${ctx.runId}.json`), summary);
  unlinkSync(ctx.p.lockFile);
  return summary;
}

// A new run after one that ended awaiting-approval (G10): adopts what that run completed and whose product-level outputs (no
// run id in their path) still verify, so the run continues at the stages that waited for the sign-off. Anything else, and
// every run-level stage, starts fresh. -> {carried: [stage keys], from}
export async function carryForward(product, { root = repoRoot } = {}) {
  const ctx = ctxFor(product, root);
  const last = existsSync(ctx.p.historyDir)
    ? readdirSync(ctx.p.historyDir).filter((n) => n.endsWith(".json")).map((n) => loadJson(path.join(ctx.p.historyDir, n))).filter((h) => h.runId !== ctx.runId).sort((a, b) => String(a.endedAt).localeCompare(String(b.endedAt))).pop()
    : null;
  if (last?.outcome !== "awaiting-approval") return { carried: [] };
  const carried = [];
  // Knowledge is adopted only where its reuse plan says reuse (inputs unchanged), as in the normal reuse path.
  let plan = null;
  try {
    const k = await import("./lib/knowledge.mjs");
    plan = k.plan(k.knowledgePaths(ctx.p.productDir), loadJson(ctx.p.configFile), root);
  } catch {}
  for (const [stage, def] of Object.entries(STAGES)) {
    if (def.outputs.some((o) => o.path.includes("{run}"))) continue;
    for (const module of scopesFor(ctx.run, stage)) {
      if (stage === "knowledge" || stage === "module-knowledge") {
        const verdict = stage === "knowledge" ? plan?.product : plan?.modules?.[module];
        if (verdict !== "reuse") continue;
      }
      if (!last.stages.some((s) => s.stage === stage && (s.module ?? null) === (module ?? null) && s.complete)) continue;
      if ((await verifyOutputs(ctx, stage, module)).length) continue;
      const key = stageKey(stage, module);
      ctx.run.stages[key] = { status: "done", finishedAt: now(), carriedFrom: last.runId };
      carried.push(key);
    }
  }
  if (carried.length) writeJson(ctx.p.runFile, ctx.run);
  return { carried, from: last.runId };
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
    console.error("usage: run.mjs init|guard-check|status|next|stage|end|validate ... (see header comment)");
    process.exit(2);
  }
  try {
    if (cmd === "init") {
      const r = initRun(a, { resume: v.resume, runId: v["run-id"] });
      const carried = r.errors || r.resumed ? null : await carryForward(r.product);
      out(r.errors ? r : { product: r.product, runId: r.run.runId, mode: r.run.mode, modules: r.run.modules, resumed: !!r.resumed, ...(carried?.carried.length ? { carriedFrom: carried.from, carried: carried.carried } : {}), next: `node scripts/run.mjs guard-check ${r.product}` }, r.errors ? 1 : 0);
    } else if (cmd === "guard-check") {
      // Reaching this line means no hook blocked the command: the guard is not active in this session.
      if (!SLUG_RE.test(a) || !existsSync(paths(a).state)) out({ errors: [`no run state for product '${a}'`] }, 1);
      markAbsent(a, repoRoot);
      out({ errors: ["the framework guard did NOT block guard-check: hooks are not active in this session, so nothing enforces the run's mode or permissions. Stop and fix the host's hook setup (docs/platforms.md), then run `node scripts/run.mjs guard-check <product>` again."] }, 1);
    } else if (cmd === "status") out(await status(a));
    else if (cmd === "next") out(await nextStep(a));
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
