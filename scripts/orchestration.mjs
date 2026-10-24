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
import { withFileLock, writeAtomic } from "./lib/files.mjs";
import { FLOWS, healableRows, runTriage, unresolvedFindings } from "./lib/domain-flows.mjs";
import { fixCheck, fixSnapshot } from "./lib/fix.mjs";
import { fixContext } from "./fix.mjs";
import { REVIEW_DOMAINS } from "./lib/review.mjs";
import { HANDLERS, KIND_LIMITS, REPO_OWNER, acquireRepoOwner, pendingRequests, releaseRepoOwner, requestsPath, requestsSummary, resolveRequests } from "./lib/requests.mjs";

export const DOMAINS = ["clarifications", "testcases", "playwright-ui", "playwright-api", "k6"];
const LIMIT_KEY = { review: "review_rounds", heal: "heal_rounds" };
const REPO_OWNER_OFFER_TTL_MS = 10 * 60 * 1000; // a handed-out pw-repo-owner step that never started holds the lock this long
const REPO_OWNER_WAITS = 20; // asks a domain makes while another domain's pw-repo-owner step holds the lock, then its request is declined (D-011)
const repoOwnerLock = (product, root) => path.join(paths(product, root).orchestrationDir, "_repo-owner-lock.json");

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
    const at = new Date().toISOString();
    // startedAt survives the step's end, so its duration can be reported (D-079)
    const startedAt = action === "start" ? at : s.steps[name]?.startedAt;
    s.steps[name] = { status: { start: "running", done: "done", fail: "failed", skip: "skipped" }[action], at, ...(startedAt ? { startedAt } : {}), ...(note ? { note } : {}) };
    if (note) s.notes.push(`${name}: ${note}`);
    writeAtomic(c.file, JSON.stringify(s, null, 2) + "\n");
    // the pw-repo-owner lock (product-level) is held for the length of one request step
    if (action !== "start" && s.req?.steps?.[name]?.agent === REPO_OWNER) releaseRepoOwner(repoOwnerLock(product, root), c.run.runId, `${domain}/${module}`);
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
  const patch = (fn) =>
    withFileLock(c.file, () => {
      const s = load(c.file, c.run, domain, module);
      fn(s);
      writeAtomic(c.file, JSON.stringify(s, null, 2) + "\n");
    });
  const reqFile = requestsPath(p.productDir, runId, module, domain);
  // done returns every number the orchestrator reports (G10): the domain's summary, the worker requests that did not end
  // handled, and, for a failed review, what is still open.
  const finish = (outcome, extra = {}) => {
    const s = S();
    const summary = FLOWS[domain]?.done?.(ctx, lastFindings(), s);
    return {
      actions: [],
      done: {
        outcome, ...(s.steps.review ? { review: s.steps.review } : {}), ...(s.steps.run ? { run: s.steps.run } : {}), ...(summary ? { summary } : {}),
        ...(HANDLERS[domain] ? { requests: requestsSummary(reqFile, domain, module) } : {}), ...(s.reviewFailure ? { reviewFailure: s.reviewFailure } : {}), ...extra,
      },
    };
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

  // ---- worker requests (G10): pending requests.json entries become handler steps -----------------------------------
  // One step per handler agent per call (`req-<n>`), each kind spending one of its KIND_LIMITS rounds (kept in state, so a
  // resumed session cannot spend it twice). A pw-repo-owner step holds the product-level lock, so the UI and API
  // domains never ask it at the same time. A build worker that asked is run once more after its requests were handled
  // (`redo-<step>`), like the orchestrator used to by hand. Requests that cannot be handled are declined, never dropped.
  const requestsFlow = () => {
    const handlers = HANDLERS[domain];
    if (!handlers) return null;
    const rq = () => S().req ?? { calls: 0, waits: 0, rounds: {}, steps: {}, redone: {} };
    const settled = (name) => SETTLED.includes(S().steps[name]?.status);
    const running = Object.entries(S().steps).find(([, v]) => v.status === "running");
    if (running) return rq().steps[running[0]] ? { actions: [{ step: running[0], agent: rq().steps[running[0]].agent, prompt: rq().steps[running[0]].prompt }] } : null; // a normal step: the flow re-offers it
    if (Object.entries(S().steps).some(([k, v]) => v.status === "failed" && !rq().steps[k])) return null; // the flow ends the domain
    // finished request steps: record how each request ended
    for (const [name, rec] of Object.entries(rq().steps)) {
      if (rec.applied || !settled(name)) continue;
      const st = S().steps[name];
      if (!rec.redo) resolveRequests(reqFile, domain, module, rec.ids, st.status === "done" ? "handled" : "declined", { step: name, ...(st.status === "done" ? {} : { note: `${rec.agent} did not finish: ${st.note ?? st.status}` }) });
      patch((s) => (s.req.steps[name].applied = true));
      if (rec.redo && st.status === "failed") return failed(name);
    }
    // The lock is taken when the pw-repo-owner step is handed out, not when it starts, so two domains never both get one. A step
    // handed out but never started counts as active for REPO_OWNER_OFFER_TTL_MS (refreshed on every re-offer), then it is stale.
    const holder = `${domain}/${module}`;
    const takeLock = (name) =>
      acquireRepoOwner(repoOwnerLock(product, root), runId, holder, name, {
        isActive: (cur) => {
          const [d, m] = cur.holder.split("/");
          const f = path.join(p.orchestrationDir, `${d}-${m}.json`);
          if (!existsSync(f)) return false;
          const o = loadJson(f);
          const st = o.steps?.[cur.step]?.status;
          if (st) return st === "running";
          return Date.now() - Date.parse(cur.at) < REPO_OWNER_OFFER_TTL_MS;
        },
      });
    const waitFor = (lock) => {
      const waits = rq().waits + 1;
      if (waits > REPO_OWNER_WAITS) return null;
      patch((s) => (s.req = { ...rq(), waits }));
      return { actions: [], waiting: { on: REPO_OWNER, heldBy: lock.heldBy.holder, step: lock.heldBy.step, attempt: waits, of: REPO_OWNER_WAITS, note: "another domain's pw-repo-owner step is running or about to start: ask again once it is done" } };
    };
    // A step handed out but never started is offered again as it was: no new step, no second round spent (D3).
    const offered = Object.entries(rq().steps).find(([n, v]) => !v.applied && !S().steps[n]);
    if (offered) {
      const [name, rec] = offered;
      if (rec.agent === REPO_OWNER) {
        const lock = takeLock(name);
        if (!lock.acquired) {
          const w = waitFor(lock);
          if (w) return w;
          mark(name, "skip", `${REPO_OWNER} stayed busy with ${lock.heldBy.holder} for ${REPO_OWNER_WAITS} asks`);
          patch((s) => (s.req = { ...rq(), waits: 0 }));
          return requestsFlow();
        }
      }
      return { actions: [{ step: name, agent: rec.agent, prompt: rec.prompt }] };
    }
    // requests over their kind's round limit are declined
    for (const r of pendingRequests(reqFile, domain, module)) {
      if ((rq().rounds[r.kind] ?? 0) >= KIND_LIMITS[r.kind]) resolveRequests(reqFile, domain, module, [r.id], "declined", { note: `limit: ${KIND_LIMITS[r.kind]} ${r.kind} round(s) already spent in this run` });
    }
    const todo = pendingRequests(reqFile, domain, module);
    if (todo.length) {
      const agent = handlers[todo[0].kind];
      const group = todo.filter((r) => handlers[r.kind] === agent);
      const n = rq().calls + 1;
      const name = `req-${n}`;
      if (agent === REPO_OWNER) {
        const lock = takeLock(name);
        if (!lock.acquired) {
          const w = waitFor(lock);
          if (w) return w;
          resolveRequests(reqFile, domain, module, group.map((r) => r.id), "declined", { note: `${REPO_OWNER} stayed busy with ${lock.heldBy.holder} for ${REPO_OWNER_WAITS} asks` });
          patch((s) => (s.req = { ...rq(), waits: 0 }));
          return requestsFlow();
        }
      }
      const ids = group.map((r) => r.id);
      const args = { product, module, ...(agent === REPO_OWNER ? { task: "change" } : {}), requests: rel(reqFile), ids: ids.join(",") };
      const redoFor = flow.build.filter((b) => group.some((r) => r.from === b.agent) && S().steps[b.step]?.status === "done" && !rq().redone[b.step]).map((b) => b.step);
      patch((s) => {
        const q = (s.req = { ...rq(), waits: 0 });
        q.calls = n;
        for (const k of new Set(group.map((r) => r.kind))) q.rounds[k] = (q.rounds[k] ?? 0) + 1;
        q.steps[name] = { agent, prompt: prompt(args), ids, kinds: [...new Set(group.map((r) => r.kind))], redoFor };
      });
      return { actions: [{ step: name, agent, prompt: prompt(args) }] };
    }
    // every request is settled: the workers that asked and are not stale run once more
    for (const [name, rec] of Object.entries(rq().steps)) {
      if (rec.redo || S().steps[name]?.status !== "done") continue;
      for (const step of rec.redoFor ?? []) {
        if (rq().redone[step]) continue;
        const b = flow.build.find((x) => x.step === step);
        const rname = `redo-${step}`;
        const rprompt = prompt({ product, module, ...(b.args?.(ctx) ?? {}), requests: rel(reqFile), resolved: rec.ids.join(",") });
        patch((s) => {
          s.req.redone[step] = true;
          s.req.steps[rname] = { agent: b.agent, prompt: rprompt, ids: rec.ids, redo: true };
        });
        return { actions: [{ step: rname, agent: b.agent, prompt: rprompt }] };
      }
    }
    return null;
  };
  const viaRequests = requestsFlow();
  if (viaRequests) return viaRequests;

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
        // what is still open goes into the state, for the stage record (run.mjs) and the report
        const open = lastFindings() ? unresolvedFindings(lastFindings()) : [];
        patch((s) => (s.reviewFailure = { rounds: r.limit, file: lastFindings() ? rel(lastFindings()) : null, total: open.length, findings: open.slice(0, 20) }));
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
  // a review that used up its rounds failed: the stage fails and its dependants are blocked (G10), whatever the domain
  if (S().steps.review?.status === "failed") return finish("review-failed");
  if (!flow.run) return finish("complete");

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
    // a heal fix passes the gate (once more after one gate-driven fix) before the runner starts again (D-011)
    const g1 = `gate-heal-${h}`;
    if (!S().steps[g1]) mark(g1, "done", gate(product, module, domain, { root, compile }).verdict);
    if (S().steps[g1].note !== "pass") {
      const gf = `heal-${h}-gate-fix`;
      const gs = S().steps[gf]?.status;
      if (gs === "failed") return failed(gf);
      if (gs !== "done") {
        snapshotFix(h, "triage");
        return spawn(gf, RN.fixer, { findings: rel(path.join(dir, "gate-findings.md")), triage: rel(triage), round: h });
      }
      const gbad = fixProblem(gf, h, "triage");
      if (gbad) return gbad;
      const g2 = `gate-heal-${h}-2`;
      if (!S().steps[g2]) {
        const v2 = gate(product, module, domain, { root, compile }).verdict;
        mark(g2, v2 === "pass" ? "done" : "fail", v2 === "pass" ? "pass" : `the gate still fails after the heal fix of round ${h} and its gate fix: ${unresolvedFindings(path.join(dir, "gate-findings.md")).length} blocker/major finding(s) in gate-findings.md`);
      }
      if (S().steps[g2].status === "failed") return failed(g2);
    }
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
  // the rows a heal round was asked to fix, so done can report how many were healed
  const keys = (loadJson(triage).rows ?? []).filter((x) => x.healable === true).map((x) => x.key);
  patch((s) => (s.healKeys = [...new Set([...(s.healKeys ?? []), ...keys])]));
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
