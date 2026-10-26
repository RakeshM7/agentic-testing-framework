#!/usr/bin/env node
// Run lifecycle + state machine (layout v2, product-level). One active run per product, enforced by
// artifacts/<product>/state/lock.json. State lives in state/run.json; a stage is complete only when it is marked
// done AND its declared outputs exist and validate.
//
//   run.mjs init <config.yaml> [--resume] [--run-id ID]   start a run (or --resume the active one); freezes the config's
//                                                         `steps` (absent = all six) and the case types they derive into
//                                                         run.json. Every other stage is not-chosen: never offered or
//                                                         started, never failed or blocked. After a run that ended
//                                                         awaiting-approval, the new run adopts the stages that run completed whose
//                                                         product-level outputs still verify (carriedFrom), so it continues at the cases a human approved
//   run.mjs guard-check <product>                         liveness canary: a working guard BLOCKS this (lib/guard-check.mjs)
//   run.mjs doctor <product>                              dependency check for every stage (lib/doctor.mjs, D-064): records
//                                                         state/doctor.json; {checks, blockedStages}; exit 1 if a stage is blocked
//   run.mjs login <config.yaml> [--seconds N]            the human's login (lib/login.mjs, D-069): opens Microsoft Edge
//                                                         (else Chrome, else Playwright's Chromium) on the target with a
//                                                         persistent profile, waits N seconds (default 60) while the human
//                                                         signs in, closes it, saves session_state_file and sets it in the
//                                                         config -> {saved, browser, session, configUpdated, next?}; exit 1
//                                                         when no session was saved or it fails the session check
//   run.mjs prereqs <product>                             the up-front prerequisite check (after doctor, before the first
//                                                         stage): {steps, caseTypes, testcasesMode, ok, gaps: [{module,
//                                                         need, what, steps, options: [{id, label, adds|removes,
//                                                         importMode?, reopen?, args?}]}], modules: {<m>: [{step,
//                                                         status: ok|missing|awaiting-approval, missing?, awaiting?}]}};
//                                                         a need is met by a stage chosen for this run, or by an earlier
//                                                         run's verified outputs (or an imported test case file). Exit 1
//                                                         while a gap is open (awaiting-approval is not a gap)
//   run.mjs steps <product> [--add a,b] [--remove c] [--import-mode m1,m2] [--reopen m1,m2]
//                                                         the gap menu's answer (an option's `args`): change this run's
//                                                         steps (a step whose stages started cannot be removed); put a
//                                                         module's testcases stage in import mode (D-066: convert and link
//                                                         its imported cases, generate nothing; other modules unaffected);
//                                                         send a completed testcases stage back to pending (--reopen: new
//                                                         case types; also when testcases is added to an import-mode
//                                                         module) -> {steps, caseTypes, testcasesMode, stages, reopened,
//                                                         configSteps (the config's steps plus the added ones: a skip
//                                                         never leaves the config), configChanged}
//   run.mjs scenarios <product> [--file <answers.json>]   scenario mode (decision 15): validates the scenarios the
//                                                         orchestrator's interview wrote to state/scenario-answers.json
//                                                         (default) and writes each listed module's
//                                                         modules/<m>/scenarios.json with stable SC ids (lib/explore.mjs);
//                                                         -> {written: {<m>: [SC ids]}, removed: [m]}; exit 1 with
//                                                         {problems}, nothing written
//   run.mjs status <product>                              per-stage status + output verification (status not-chosen,
//                                                         with `satisfied` when an earlier run stands in for it)
//   run.mjs next <product>                                {actions: [{stage, module, agent, prompt, attempt, retry}], concurrency, end?}:
//                                                         the stages to start, each with the agent and the exact prompt (run id, mode,
//                                                         format, module); knowledge that can be reused is marked done here (reused).
//                                                         An automation stage with no human-approved test case is awaiting-approval:
//                                                         never offered, no attempt spent. With nothing left to start, `end` says how
//                                                         the run ends: completed, awaiting-approval (with the approval sheets to review;
//                                                         the report stage is offered before that) or incomplete (failed and blocked stages;
//                                                         never a not-chosen one, which `notChosen` lists)
//   run.mjs stage <product> <stage> start|done|fail [--module M] [--error MSG]   (start needs a verified guard and a passing dependency check)
//                                                         done is refused with the problems and, the first time, a `retry` {agent, prompt}
//                                                         to give the same agent once; the second refusal fails the stage itself (D-011).
//                                                         A domain whose review used up its rounds is failed (reviewFailed, with its open
//                                                         findings) and blocks its dependants at once.
//   run.mjs end <product> [--abandon]                     write state/history/<run-id>.json and results/<run>/manifest.json
//                                                         (the sha256 of every working file and test code file, D-078), and
//                                                         release the lock
//   run.mjs diff <product> [<run-a> <run-b>]              what changed between two ended runs' manifests (default: the last
//                                                         two), per area: added, removed, changed
//   run.mjs validate <product>                            schema-check run.json, ledger, permissions, module outputs
//
// All commands print JSON; exit 1 = refused/invalid, 2 = usage error.

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { parseArgs } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { DEFAULT_PERMISSIONS, validateRunConfig } from "./run-config.mjs";
import { DEFAULT_ENV, LAYOUT_VERSION, PRODUCT_SCOPE, SLUG_RE, STAGES, STEPS, chosenStages, deriveCaseTypes, envName, loadJson, paths, workspaceRoot, stageChosen, stageKey, stageNeeds, testcasesModeOf, testcasesModes, validateData, validateFile, verifyOutputs } from "./lib/contract.mjs";
import { withFileLock, withFileLockAsync, writeJson } from "./lib/files.mjs";
import { read as readLedger } from "./lib/ledger.mjs";
import { csvPath, ensureCsv } from "./lib/clarifications.mjs";
import { resolvePermissions } from "./lib/permissions.mjs";
import { configPath } from "./lib/config.mjs";
import { expandFw, frameworkRoot, frameworkRel } from "./lib/roots.mjs";
import { clearGuardChecks, guardStatus, markAbsent } from "./lib/guard-check.mjs";
import { GROUPS, STAGE_NEEDS, clearDoctor, doctorStatus, failures, recordDoctor, runChecks } from "./lib/doctor.mjs";
import { login as openLogin } from "./lib/login.mjs";
import { detectShellHost } from "./lib/hosts.mjs";
import { collectProvenance } from "./lib/provenance.mjs";
import { diffManifests, readManifest, writeManifest } from "./lib/history.mjs";
import { issuesPath, readIssues, writeFeedback } from "./lib/framework-issues.mjs";
import { approvalSummary, caseTypeOf, importStatus, testcasePaths } from "./lib/testcases.mjs";
import { SCENARIO_ANSWERS, writeScenarios } from "./lib/explore.mjs";

const now = () => new Date().toISOString();
const rel = (root, p) => path.relative(root, p).replaceAll("\\", "/");

export const makeRunId = (product, date = new Date(), environment = DEFAULT_ENV) =>
  `${product}${environment === DEFAULT_ENV ? "" : `-${environment}`}-${date.toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-")}`; // eventhub-20261007-1230, eventhub-staging-20261007-1230

// root: the workspace the run lives in; framework: the framework root its permissions, provenance and commands come from
// (D-085; the same directory in this repository).
export function initRun(configFile, { resume = false, runId, root = workspaceRoot, framework = frameworkRoot, env = process.env } = {}) {
  const { errors, warnings = [], normalized: cfg } = validateRunConfig(yaml.load(readFileSync(configFile, "utf8")), { root });
  if (errors?.length) return { errors };
  // the session's environment (D-081) must be the config's: every script and hook of the session works in it
  let environment;
  try {
    environment = envName(env);
  } catch (e) {
    return { errors: [e.message] };
  }
  if (cfg.environment !== environment)
    return { errors: [`${rel(root, path.resolve(configFile))} is for environment '${cfg.environment}', but this session's is '${environment}' (ATF_ENV): start the session with ATF_ENV=${cfg.environment} (make run PRODUCT=${cfg.product} ENV=${cfg.environment}), so every script and hook works in that environment`] };
  const p = paths(cfg.product, root, environment);

  if (existsSync(p.lockFile)) {
    const lock = loadJson(p.lockFile);
    if (resume) {
      clearGuardChecks(cfg.product, root); // a resumed session must verify its own guard
      clearDoctor(cfg.product, root); // ... and check its own machine
      const { run, interrupted } = interruptRunning(p.runFile);
      return { resumed: true, product: cfg.product, run, ...(interrupted.length ? { interrupted } : {}) };
    }
    return { errors: [`run ${lock.runId} is active for product '${cfg.product}' (started ${lock.createdAt}). Use --resume, or end it: run.mjs end ${cfg.product} --abandon`] };
  }
  if (resume) return { errors: [`no active run for product '${cfg.product}' to resume`] };

  // the default names the framework's own permissions (read through scripts/lib/config.mjs); any other path is the
  // workspace's. `{fw}` in a shell allow-list becomes the framework's path from the workspace, so the frozen copy holds
  // the exact commands the agents run.
  const permPath = cfg.permissions_file === DEFAULT_PERMISSIONS ? configPath("permissions.yaml", { framework }) : path.resolve(root, cfg.permissions_file);
  if (!existsSync(permPath)) return { errors: [`permissions_file ${cfg.permissions_file} not found`] };
  const perms = resolvePermissions(yaml.load(readFileSync(permPath, "utf8")), { fw: frameworkRel(root, framework) });
  if (perms.errors.length) return { errors: perms.errors.map((e) => `permissions: ${e}`) };

  let id = runId ?? makeRunId(cfg.product, undefined, environment);
  if (!SLUG_RE.test(id)) return { errors: [`run id '${id}' must be lowercase kebab-case`] };
  for (let n = 2; existsSync(path.join(p.historyDir, `${id}.json`)) || existsSync(p.results(id)); n++) id = `${runId ?? makeRunId(cfg.product, undefined, environment)}-${n}`;

  const run = {
    layoutVersion: LAYOUT_VERSION,
    product: cfg.product,
    environment,
    runId: id,
    createdAt: now(),
    target: { url: cfg.target.url, ...(cfg.target.api_urls?.length ? { api_urls: cfg.target.api_urls } : {}) },
    mode: cfg.authorizations.mode,
    configPath: rel(root, path.resolve(configFile)),
    permissionsPath: rel(root, permPath),
    modules: cfg.modules.map((m) => m.slug),
    // the steps chosen for this run and the test case types they derive (decision 11); every other stage is not-chosen
    steps: STEPS.filter((s) => cfg.steps.includes(s)),
    caseTypes: deriveCaseTypes(cfg.steps, cfg.testcases.types),
    // the testcases stage's mode per module (D-066): generate for all when testcases is chosen; import mode is added
    // per module by run.mjs steps --import-mode
    testcasesMode: testcasesModes({ steps: STEPS.filter((s) => cfg.steps.includes(s)), modules: cfg.modules.map((m) => m.slug) }),
    startedOnHost: detectShellHost(env),
    // what the run is made with (D-077): framework commit, browser server, models, templates, Node.js
    provenance: collectProvenance(framework),
    stages: {},
  };
  clearGuardChecks(cfg.product, root);
  clearDoctor(cfg.product, root);
  writeJson(p.lockFile, { runId: id, createdAt: run.createdAt, configPath: run.configPath });
  writeJson(p.runFile, run);
  writeJson(p.configFile, cfg);
  writeJson(p.permissionsFile, perms.resolved);
  mkdirSync(p.results(id), { recursive: true });
  for (const m of run.modules) {
    mkdirSync(p.module(m), { recursive: true });
    ensureCsv(csvPath(p.productDir, m)); // header-only file, so a module with no open questions still has its CSV
  }
  return { product: cfg.product, run, ...(warnings.length ? { warnings } : {}) };
}

// Every read-modify-write of run.json holds its lock (D-072), so two run.mjs processes never lose each other's update. A
// holder older than RUN_LOCK.staleMs is taken to be dead (a `stage done` verifies outputs, which takes seconds, not minutes).
// Without run state there is nothing to lock: `fn` reports that itself.
const RUN_LOCK = { staleMs: 300_000, retries: 600 };
const runFileOf = (product, root) => paths(product, root).runFile;
const lockedRun = (product, root, fn) => (existsSync(runFileOf(product, root)) ? withFileLock(runFileOf(product, root), fn, RUN_LOCK) : fn());
const lockedRunAsync = (product, root, fn) => (existsSync(runFileOf(product, root)) ? withFileLockAsync(runFileOf(product, root), fn, RUN_LOCK) : fn());

// init --resume (D-071): a stage still `running` belonged to a session that has ended, so nothing will ever mark it. It
// becomes a failed attempt (`interrupted`), which next offers again while it has attempts left (D-011 counts it).
function interruptRunning(runFile) {
  return withFileLock(runFile, () => {
    const run = loadJson(runFile);
    const interrupted = Object.keys(run.stages ?? {}).filter((k) => run.stages[k].status === "running");
    for (const k of interrupted) {
      const { doneRefusals, ...rec } = run.stages[k];
      run.stages[k] = { ...rec, status: "failed", interrupted: true, finishedAt: now(), error: "interrupted: the session running this stage ended before it was marked done or failed" };
    }
    if (interrupted.length) writeJson(runFile, run);
    return { run, interrupted };
  }, RUN_LOCK);
}

function ctxFor(product, root) {
  const p = paths(product, root);
  if (!existsSync(p.runFile)) throw new Error(`no run state for product '${product}' (run.mjs init first)`);
  const run = loadJson(p.runFile);
  const cfg = existsSync(p.configFile) ? loadJson(p.configFile) : {};
  return { p, run, root, product, runId: run.runId, active: existsSync(p.lockFile), clarificationsPolicy: cfg.clarifications?.unresolved_policy ?? "stop", testcasesFormat: cfg.testcases?.output_format ?? "gherkin" };
}

const scopesFor = (run, stage) => (STAGES[stage].scope === "product" ? [null] : run.modules);
// The status rows of a dependency of `row` (its own module's, or the product-level one).
const depRows = (rows, row, dep) => rows.filter((r) => r.stage === dep && (STAGES[dep].scope === "product" || r.module === row.module));
// A need is met by a stage complete in this run, or not chosen for it and satisfied from an earlier run (or an import).
const met = (r) => r.complete || (r.notChosen && r.satisfied);
const settled = (r) => r.complete || r.exhausted || r.blocked || r.awaitingApproval || r.notChosen;

// Whether an imported test case file covers the module's test cases, standing in for a testcases stage not chosen for
// this run (B3): `testcases.mjs import` (or testcase-writer's import mode) left imported cases, the build on disk is
// from exactly that import and cases.json, and it found no problem.
export function importCovers(productDir, module) {
  const s = importStatus(productDir, module);
  return s.imported > 0 && s.current && !s.problems.length;
}

// The approved cases of one type (ui | api | performance) of a module's test cases (D-053): ui is every case that is not
// @api or @performance. An imported UI case counts as automatable only once linked to exploration states (decision
// 14); `unlinked` lists the approved ones that are not.
export function approvedOfType(productDir, module, type) {
  const a = approvalSummary(productDir, module);
  const approved = new Set(a.approved);
  const cases = a.cases.filter((c) => caseTypeOf(c) === type);
  const unlinked = (c) => type === "ui" && c.source === "imported" && !(c.states ?? []).length;
  return { built: a.built, cases: cases.length, approved: cases.filter((c) => approved.has(c.id) && !unlinked(c)).map((c) => c.id), unlinked: cases.filter((c) => approved.has(c.id) && unlinked(c)).map((c) => c.id) };
}

// A stage not chosen for this run stands in for its dependants when what it produces is there from an earlier run: its
// outputs (none run-level) verify now, as carry-forward checks them -- or, for test cases, an imported file covers them.
async function satisfiedEarlier(ctx, stage, module) {
  if (stage === "testcases" && importCovers(ctx.p.productDir, module)) return "import";
  if (STAGES[stage].outputs.some((o) => o.path.includes("{run}"))) return null;
  try {
    return (await verifyOutputs(ctx, stage, module)).length ? null : "earlier-run";
  } catch {
    return null; // outputs a check cannot read do not stand in for anything
  }
}

export async function status(product, { root = workspaceRoot } = {}) {
  const ctx = ctxFor(product, root);
  const rows = [];
  for (const stage of Object.keys(STAGES))
    for (const module of scopesFor(ctx.run, stage)) {
      // not chosen for this run (for this module: the testcases stage runs for a module in import mode only): never
      // offered, started, failed or blocked (B2)
      if (!stageChosen(ctx.run, stage, module)) {
        const by = await satisfiedEarlier(ctx, stage, module);
        rows.push({ stage, module, orchestrator: STAGES[stage].orchestrator, status: "not-chosen", notChosen: true, satisfied: !!by, ...(by ? { satisfiedBy: by } : {}), attempts: 0, complete: false, exhausted: false, problems: [] });
        continue;
      }
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
  // A stage is blocked when something it depends on is exhausted (failed MAX_ATTEMPTS times) or itself blocked, or is a
  // stage not chosen for this run that no earlier run (or import) stands in for (`unmet`). STAGES is declared in
  // dependency order, so one pass suffices.
  for (const row of rows) {
    if (row.notChosen) continue;
    const needs = stageNeeds(row.stage, ctx.run).filter((d) => d !== "*");
    const unmet = needs.filter((d) => depRows(rows, row, d).some((r) => r.notChosen && !r.satisfied));
    row.blocked = !row.complete && (unmet.length > 0 || needs.some((d) => depRows(rows, row, d).some((r) => r.exhausted || r.blocked)));
    if (row.blocked && unmet.length) row.unmet = unmet;
    // awaiting-approval (D-053): an automation stage of a module none of whose test cases of the stage's type a human
    // approved yet, once the stages it needs are met, and every stage that needs one. It is not offered, can't be started,
    // spends no attempt (MAX_ATTEMPTS) and counts as settled for the report; a later run picks the module up once cases
    // are approved.
    const own = STAGES[row.stage].approval && needs.every((d) => depRows(rows, row, d).every(met)) && !approvedOfType(ctx.p.productDir, row.module, STAGES[row.stage].approval).approved.length;
    row.awaitingApproval = !row.complete && !row.blocked && (!!own || needs.some((d) => depRows(rows, row, d).some((r) => r.awaitingApproval)));
    if (row.awaitingApproval && row.status !== "running") row.status = "awaiting-approval";
  }
  // The guard check's verdict from its records (D-037): hosts word the canary's block differently (Copilot shows exit 2
  // as "hook errored"), so the orchestrator confirms it here instead of reading the host's message.
  const guard = guardStatus(product, ctx.run.mode, root);
  return { product, runId: ctx.runId, active: ctx.active, mode: ctx.run.mode, modules: ctx.run.modules, guard, stages: rows };
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

export async function next(product, { root = workspaceRoot } = {}) {
  const st = await status(product, { root });
  if (!st.active) return [];
  const ctx = ctxFor(product, root);
  const ready = [];
  for (const row of st.stages) {
    if (settled(row) || row.status === "running") continue;
    const needs = stageNeeds(row.stage, ctx.run);
    // `after`: a stage chosen for this run is waited for until it settles, never required (testcases uses answered
    // clarifications when there are any)
    const after = (STAGES[row.stage].after ?? []).every((dep) => depRows(st.stages, row, dep).every(settled));
    const ok = needs.includes("*") ? st.stages.every((r) => r.stage === row.stage || settled(r)) : after && needs.every((dep) => depRows(st.stages, row, dep).every(met));
    if (ok) ready.push({ stage: row.stage, module: row.module, orchestrator: row.orchestrator, attempt: row.attempts + 1, retry: row.status !== "pending", ...stagePrompt(ctx, row.stage, row.module) });
  }
  return ready;
}

// How a run with nothing left to start ends: completed; awaiting-approval (only stages waiting for a human to sign off test
// cases remain: the report is done, the approval sheets are listed); or incomplete (failed or blocked stages). A stage not
// chosen for the run never makes it incomplete; `notChosen` lists those stages.
export function endInfo(st, ctx) {
  const done = (r) => r.complete || r.notChosen;
  const outcome = st.stages.every(done) ? "completed" : st.stages.every((r) => done(r) || r.awaitingApproval) ? "awaiting-approval" : "incomplete";
  const sheets = [...new Set(st.stages.filter((r) => r.awaitingApproval).map((r) => r.module))].map((module) => {
    const a = approvalSummary(ctx.p.productDir, module);
    return { module, file: a.built ? rel(ctx.root, testcasePaths(ctx.p.productDir, module).approvalCsv) : null, built: a.built, awaiting: a.counts.awaiting, approved: a.counts.approved };
  });
  const failed = st.stages.filter((r) => r.status === "failed").map((r) => ({ stage: r.stage, module: r.module, error: r.error, attempts: r.attempts, exhausted: r.exhausted, ...(r.reviewFailed ? { reviewFailed: true, findings: r.findings } : {}) }));
  const blocked = st.stages.filter((r) => r.blocked).map((r) => ({ stage: r.stage, module: r.module, ...(r.unmet ? { unmet: r.unmet } : {}) }));
  const running = st.stages.filter((r) => r.status === "running").map((r) => ({ stage: r.stage, module: r.module }));
  const notChosen = [...new Set(st.stages.filter((r) => r.notChosen).map((r) => r.stage))];
  return { outcome, ...(sheets.length ? { sheets } : {}), ...(failed.length ? { failed } : {}), ...(blocked.length ? { blocked } : {}), ...(running.length ? { running } : {}), ...(notChosen.length ? { notChosen } : {}) };
}

// The orchestrator-agent's loop (G10): what to start now (agent + exact prompt), with reusable knowledge marked done here, or
// how the run ends. `end` is present only when there is nothing to start.
export async function nextStep(product, { root = workspaceRoot } = {}) {
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

// ---- the chosen steps: the up-front prerequisite check and the gap menu's changes (decisions 7 and 8) ----

// The gap menu: what each answer adds to (or removes from) the run. `import` sets the module's testcases_file (or the
// product's testcases.import) through run-config.mjs set and imports it; `scenarios` explores only the flows of the
// scenarios the human describes; `link` runs the module's testcases stage in import mode (D-066: its imported cases are
// converted and linked, nothing is generated); `types` sends a testcases stage completed this run back for the case
// types the run added since.
export const GAP_OPTIONS = {
  explore: "Explore the product",
  clarifications: "Ask clarification questions",
  testcases: "Generate test cases",
  scenarios: "Describe scenarios to explore",
  import: "Use my test case file",
  link: "Link my imported cases to the explored screens",
  types: "Generate the missing test case types",
  skip: "Skip this step for this run",
};
const option = (id, step, { adds = [], importMode, reopen, label } = {}) => ({
  id, label: label ?? GAP_OPTIONS[id],
  ...(id === "skip" ? { removes: [step] } : { adds }),
  ...(importMode ? { importMode } : {}), ...(reopen ? { reopen } : {}),
});
const GAP = {
  explore: (step) => [option("explore", step, { adds: ["explore"] }), option("scenarios", step, { adds: ["explore"] }), option("skip", step)],
  testcases: (step) => [option("testcases", step, { adds: ["testcases"] }), option("clarifications", step, { adds: ["clarifications", "testcases"] }), option("scenarios", step, { adds: ["explore", "testcases"] }), option("import", step), option("skip", step)],
  link: (step, m) => [option("link", step, { importMode: [m] }), option("skip", step)],
  types: (step, m, types) => [option("types", step, { adds: ["testcases"], reopen: [m], label: `Generate ${types.map((t) => `@${t}`).join(" / ")} cases` }), option("skip", step)],
};
// The `run.mjs steps` arguments of a gap option (the orchestrator runs `node scripts/run.mjs steps <p> <args>`).
const stepsArgs = (o) => [
  o.adds?.length ? `--add ${o.adds.join(",")}` : "", o.removes?.length ? `--remove ${o.removes.join(",")}` : "",
  o.importMode?.length ? `--import-mode ${o.importMode.join(",")}` : "", o.reopen?.length ? `--reopen ${o.reopen.join(",")}` : "",
].filter(Boolean).join(" ");
const CASE_TYPE_OF = { "playwright-ui": "ui", "playwright-api": "api", k6: "performance" };
// The case types a module's last test case build enumerated (testcases/coverage.json caseTypes; UI before them).
const builtCaseTypes = (productDir, m) => {
  const f = testcasePaths(productDir, m).coverage;
  return existsSync(f) ? (loadJson(f).caseTypes ?? ["ui"]) : null;
};

// Per module, per chosen step: `ok` (what it needs is there from an earlier run or an import, or a stage chosen for
// this run produces it), `missing` (each need with what is missing and the gap menu's options that apply) or
// `awaiting-approval` (test cases of the step's type exist but a human approved none: the run goes on and ends
// awaiting-approval, D-053/D-060). Steps that need test cases need them of their type: UI for playwright-ui, @api for
// playwright-api, @performance for k6; they and every step after explore also need an exploration (the pages the UI
// cases touch, the traffic API discovery reads). A testcases stage that runs for the module this run (generate, or
// import mode: D-066) produces them, unless it already completed this run without a type the run added since.
// Every option that changes the run carries `args` for `run.mjs steps <p> <args>`.
// -> {product, runId, steps, caseTypes, testcasesMode, ok, gaps, modules: {<m>: [{step, status, missing?, awaiting?}]}}
export async function prereqs(product, { root = workspaceRoot } = {}) {
  const ctx = ctxFor(product, root);
  if (!ctx.active) return { errors: [`run ${ctx.runId} has ended; start a new run`] };
  const st = await status(product, { root });
  const steps = ctx.run.steps ?? STEPS;
  const row = (stage, m) => st.stages.find((r) => r.stage === stage && r.module === m);
  // produced by a stage chosen for this run, or there from an earlier run (or an import)
  const present = (stage, m) => stageChosen(ctx.run, stage, m) || !!row(stage, m)?.satisfied;
  const modules = {};
  for (const m of ctx.run.modules) {
    const mode = testcasesModeOf(ctx.run, m);
    const tc = row("testcases", m);
    const built = tc?.complete ? builtCaseTypes(ctx.p.productDir, m) : null;
    modules[m] = steps.map((step) => {
      const missing = [];
      if (step !== "explore" && !present("explore", m))
        missing.push({ need: "explore", what: `${m} has not been explored (no earlier exploration verifies)`, options: GAP.explore(step) });
      const type = CASE_TYPE_OF[step];
      let awaiting = null;
      if (type && built && !built.includes(type))
        // the stage completed this run before the step was added: its cases have no item of this type
        missing.push({ need: "testcases", what: `${m}'s test cases were generated this run without @${type} cases: generate @${type} cases (the sign-offs of unchanged cases stand)`, options: GAP.types(step, m, [type]) });
      else if (type && mode !== "generate" && !(mode === "import" && !tc?.complete)) {
        // cases from an earlier run or the human's import (an import-mode stage still to run converts and links them)
        const a = approvedOfType(ctx.p.productDir, m, type);
        const label = type === "ui" ? "UI" : `@${type}`;
        if (!mode && !tc?.satisfied) missing.push({ need: "testcases", what: `${m} has no test cases (no earlier run produced them and no file of yours covers this module)`, options: GAP.testcases(step) });
        else if (!a.cases) missing.push({ need: "testcases", what: `${m} has no ${label} test cases`, options: GAP.testcases(step) });
        else if (!a.approved.length && !a.unlinked.length) awaiting = { type, cases: a.cases };
      }
      // imported UI cases are automated only once linked to the exploration's states (decision 14): the testcases stage
      // links them (testcase-writer, in either mode); with no testcases stage for the module this run, the link option
      // runs it in import mode for this module only
      if (step === "playwright-ui" && !mode) {
        const unlinked = importStatus(ctx.p.productDir, m).unlinkedUi;
        if (unlinked.length) missing.push({ need: "link", what: `${unlinked.length} imported UI case(s) of ${m} are not linked to the explored screens (${unlinked.join(", ")}): testcase-writer links them in the testcases stage's import mode, for ${m} only, without generating cases`, options: GAP.link(step, m), link: unlinked });
      }
      return { step, status: missing.length ? "missing" : awaiting ? "awaiting-approval" : "ok", ...(missing.length ? { missing } : {}), ...(awaiting && !missing.length ? { awaiting } : {}) };
    });
  }
  // one question per gap: a module's missing need, with every step it holds up (skip removes them all)
  const gaps = [];
  for (const [module, rows] of Object.entries(modules))
    for (const r of rows)
      for (const g of r.missing ?? []) {
        const same = gaps.find((x) => x.module === module && x.need === g.need && x.what === g.what);
        if (same) {
          same.steps.push(r.step);
          same.options.find((o) => o.id === "skip").removes.push(r.step);
        } else gaps.push({ module, need: g.need, what: g.what, steps: [r.step], options: structuredClone(g.options) });
      }
  for (const g of gaps) for (const o of g.options) if (stepsArgs(o)) o.args = stepsArgs(o);
  return { product, runId: ctx.runId, steps, caseTypes: ctx.run.caseTypes ?? deriveCaseTypes(steps), testcasesMode: ctx.run.testcasesMode ?? testcasesModes(ctx.run), ok: !gaps.length, gaps, modules };
}

// The gap menu's answer for this run: adds steps to it, removes steps none of whose stages started this run, puts
// modules' testcases stage in import mode (importMode, D-066) and sends completed testcases stages back (reopen: for
// case types added since; also done for a module whose import-mode stage completed when `testcases` is added). The
// case types are derived again (decision 11); a reopened stage keeps the human sign-offs of unchanged cases (they are
// pinned to the case content). configSteps: the run-config's own steps plus the added ones (a skip never removes one),
// configChanged: whether the config needs them written. -> {steps, caseTypes, testcasesMode, stages, reopened,
// configSteps, configChanged} or {errors}
export function changeSteps(product, { add = [], remove = [], importMode = [], reopen = [], root = workspaceRoot } = {}) {
  return lockedRun(product, root, () => applySteps(product, { add, remove, importMode, reopen, root }));
}

function applySteps(product, { add, remove, importMode, reopen, root }) {
  const ctx = ctxFor(product, root);
  if (!ctx.active) return { errors: [`run ${ctx.runId} has ended; start a new run`] };
  const unknown = [...add, ...remove].filter((s) => !STEPS.includes(s));
  if (unknown.length) return { errors: [`unknown step(s) ${unknown.join(", ")} (one of ${STEPS.join(", ")})`] };
  const badModules = [...importMode, ...reopen].filter((m) => !ctx.run.modules.includes(m));
  if (badModules.length) return { errors: [`unknown module(s) ${badModules.join(", ")} (one of ${ctx.run.modules.join(", ")})`] };
  const steps = STEPS.filter((s) => (add.includes(s) || (ctx.run.steps ?? STEPS).includes(s)) && !remove.includes(s));
  if (!steps.length) return { errors: ["a run needs at least one step"] };
  const cfg = existsSync(ctx.p.configFile) ? loadJson(ctx.p.configFile) : {};
  const next = { ...ctx.run, steps, caseTypes: deriveCaseTypes(steps, cfg.testcases?.types) };
  next.testcasesMode = testcasesModes(next, importMode);
  const moduleOf = (k) => (k.startsWith(`${PRODUCT_SCOPE}/`) ? null : k.split("/")[0]);
  const started = Object.keys(ctx.run.stages).filter((k) => stageChosen(ctx.run, k.split("/")[1], moduleOf(k)) && !stageChosen(next, k.split("/")[1], moduleOf(k)));
  if (started.length) return { errors: [`cannot remove: ${started.join(", ")} already started this run`] };
  // reopen: the testcases stages completed this run that must run again
  const why = new Map(reopen.map((m) => [m, `reopened for the case types ${next.caseTypes.join(", ")}`]));
  for (const m of ctx.run.modules) if (testcasesModeOf(ctx.run, m) === "import" && testcasesModeOf(next, m) === "generate") why.set(m, "reopened: the testcases step was added (import mode becomes generate)");
  const reopened = [];
  next.stages = { ...ctx.run.stages };
  for (const [m, reason] of why) {
    const key = stageKey("testcases", m);
    const rec = next.stages[key];
    if (rec?.status === "running") return { errors: [`cannot reopen ${key}: it is running`] };
    if (rec?.status !== "done") continue; // not completed: it runs with the new types or mode anyway
    if (!stageChosen(next, "testcases", m)) return { errors: [`cannot reopen ${key}: the testcases stage does not run for ${m} this run (add the testcases step, or --import-mode ${m})`] };
    next.stages[key] = { status: "pending", reopened: reason };
    // the domain loop starts again (orchestration.mjs keeps its state per run, domain and module)
    const orch = path.join(ctx.p.orchestrationDir, `testcases-${m}.json`);
    if (existsSync(orch)) unlinkSync(orch);
    reopened.push(key);
  }
  writeJson(ctx.p.runFile, next);
  // what the run-config keeps (run-config.mjs set --steps, after an add only): its own steps plus the added ones. A skip
  // is for this run only, so a step skipped now (or earlier this run) is never dropped from the config.
  let own = STEPS;
  try {
    own = yaml.load(readFileSync(path.resolve(root, ctx.run.configPath), "utf8"))?.steps ?? STEPS;
  } catch {}
  const configSteps = STEPS.filter((s) => own.includes(s) || add.includes(s));
  return { steps, caseTypes: next.caseTypes, testcasesMode: next.testcasesMode, stages: Object.keys(STAGES).filter((s) => chosenStages(next).has(s)), reopened, configSteps, configChanged: configSteps.length !== STEPS.filter((s) => own.includes(s)).length };
}

// Scenario mode (decision 15): the interview's answers file -> each listed module's scenarios.json. Nothing is written
// while a problem remains. -> {written, removed, answers} | {problems} | {errors}
export async function scenarios(product, { file, root = workspaceRoot } = {}) {
  const ctx = ctxFor(product, root);
  if (!ctx.active) return { errors: [`run ${ctx.runId} has ended; start a new run`] };
  const f = file ? path.resolve(root, file) : path.join(ctx.p.state, SCENARIO_ANSWERS);
  if (!existsSync(f)) return { problems: [`${path.relative(root, f).replaceAll("\\", "/")}: missing (the orchestrator writes the scenario interview's answers there)`] };
  let answers;
  try {
    answers = JSON.parse(readFileSync(f, "utf8"));
  } catch (e) {
    return { problems: [`${path.basename(f)}: not valid JSON (${e.message})`] };
  }
  const r = writeScenarios({ productDir: ctx.p.productDir, modules: ctx.run.modules, runId: ctx.runId, answers });
  if (r.problems) return r;
  const bad = [];
  for (const m of Object.keys(r.written)) for (const e of await validateData("scenarios", loadJson(path.join(ctx.p.productDir, "modules", m, "scenarios.json")))) bad.push(`modules/${m}/scenarios.json: ${e}`);
  return bad.length ? { problems: bad } : { ...r, answers: path.relative(root, f).replaceAll("\\", "/") };
}

// The dependency check for every stage of the active run, recorded for `stage … start` (D-064). Fixing is the human's
// (make doctor PRODUCT=<p>); the result names each fix and the stages that wait for it.
export async function doctor(product, { root = workspaceRoot, ...opts } = {}) {
  const ctx = ctxFor(product, root);
  if (!ctx.active) return { errors: [`run ${ctx.runId} has ended; start a new run`] };
  const groups = GROUPS.filter((g) => g !== "login");
  const checks = await runChecks(loadJson(ctx.p.configFile), groups, { root, ...opts });
  recordDoctor(product, root, { groups, checks });
  // a stage not chosen for this run (for any module) is never reported as blocked (B6)
  const blockedStages = Object.keys(STAGE_NEEDS).filter((s) => ctx.run.modules.some((m) => stageChosen(ctx.run, s, STAGES[s].scope === "product" ? null : m)) && failures(checks, STAGE_NEEDS[s]).length);
  return { checks: checks.map(({ autofix, ...c }) => c), blockedStages, ...(blockedStages.length ? { fix: `tell the human each failing check and its fix; they run make doctor PRODUCT=${product} (it applies the safe installs), then run.mjs doctor ${product} again. Stages not listed can start now.` } : {}) };
}

// The human's login over the run-config at configFile (works before a run exists, and during one).
export async function login(configFile, { root = workspaceRoot, ...opts } = {}) {
  let text;
  try {
    text = readFileSync(configFile, "utf8");
  } catch (e) {
    return { errors: [`cannot read ${configFile}: ${e.message}`] };
  }
  const check = (t) => validateRunConfig(yaml.load(t), { root });
  const { errors, normalized: cfg } = check(text);
  if (errors?.length) return { errors: errors.map((e) => `${configFile}: ${e}`) };
  return openLogin({ cfg, configFile, text, root, validate: (t) => check(t).errors ?? [], ...opts });
}

export async function setStage(product, stage, module, action, error, { root = workspaceRoot, reused = false } = {}) {
  if (!STAGES[stage]) return { errors: [`unknown stage '${stage}' (one of ${Object.keys(STAGES).join(", ")})`] };
  return lockedRunAsync(product, root, () => applyStage(product, stage, module, action, error, { root, reused }));
}

async function applyStage(product, stage, module, action, error, { root, reused }) {
  const ctx = ctxFor(product, root);
  if (!ctx.active) return { errors: [`run ${ctx.runId} has ended; start a new run`] };
  if (STAGES[stage].scope === "module" && !ctx.run.modules.includes(module)) return { errors: [`--module must be one of [${ctx.run.modules.join(", ")}]`] };
  const key = stageKey(stage, module);
  if (!stageChosen(ctx.run, stage, STAGES[stage].scope === "product" ? null : module))
    return { errors: [`${key} is not chosen for this run (steps: ${(ctx.run.steps ?? STEPS).join(", ")}): it is never started${STEPS.includes(stage) ? `; to run it, add the step: node scripts/run.mjs steps ${product} --add ${stage}` : ""}. No attempt was spent.`] };
  const prev = ctx.run.stages[key] ?? {};
  if (action === "start") {
    const row = (await status(product, { root })).stages.find((r) => r.stage === stage && (STAGES[stage].scope === "product" || r.module === module));
    const what = { ui: "UI test case", api: "@api test case", performance: "@performance test case" }[STAGES[stage].approval] ?? "test case";
    // approved imported UI cases that are only unlinked: the fix is linking them, not a human sign-off (decision 14)
    const unlinked = row?.awaitingApproval && STAGES[stage].approval === "ui" ? approvedOfType(ctx.p.productDir, module, "ui").unlinked : [];
    if (unlinked.length)
      return { errors: [`${key} cannot start: ${unlinked.length} approved imported UI case(s) of ${module} (${unlinked.join(", ")}) are not linked to the explored screens, and no other UI case is approved. ${testcasesModeOf(ctx.run, module) === "generate" ? `Link them: the testcases stage of ${module} links them when it runs again (node scripts/run.mjs steps ${product} --reopen ${module})` : `Link them: run.mjs prereqs ${product} offers "${GAP_OPTIONS.link}" (node scripts/run.mjs steps ${product} --import-mode ${module}, the testcases stage in import mode for ${module} only)`}. No attempt was spent.`] };
    if (row?.awaitingApproval)
      return { errors: [`${key} is awaiting approval: ${approvalSummary(ctx.p.productDir, module).built ? `no ${what} of ${module} is approved by a human yet (testcases/approval.csv, then node scripts/testcases.mjs approve in a terminal)` : `the test cases of ${module} predate scripts/testcases.mjs, so none can be approved: rebuild them (rerun the testcases stage), then a human approves them`}; a later run picks it up. No attempt was spent.`] };
    const guard = guardStatus(product, ctx.run.mode, root);
    if (!guard.ready) return { errors: [`guard not verified: ${guard.reason}`] };
    const deps = doctorStatus(product, stage, root);
    if (!deps.ready) return { errors: [`dependencies not ready: ${deps.reason}`] };
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

export async function endRun(product, { abandon = false, root = workspaceRoot } = {}) {
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
  // what this run left behind, so a later run can be diffed against it (D-078)
  summary.manifest = writeManifest(root, product, ctx.p.results(ctx.runId), ctx.runId);
  // the framework problems agents recorded, as feedback files for feedback-implementor-agent (D-083)
  const { issues } = readIssues(issuesPath(ctx.p.results(ctx.runId)));
  if (issues.length) summary.feedback = writeFeedback(root, { issues, runId: ctx.runId, product });
  writeJson(path.join(ctx.p.historyDir, `${ctx.runId}.json`), summary);
  unlinkSync(ctx.p.lockFile);
  return summary;
}

// A new run after one that ended awaiting-approval (G10): adopts what that run completed and whose product-level outputs (no
// run id in their path) still verify, so the run continues at the stages that waited for the sign-off. Anything else, and
// every run-level stage, starts fresh. -> {carried: [stage keys], from}
// The ended runs of a product, oldest first, from state/history/.
function endedRuns(ctx) {
  if (!existsSync(ctx.p.historyDir)) return [];
  return readdirSync(ctx.p.historyDir).filter((n) => n.endsWith(".json")).map((n) => loadJson(path.join(ctx.p.historyDir, n))).sort((x, y) => String(x.endedAt).localeCompare(String(y.endedAt)));
}

// What changed between two ended runs (D-078); without ids, the last two. -> diffManifests() | {errors}
export function diffRuns(product, runA, runB, { root = workspaceRoot } = {}) {
  const ctx = ctxFor(product, root);
  let [a, b] = [runA, runB];
  if (!a !== !b) return { errors: ["give two run ids, or none for the last two ended runs"] };
  if (!a) {
    const ended = endedRuns(ctx).map((h) => h.runId);
    if (ended.length < 2) return { errors: [`${product} has ${ended.length} ended run(s): a diff needs two`] };
    [a, b] = ended.slice(-2);
  }
  const ma = readManifest(ctx.p.results(a));
  const mb = readManifest(ctx.p.results(b));
  const missing = [[a, ma], [b, mb]].filter(([, m]) => !m).map(([id]) => id);
  if (missing.length) return { errors: missing.map((id) => `${id} has no manifest (it has not ended, or it ended before D-078)`) };
  return diffManifests(ma, mb, product);
}

export async function carryForward(product, { root = workspaceRoot } = {}) {
  return lockedRunAsync(product, root, () => adoptCompleted(product, root));
}

async function adoptCompleted(product, root) {
  const ctx = ctxFor(product, root);
  const last = endedRuns(ctx).filter((h) => h.runId !== ctx.runId).pop() ?? null;
  if (last?.outcome !== "awaiting-approval") return { carried: [] };
  const carried = [];
  // Knowledge is adopted only where its reuse plan says reuse (inputs unchanged), as in the normal reuse path.
  let plan = null;
  try {
    const k = await import("./lib/knowledge.mjs");
    plan = k.plan(k.knowledgePaths(ctx.p.productDir), loadJson(ctx.p.configFile), root);
  } catch {}
  const chosen = chosenStages(ctx.run);
  for (const [stage, def] of Object.entries(STAGES)) {
    if (def.outputs.some((o) => o.path.includes("{run}")) || !chosen.has(stage)) continue;
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

export async function validateProduct(product, { root = workspaceRoot } = {}) {
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
    options: { "run-id": { type: "string" }, module: { type: "string" }, error: { type: "string" }, resume: { type: "boolean" }, abandon: { type: "boolean" }, add: { type: "string" }, remove: { type: "string" }, "import-mode": { type: "string" }, reopen: { type: "string" }, file: { type: "string" }, seconds: { type: "string" } },
  });
  const out = (x, code = 0) => {
    console.log(JSON.stringify(x, null, 2));
    process.exit(code);
  };
  if (!cmd || !a) {
    console.error("usage: run.mjs init|guard-check|doctor|login|prereqs|steps|scenarios|status|next|stage|end|validate ... (see header comment)");
    process.exit(2);
  }
  try {
    if (cmd === "init") {
      const r = initRun(a, { resume: v.resume, runId: v["run-id"] });
      const carried = r.errors || r.resumed ? null : await carryForward(r.product);
      out(r.errors ? r : { product: r.product, runId: r.run.runId, mode: r.run.mode, modules: r.run.modules, steps: r.run.steps ?? STEPS, caseTypes: r.run.caseTypes, resumed: !!r.resumed, ...(r.warnings ? { warnings: r.warnings } : {}), ...(r.interrupted ? { interrupted: r.interrupted } : {}), ...(carried?.carried.length ? { carriedFrom: carried.from, carried: carried.carried } : {}), next: ["guard-check", "doctor", "prereqs"].map((c) => expandFw(`node {fw}/scripts/run.mjs ${c} ${r.product}`, frameworkRel())) }, r.errors ? 1 : 0);
    } else if (cmd === "guard-check") {
      // Reaching this line means no hook blocked the command: the guard is not active in this session.
      if (!SLUG_RE.test(a) || !existsSync(paths(a).state)) out({ errors: [`no run state for product '${a}'`] }, 1);
      markAbsent(a, workspaceRoot);
      out({ errors: ["the framework guard did NOT block guard-check: hooks are not active in this session, so nothing enforces the run's mode or permissions. Stop and fix the host's hook setup (docs/platforms.md), then run `node scripts/run.mjs guard-check <product>` again."] }, 1);
    } else if (cmd === "doctor") {
      const r = await doctor(a);
      out(r, r.errors || r.blockedStages.length ? 1 : 0);
    } else if (cmd === "login") {
      const r = await login(a, v.seconds === undefined ? {} : { seconds: Number(v.seconds) });
      out(r, r.errors ? 1 : 0);
    } else if (cmd === "prereqs") {
      const r = await prereqs(a);
      out(r, r.errors || !r.ok ? 1 : 0);
    } else if (cmd === "steps") {
      const list = (x) => (x ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      const r = changeSteps(a, { add: list(v.add), remove: list(v.remove), importMode: list(v["import-mode"]), reopen: list(v.reopen) });
      out(r, r.errors ? 1 : 0);
    } else if (cmd === "scenarios") {
      const r = await scenarios(a, { file: v.file });
      out(r, r.errors || r.problems ? 1 : 0);
    } else if (cmd === "status") out(await status(a));
    else if (cmd === "next") out(await nextStep(a));
    else if (cmd === "stage") {
      const r = await setStage(a, pos[0], v.module, pos[1], v.error);
      out(r, r.errors ? 1 : 0);
    } else if (cmd === "end") {
      const r = await endRun(a, { abandon: v.abandon });
      out(r, r.errors ? 1 : 0);
    } else if (cmd === "diff") {
      const r = diffRuns(a, pos[0], pos[1]);
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
