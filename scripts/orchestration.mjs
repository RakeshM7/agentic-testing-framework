#!/usr/bin/env node
// Loop and step bookkeeping for domain orchestrators: artifacts/<product>/state/orchestration/<domain>-<module>.json
// Deterministic so a resumed orchestrator knows exactly where it was and loops are bounded by the run-config
// (limits.review_rounds / limits.heal_rounds). State from a previous run is discarded automatically.
//
//   orchestration.mjs next  <product> <domain> <module> [--max N] [--static]
//        -> {actions: [{step, agent, prompt}], done?: {outcome, review?, run?, summary?}}
//        The domain's next agent(s) to start, from the flow in scripts/lib/domain-flows.mjs and what is on disk. It
//        runs the script steps itself (the pre-review gate, the clarification summary), skips steps whose work exists,
//        and spends review/heal rounds. Start every returned action (several only for clarification rows, up to
//        --max), mark each with `step`, then call next again. --static skips the gate's compile commands.
//   orchestration.mjs show  <product> <domain> <module>
//   orchestration.mjs step  <product> <domain> <module> <step> start|done|fail|skip [--note TEXT]
//   orchestration.mjs round <product> <domain> <module> review|heal
//        -> {round, limit, allowed}; exit 1 (allowed: false) once the limit is used up -- stop looping and report
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { gate } from "./gate.mjs";
import { csvPath, isAnswered, readRows, renderSummary } from "./lib/clarifications.mjs";
import { loadJson, paths, repoRoot } from "./lib/contract.mjs";
import { withFileLock, writeAtomic } from "./lib/csv.mjs";
import { FLOWS, healableRows, verdictOf } from "./lib/domain-flows.mjs";

export const DOMAINS = ["clarifications", "testcases", "playwright-ui", "playwright-api", "k6"];
const LIMIT_KEY = { review: "review_rounds", heal: "heal_rounds" };

function context(product, domain, module, root) {
  if (!DOMAINS.includes(domain)) throw new Error(`domain must be one of [${DOMAINS}]`);
  const p = paths(product, root);
  if (!existsSync(p.lockFile)) throw new Error(`no active run for product '${product}'`);
  const run = loadJson(p.runFile);
  if (!run.modules.includes(module)) throw new Error(`module must be one of [${run.modules}]`);
  return { file: path.join(p.orchestrationDir, `${domain}-${module}.json`), run, cfg: loadJson(p.configFile) };
}

function load(file, run, domain, module) {
  const fresh = { runId: run.runId, domain, module, steps: {}, rounds: { review: 0, heal: 0 }, notes: [] };
  if (!existsSync(file)) return fresh;
  const s = loadJson(file);
  return s.runId === run.runId ? s : fresh;
}

export function show(product, domain, module, { root = repoRoot } = {}) {
  const c = context(product, domain, module, root);
  return load(c.file, c.run, domain, module);
}

export function step(product, domain, module, name, action, note, { root = repoRoot } = {}) {
  if (!["start", "done", "fail", "skip"].includes(action)) throw new Error("action must be start|done|fail|skip");
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name ?? "")) throw new Error("step name must be kebab-case");
  const c = context(product, domain, module, root);
  return withFileLock(c.file, () => {
    const s = load(c.file, c.run, domain, module);
    s.steps[name] = { status: { start: "running", done: "done", fail: "failed", skip: "skipped" }[action], at: new Date().toISOString(), ...(note ? { note } : {}) };
    if (note) s.notes.push(`${name}: ${note}`);
    writeAtomic(c.file, JSON.stringify(s, null, 2) + "\n");
    return s;
  });
}

export function round(product, domain, module, kind, { root = repoRoot } = {}) {
  if (!LIMIT_KEY[kind]) throw new Error("kind must be review|heal");
  const c = context(product, domain, module, root);
  const limit = c.cfg.limits?.[LIMIT_KEY[kind]] ?? 3;
  return withFileLock(c.file, () => {
    const s = load(c.file, c.run, domain, module);
    if (s.rounds[kind] >= limit) return { round: s.rounds[kind], limit, allowed: false };
    s.rounds[kind] += 1;
    writeAtomic(c.file, JSON.stringify(s, null, 2) + "\n");
    return { round: s.rounds[kind], limit, allowed: true };
  });
}

const SETTLED = ["done", "failed", "skipped"];
const prompt = (args) => Object.entries(args).map(([k, v]) => `${k}=${v}`).join(" ");

export function next(product, domain, module, { root = repoRoot, max = 1, compile = true } = {}) {
  const c = context(product, domain, module, root);
  const p = paths(product, root);
  const { runId, mode } = c.run;
  const ctx = { productDir: p.productDir, module, pwProject: p.pwProject, k6Project: p.k6Project, format: c.cfg.testcases?.output_format ?? "gherkin" };
  const S = () => load(c.file, c.run, domain, module);
  const mark = (name, action, note) => step(product, domain, module, name, action, note, { root });
  const rel = (f) => path.relative(root, f).replaceAll("\\", "/");
  const spawn = (name, agent, args = {}) => ({ actions: [{ step: name, agent, prompt: prompt({ product, module, ...args }) }] });
  const finish = (outcome, extra = {}) => {
    const s = S();
    return { actions: [], done: { outcome, ...(s.steps.review ? { review: s.steps.review } : {}), ...(s.steps.run ? { run: s.steps.run } : {}), ...extra } };
  };
  const failed = (name) => finish("failed", { failedStep: name, note: S().steps[name]?.note ?? "" });

  // ---- clarifications: one explorer per open row, then the summary -------------------------------------------
  if (domain === "clarifications") {
    const file = csvPath(p.productDir, module);
    const s = S();
    const todo = readRows(file).filter((r) => !isAnswered(r)).map((r) => r.id.trim()).filter((id) => !SETTLED.includes(s.steps[`explore-${id}`]?.status));
    if (todo.length) return { actions: todo.slice(0, max).map((id) => ({ step: `explore-${id}`, agent: "clarification-explorer", prompt: prompt({ product, module, id, mode }) })) };
    const summary = renderSummary(file, module);
    mark("summary", "done", `${summary.answered}/${summary.total} answered`);
    return finish("complete", { summary: { ...summary, file: rel(summary.file) } });
  }

  const flow = FLOWS[domain];
  // ---- build ---------------------------------------------------------------------------------------------------
  for (const [i, b] of flow.build.entries()) {
    const status = S().steps[b.step]?.status;
    if (status === "done" || status === "skipped") continue;
    if (status === "failed") return failed(b.step);
    if (status !== "running") {
      const rest = b.skipRest?.(ctx);
      if (rest) {
        for (const later of flow.build.slice(i)) mark(later.step, "skip", rest);
        mark("review", "skip", rest);
        break;
      }
      const why = b.skip?.(ctx);
      if (why) {
        mark(b.step, "skip", why);
        continue;
      }
    }
    return spawn(b.step, b.agent, b.args?.(ctx) ?? {});
  }

  // ---- review loop: gate -> reviewer -> writer/fixer, bounded by limits.review_rounds ------------------------------
  const R = flow.review;
  const dir = path.join(p.results(runId), module, domain);
  while (!SETTLED.includes(S().steps.review?.status)) {
    let n = S().rounds.review;
    if (n === 0 || S().steps[`fix-${n}`]?.status === "done") {
      const r = round(product, domain, module, "review", { root });
      if (!r.allowed) {
        mark("review", "fail", `${r.limit} review rounds used and findings remain`);
        break;
      }
      n = r.round;
    }
    if (!S().steps[`gate-${n}`]) mark(`gate-${n}`, "done", gate(product, module, domain, { root, compile }).verdict);
    let findings = path.join(dir, "gate-findings.md");
    if (S().steps[`gate-${n}`].note === "pass") {
      const rv = S().steps[`review-${n}`]?.status;
      if (rv === "failed") return failed(`review-${n}`);
      if (rv !== "done") return spawn(`review-${n}`, R.reviewer, { run: runId, round: n, ...(R.reviewerArgs?.(ctx) ?? {}) });
      findings = path.join(dir, "review-findings.md");
      const v = verdictOf(findings);
      if (v === "pass") {
        mark("review", "done", `passed in round ${n}`);
        break;
      }
      if (!v) return finish("failed", { failedStep: `review-${n}`, note: `${rel(findings)} has no Verdict line` });
    }
    const fx = S().steps[`fix-${n}`]?.status;
    if (fx === "failed") return failed(`fix-${n}`);
    return spawn(`fix-${n}`, R.fixer, { findings: rel(findings), ...(R.fixerArgs?.(ctx) ?? {}) });
  }
  if (!flow.run) return finish(S().steps.review.status === "done" ? "complete" : "review-failed");

  // ---- run loop: runner-triager -> fixer on healable rows, bounded by limits.heal_rounds ---------------------------
  const RN = flow.run;
  const triage = path.join(p.results(runId), module, RN.framework, "triage.md");
  if (SETTLED.includes(S().steps.run?.status)) return finish(S().steps.run.status === "done" ? "complete" : "heal-limit");
  const h = S().rounds.heal;
  if (h > 0) {
    const hs = S().steps[`heal-${h}`]?.status;
    if (hs === "failed") return failed(`heal-${h}`);
    if (hs !== "done") return spawn(`heal-${h}`, RN.fixer, { triage: rel(triage) });
  }
  const k = h + 1;
  const rs = S().steps[`run-${k}`]?.status;
  if (rs === "failed") return failed(`run-${k}`);
  if (rs !== "done") return spawn(`run-${k}`, RN.runner, { run: runId, mode, round: k });
  const healable = healableRows(triage);
  if (!healable) {
    mark("run", "done", `nothing healable after run ${k}`);
    return finish("complete");
  }
  const r = round(product, domain, module, "heal", { root });
  if (!r.allowed) {
    mark("run", "fail", `${healable} healable failure(s) left after ${r.limit} heal rounds`);
    return finish("heal-limit");
  }
  return spawn(`heal-${r.round}`, RN.fixer, { triage: rel(triage) });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, product, domain, module, ...rest] = process.argv.slice(2);
  const { values: v, positionals: pos } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: { note: { type: "string" }, max: { type: "string" }, static: { type: "boolean" } },
  });
  const out = (x, code = 0) => {
    console.log(JSON.stringify(x, null, 2));
    process.exit(code);
  };
  try {
    if (cmd === "next") out(next(product, domain, module, { max: Number(v.max ?? 1) || 1, compile: !v.static }));
    else if (cmd === "show") out(show(product, domain, module));
    else if (cmd === "step") out(step(product, domain, module, pos[0], pos[1], v.note));
    else if (cmd === "round") {
      const r = round(product, domain, module, pos[0]);
      out(r, r.allowed ? 0 : 1);
    } else out({ errors: ["usage: orchestration.mjs next|show|step|round <product> <domain> <module> ..."] }, 2);
  } catch (e) {
    out({ errors: [e.message] }, 1);
  }
}
