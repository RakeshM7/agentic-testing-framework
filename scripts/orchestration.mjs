#!/usr/bin/env node
// Loop and step bookkeeping for domain orchestrators: artifacts/<product>/state/orchestration/<domain>-<module>.json
// Deterministic so a resumed orchestrator knows exactly where it was and loops are bounded by the run-config
// (limits.review_rounds / limits.heal_rounds). State from a previous run is discarded automatically.
//
//   orchestration.mjs next  <product> <domain> <module> [--max N] [--static]
//        -> {actions: [{step, agent, prompt}], done?: {outcome, review?, run?, summary?}}
//        The domain's next agent(s) to start, from the flow in scripts/lib/domain-flows.mjs and what is on disk. It
//        runs the script steps itself (the pre-review gate, the clarification summary), skips steps whose work is
//        verified (a foundation whose foundation.mjs check stamp is current, D-054), and spends review/heal rounds; a
//        done step with a verify rule (the API plan, a foundation, the UI code's pages and tests steps, the API code's clients and tests steps -- those once,
//        when first seen done) fails when its output did not pass its check. Start every returned action, mark each with `step`, then call next again. --static skips the
//        gate's compile commands. Clarifications: one row at a time from the rows open when the domain started; a
//        finished explorer must have left a valid record.json of this run, else the row is retried once and then
//        recorded blocked (no-valid-record); done adds `deferred` (rows added during the run) and `failedRows`.
//   orchestration.mjs show  <product> <domain> <module>
//   orchestration.mjs step  <product> <domain> <module> <step> start|done|fail|skip [--note TEXT]
//   orchestration.mjs round <product> <domain> <module> review|heal
//        -> {round, limit, allowed}; exit 1 (allowed: false) once the limit is used up -- stop looping and report
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { gate } from "./gate.mjs";
import { csvPath, isAnswered, isAuthoritative, readRecord, readRows, record, renderSummary } from "./lib/clarifications.mjs";
import { loadJson, paths, repoRoot } from "./lib/contract.mjs";
import { withFileLock, writeAtomic } from "./lib/csv.mjs";
import { FLOWS, healableRows, runTriage } from "./lib/domain-flows.mjs";
import { fixCheck, fixSnapshot } from "./lib/fix.mjs";
import { fixContext } from "./fix.mjs";
import { REVIEW_DOMAINS } from "./lib/review.mjs";

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
const CLARIFICATION_ATTEMPTS = 2; // per row: the first try and one retry, then the script records it blocked (D-011)
const prompt = (args) => Object.entries(args).map(([k, v]) => `${k}=${v}`).join(" ");

export function next(product, domain, module, { root = repoRoot, max = 1, compile = true } = {}) {
  const c = context(product, domain, module, root);
  const p = paths(product, root);
  const { runId, mode } = c.run;
  const ctx = { root, product, run: c.run, cfg: c.cfg, productDir: p.productDir, module, pwProject: p.pwProject, k6Project: p.k6Project, format: c.cfg.testcases?.output_format ?? "gherkin" };
  const S = () => load(c.file, c.run, domain, module);
  const mark = (name, action, note) => step(product, domain, module, name, action, note, { root });
  const rel = (f) => path.relative(root, f).replaceAll("\\", "/");
  const spawn = (name, agent, args = {}) => ({ actions: [{ step: name, agent, prompt: prompt({ product, module, ...args }) }] });
  const dir = path.join(p.results(runId), module, domain);
  // The findings file of the last review round (gate or review) when the review did not pass, for the done summary.
  const lastFindings = () => {
    const s = S();
    const n = s.rounds.review;
    if (!n || s.steps.review?.status === "done") return null;
    return path.join(dir, s.steps[`gate-${n}`]?.note === "pass" ? "review-findings.md" : "gate-findings.md");
  };
  const finish = (outcome, extra = {}) => {
    const s = S();
    const summary = FLOWS[domain]?.done?.(ctx, lastFindings());
    return { actions: [], done: { outcome, ...(s.steps.review ? { review: s.steps.review } : {}), ...(s.steps.run ? { run: s.steps.run } : {}), ...(summary ? { summary } : {}), ...extra } };
  };
  const failed = (name) => finish("failed", { failedStep: name, note: S().steps[name]?.note ?? "" });

  // The code domains' fixers answer for every finding (G9): before a fixer is spawned the files it may change are
  // snapshotted; once its step is done, fix.mjs check must pass (fix-report.json answers every blocker/major finding or
  // healable row, `fixed` lists files that changed, nothing script-owned changed) or the step fails. Checked once.
  const codeFix = REVIEW_DOMAINS.includes(domain);
  const snapshotFix = (round, source) => codeFix && fixSnapshot(fixContext(product, module, root), domain, { round, source });
  const fixProblem = (stepName, round, source) => {
    const st = S().steps[stepName];
    if (!codeFix || st?.status !== "done" || st.verified) return null;
    const r = fixCheck(fixContext(product, module, root), domain, { round, source });
    if (r.complete) {
      withFileLock(c.file, () => {
        const s = load(c.file, c.run, domain, module);
        s.steps[stepName].verified = true;
        writeAtomic(c.file, JSON.stringify(s, null, 2) + "\n");
      });
      return null;
    }
    mark(stepName, "fail", `fix.mjs check failed: ${r.problems.slice(0, 5).join("; ")}`);
    return failed(stepName);
  };

  // ---- clarifications: one explorer per open row, each checked, then the summary (D-048) -----------------------
  if (domain === "clarifications") {
    const file = csvPath(p.productDir, module);
    const patch = (fn) =>
      withFileLock(c.file, () => {
        const s = load(c.file, c.run, domain, module);
        fn(s);
        writeAtomic(c.file, JSON.stringify(s, null, 2) + "\n");
      });
    const rowsById = () => new Map(readRows(file).map((r) => [r.id.trim(), r]));
    // The rows open when the domain started. Rows added later (an explorer's follow-up questions) wait for the next run.
    if (!S().rows) patch((s) => Object.assign(s, { rows: readRows(file).filter((r) => !isAnswered(r)).map((r) => r.id.trim()), attempts: {} }));

    // A finished explorer must have left a valid record of this run (or someone answered the row meanwhile).
    const postcheck = (id) => {
      const row = rowsById().get(id);
      if (!row || isAuthoritative(row)) return null;
      const rec = readRecord(file, id);
      if (!rec) return `no clarification-evidence/${id}/record.json: the outcome was never recorded with clarifications.mjs record --file`;
      if (rec.runId !== runId) return `record.json is from run ${rec.runId}, not this run`;
      if (rec.verdict === "confirmed" ? !isAnswered(row) : !row.notes.trim()) return `record.json says ${rec.verdict}, but the CSV row does not show it`;
      return null;
    };
    for (const id of S().rows) {
      const name = `explore-${id}`;
      const st = S().steps[name];
      if (!st || st.verified || !["done", "failed"].includes(st.status)) continue;
      const problem = st.status === "failed" ? `the explorer failed: ${st.note ?? "no reason given"}` : postcheck(id);
      if (!problem) {
        patch((s) => (s.steps[name].verified = true));
        continue;
      }
      const attempt = S().attempts[id] ?? 1;
      if (attempt < CLARIFICATION_ATTEMPTS) {
        patch((s) => {
          delete s.steps[name];
          s.attempts[id] = attempt + 1;
          s.notes.push(`${name}: attempt ${attempt}: ${problem}; retrying`);
        });
        continue;
      }
      patch((s) => {
        s.steps[name] = { ...s.steps[name], status: "failed", verified: true, note: problem };
        s.notes.push(`${name}: ${problem}; no attempts left`);
      });
      const row = rowsById().get(id);
      if (row && !isAnswered(row))
        record(file, id, { notes: `[${runId}] blocked (no-valid-record): ${problem} (after ${CLARIFICATION_ATTEMPTS} attempts).\nNext step: re-run the clarifications stage, or answer it directly.`, runId });
    }

    // One row at a time, whatever --max says: each row closes the one shared browser server's session (D-047).
    const rows = rowsById();
    const todo = S().rows.filter((id) => rows.has(id) && !isAnswered(rows.get(id)) && !SETTLED.includes(S().steps[`explore-${id}`]?.status));
    if (todo.length) {
      const [id] = todo;
      const attempt = S().attempts[id] ?? 1;
      return { actions: [{ step: `explore-${id}`, agent: "clarification-explorer", prompt: prompt({ product, module, id, mode, ...(attempt > 1 ? { attempt } : {}) }) }] };
    }
    const summary = renderSummary(file, module);
    mark("summary", "done", `${summary.answered}/${summary.total} answered, ${summary.proposed.length} awaiting approval`);
    const snapshot = new Set(S().rows);
    const deferred = [...rows.values()].filter((r) => !isAnswered(r) && !snapshot.has(r.id.trim())).map((r) => r.id.trim());
    const failedRows = S().rows.filter((id) => S().steps[`explore-${id}`]?.status === "failed");
    return finish("complete", { summary: { ...summary, file: rel(summary.file) }, deferred, failedRows });
  }

  const flow = FLOWS[domain];
  // ---- build ---------------------------------------------------------------------------------------------------
  for (const [i, b] of flow.build.entries()) {
    const status = S().steps[b.step]?.status;
    if (status === "done") {
      // verifyOnce (the UI code, D-055; the API code, D-056): checked when the done step is first seen; later rounds' fixes are the gate's
      if (b.verifyOnce && S().steps[b.step].verified) continue;
      const unverified = b.verify?.(ctx);
      if (unverified) {
        mark(b.step, "fail", unverified);
        return failed(b.step);
      }
      if (b.verifyOnce)
        withFileLock(c.file, () => {
          const s = load(c.file, c.run, domain, module);
          s.steps[b.step].verified = true;
          writeAtomic(c.file, JSON.stringify(s, null, 2) + "\n");
        });
      continue;
    }
    if (status === "skipped") continue;
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
  while (!SETTLED.includes(S().steps.review?.status)) {
    let n = S().rounds.review;
    if (n > 0) {
      const bad = fixProblem(`fix-${n}`, n, "review");
      if (bad) return bad;
    }
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
      // The verdict is derived for every domain (D-053, G9): every test (case) needs a verdict in this round, from a
      // fresh stamped review.json; a typed `Verdict:` line is never read.
      const derived = R.verdict(ctx, n);
      if (!derived.complete) {
        mark(`review-${n}`, "fail", `review.json is incomplete: ${derived.problems.slice(0, 5).join("; ")}`);
        return failed(`review-${n}`);
      }
      const v = derived.verdict;
      if (v === "pass") {
        mark("review", "done", `passed in round ${n}`);
        break;
      }
    }
    const fx = S().steps[`fix-${n}`]?.status;
    if (fx === "failed") return failed(`fix-${n}`);
    snapshotFix(n, "review");
    return spawn(`fix-${n}`, R.fixer, { findings: rel(findings), round: n, ...(R.fixerArgs?.(ctx) ?? {}) });
  }
  if (!flow.run) return finish(S().steps.review.status === "done" ? "complete" : "review-failed");

  // ---- run loop: runner-triager -> fixer on healable rows, bounded by limits.heal_rounds ---------------------------
  const RN = flow.run;
  const triage = runTriage(ctx, RN).file; // triage.json (D-058)
  if (SETTLED.includes(S().steps.run?.status)) return finish(S().steps.run.status === "done" ? "complete" : "heal-limit");
  const h = S().rounds.heal;
  if (h > 0) {
    const hs = S().steps[`heal-${h}`]?.status;
    if (hs === "failed") return failed(`heal-${h}`);
    if (hs !== "done") {
      snapshotFix(h, "triage");
      return spawn(`heal-${h}`, RN.fixer, { triage: rel(triage), round: h });
    }
    const bad = fixProblem(`heal-${h}`, h, "triage");
    if (bad) return bad;
  }
  const k = h + 1;
  const rs = S().steps[`run-${k}`]?.status;
  if (rs === "failed") return failed(`run-${k}`);
  if (rs !== "done") return spawn(`run-${k}`, RN.runner, { run: runId, mode, round: k });
  // the end, or a heal round, rests on a triage that passed triage.mjs check against these results (D-058)
  const unverified = runTriage(ctx, RN).unverified;
  if (unverified) {
    mark(`run-${k}`, "fail", unverified);
    return failed(`run-${k}`);
  }
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
  snapshotFix(r.round, "triage");
  return spawn(`heal-${r.round}`, RN.fixer, { triage: rel(triage), round: r.round });
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
