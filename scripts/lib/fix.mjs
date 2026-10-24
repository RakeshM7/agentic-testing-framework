// The fixers' accountability (G9): a fixer round must answer EVERY blocker/major finding of the review round (or gate)
// and every healable triage row with an entry in fix-report.json -- `fixed` with the files it changed, or `not-fixed`
// with one of four reasons and a text -- and what it claims is checked against the disk. The orchestration runs
// `snapshot` before it spawns the fixer (sha256 of the domain's owned code files, fix-snapshot.json); `check` compares
// the files now with that snapshot: a `fixed` entry must list files that really changed this round, and a changed file
// that scripts own (a managed file, a generated plan) is a finding whoever wrote it. Never runs anything against the product.
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { readJson, writeAtomic } from "./files.mjs";
import { unresolvedFindings } from "./domain-flows.mjs";
import { apiCodePaths } from "./api-code.mjs";
import { isManaged } from "./permissions.mjs";
import { BLOCKING, DIMENSIONS, enumerateTests, reviewPaths } from "./review.mjs";
import { triagePaths } from "./triage.mjs";
import { sha256 } from "./verified.mjs";

export const FIX_SOURCES = ["review", "triage"];
export const NOT_FIXED_REASONS = ["disagree-with-cited-reason", "needs-product-change", "needs-human", "out-of-scope"];
const TRIAGE_DOMAIN = { "playwright-ui": "ui", "playwright-api": "api", k6: "k6" };

const posix = (p) => p.replaceAll("\\", "/");
const dimFindings = (v) => (v === "ok" || v == null ? [] : Array.isArray(v) ? v : [v]);

// results/<run>/<m>/<domain>/: fix-report.json (the fixer's) and fix-snapshot.json (the script's, written before the fixer).
export function fixPaths(productDir, runId, module, domain) {
  const dir = path.join(productDir, "results", runId ?? "-", module, domain);
  return { dir, report: path.join(dir, "fix-report.json"), snapshot: path.join(dir, "fix-snapshot.json") };
}

// The domain's owned code files and the overlays a fixer may write: Map abs -> "plan" (generated, script-owned) | "code".
function ownedFiles(ctx, domain) {
  const en = enumerateTests(ctx, domain);
  const out = new Map();
  for (const [name, f] of Object.entries(en.files)) out.set(path.resolve(f), name === "plan" ? "plan" : "code");
  if (domain === "playwright-api") {
    const ap = apiCodePaths(ctx.productDir, ctx.module);
    for (const f of [ap.clientOverlay, ap.testsOverlay]) out.set(path.resolve(f), "code");
  }
  addExtraFiles(ctx, domain, out);
  return out;
}

// Agent-writable folders beyond the enumerated files (permissions.yaml, the fixers' owned folders): hand-written helpers
// and the k6 lib extensions. Managed files inside them stay caught by the managed-file check.
const EXTRA_DIRS = { "playwright-ui": ["pwProject:helpers/ui"], "playwright-api": ["pwProject:helpers/api"], k6: ["k6Project:lib/ext"] };
function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const n of readdirSync(dir).sort()) {
    const f = path.join(dir, n);
    if (statSync(f).isDirectory()) walk(f, out);
    else out.push(f);
  }
  return out;
}
function addExtraFiles(ctx, domain, out) {
  for (const spec of EXTRA_DIRS[domain] ?? []) {
    const [key, sub] = spec.split(":");
    if (ctx[key]) for (const f of walk(path.join(ctx[key], sub))) if (!out.has(path.resolve(f))) out.set(path.resolve(f), "code");
  }
}

const relOf = (ctx, abs) => posix(path.relative(ctx.root, abs));

// The ids this round must answer. source review: the blocker/major findings of the gate (when the round's gate failed) or
// of review.json (when it passed); source triage: the healable rows of triage.json.
export function requiredEntries(ctx, domain, round, source) {
  if (source === "triage") {
    const tp = triagePaths(ctx.productDir, ctx.module, ctx.runId, TRIAGE_DOMAIN[domain]);
    const t = readJson(tp.triage, null);
    if (!t) return { ids: [], problems: ["triage.json is missing: there is nothing to heal"] };
    return { ids: (t.rows ?? []).filter((r) => r.healable === true).map((r) => r.key), problems: [] };
  }
  const state = readJson(path.join(ctx.stateDir, "orchestration", `${domain}-${ctx.module}.json`), null);
  const rp = reviewPaths(ctx.productDir, ctx.runId, ctx.module, domain);
  const gate = state?.steps?.[`gate-${round}`];
  if (gate && gate.note !== "pass") return { ids: unresolvedFindings(path.join(rp.dir, "gate-findings.md")).map((f) => `gate#${f.n}`), problems: [] };
  const review = readJson(rp.review, null);
  if (!review || review.round !== Number(round)) return { ids: [], problems: [`review.json for round ${round} is missing: nothing to fix from review`] };
  const ids = [];
  for (const [id, t] of Object.entries(review.tests ?? {}))
    for (const d of DIMENSIONS) {
      const fs = dimFindings(t[d]);
      fs.forEach((f, i) => BLOCKING.includes(f.severity) && ids.push(`${id}/${d}${fs.length > 1 ? `#${i + 1}` : ""}`));
    }
  (review.general ?? []).forEach((f, i) => BLOCKING.includes(f.severity) && ids.push(`general#${i + 1}`));
  return { ids, problems: [] };
}

// Written by the orchestration just before it spawns the fixer; kept when a snapshot of this source and round exists
// (a resumed fixer does not get a fresh baseline for work it already did). `cli: true` (the fix.mjs command, which a
// fixer's shell can reach) never overwrites a snapshot and never creates one once the orchestration has spawned a fixer
// step of this source: a fixer cannot re-baseline its own edits (D-059). The orchestration calls this without `cli`.
export function fixSnapshot(ctx, domain, { round, source, cli = false }) {
  const fp = fixPaths(ctx.productDir, ctx.runId, ctx.module, domain);
  const old = readJson(fp.snapshot, null);
  if (cli) {
    const prefix = source === "triage" ? "heal-" : "fix-";
    const state = readJson(path.join(ctx.stateDir, "orchestration", `${domain}-${ctx.module}.json`), null);
    const started = Object.keys(state?.steps ?? {}).some((k) => k.startsWith(prefix));
    if (old || started)
      return { refused: true, problems: [`fix-snapshot.json is taken by orchestration.mjs before the fixer runs; ${old ? "it already exists" : "a fixer step has already started"} and fix.mjs snapshot will not re-baseline it`] };
  }
  if (old && old.round === Number(round) && old.source === source) return { file: fp.snapshot, kept: true, files: Object.keys(old.files).length };
  const owned = ownedFiles(ctx, domain);
  const files = {};
  const kinds = {};
  for (const [abs, kind] of [...owned].sort(([a], [b]) => a.localeCompare(b))) {
    files[relOf(ctx, abs)] = sha256(abs);
    kinds[relOf(ctx, abs)] = kind;
  }
  writeAtomic(fp.snapshot, JSON.stringify({ module: ctx.module, domain, round: Number(round), source, files, kinds }, null, 2) + "\n");
  return { file: fp.snapshot, kept: false, files: Object.keys(files).length };
}

// -> {complete, problems, file, fixed, notFixed, changed}. fix-report.json is schema-checked by the CLI first.
// ctx.permissions: the run's resolved permissions (state/permissions.resolved.json) for the managed-file check.
export function fixCheck(ctx, domain, { round, source = "review" } = {}) {
  const fp = fixPaths(ctx.productDir, ctx.runId, ctx.module, domain);
  const problems = [];
  const done = (extra = {}) => ({ complete: problems.length === 0, problems, file: fp.report, ...extra });
  if (!FIX_SOURCES.includes(source)) {
    problems.push(`source must be one of [${FIX_SOURCES.join(", ")}]`);
    return done();
  }
  const snap = readJson(fp.snapshot, null);
  if (!snap || snap.round !== Number(round) || snap.source !== source) {
    problems.push(`fix-snapshot.json for ${source} round ${round} is missing: orchestration.mjs takes it before the fixer runs; without it nothing is verified`);
    return done();
  }
  let report;
  try {
    report = readJson(fp.report, null);
  } catch (e) {
    problems.push(`fix-report.json is not valid JSON: ${e.message}`);
    return done();
  }
  if (!report) {
    problems.push("fix-report.json is missing: answer every finding (or healable row) with fixed {files} or not-fixed {reason, text}");
    return done();
  }
  if (report.module !== ctx.module) problems.push(`fix-report.json: module is '${report.module}', not '${ctx.module}'`);
  if (report.round !== Number(round)) problems.push(`fix-report.json is for round ${report.round}, not round ${round}`);
  if (report.source !== source) problems.push(`fix-report.json is for source '${report.source}', not '${source}'`);

  const what = source === "triage" ? "healable row" : "blocker/major finding";
  const req = requiredEntries(ctx, domain, round, source);
  problems.push(...req.problems);
  const required = new Set(req.ids);

  // what changed since the snapshot (abs -> kind), among the files the snapshot tracked
  const owned = ownedFiles(ctx, domain);
  const changed = new Map();
  for (const [abs, kind] of owned) {
    const key = relOf(ctx, abs);
    if (key in snap.files && sha256(abs) !== snap.files[key]) changed.set(abs, kind);
  }
  const bases = [ctx.root, ctx.pwProject, ctx.k6Project].filter(Boolean);
  const resolveListed = (f) => bases.map((b) => path.resolve(b, f)).find((a) => owned.has(a));

  const seen = new Set();
  let fixed = 0;
  let notFixed = 0;
  for (const e of Array.isArray(report.entries) ? report.entries : []) {
    if (seen.has(e.id)) problems.push(`${e.id}: answered twice`);
    seen.add(e.id);
    if (!required.has(e.id)) {
      problems.push(`${e.id}: not a ${what} of this round`);
      continue;
    }
    if (e.status === "fixed") {
      fixed++;
      if (!Array.isArray(e.files) || !e.files.length) problems.push(`${e.id}: fixed must list the files it changed`);
      for (const f of e.files ?? []) {
        const abs = resolveListed(f);
        if (!abs) problems.push(`${e.id}: '${f}' is not one of this domain's code files`);
        else if (!changed.has(abs)) problems.push(`${e.id}: '${f}' did not change this round`);
      }
    } else if (e.status === "not-fixed") {
      notFixed++;
      if (!NOT_FIXED_REASONS.includes(e.reason)) problems.push(`${e.id}: not-fixed needs a reason in [${NOT_FIXED_REASONS.join(", ")}]`);
      if (!String(e.text ?? "").trim()) problems.push(`${e.id}: not-fixed needs a text saying why`);
    } else problems.push(`${e.id}: status must be fixed or not-fixed`);
  }
  for (const id of required) if (!seen.has(id)) problems.push(`${id}: no entry in fix-report.json (every ${what} needs one)`);

  // narrow write: a script-owned file that changed (a generated plan, a managed file) is a finding, listed or not
  const values = { product: ctx.product, run_id: ctx.runId, state: path.relative(ctx.root, ctx.stateDir).replaceAll("\\", "/") };
  for (const [abs, kind] of changed) {
    const rel = relOf(ctx, abs);
    if (kind === "plan") problems.push(`${rel}: a generated plan changed; scripts own it`);
    else if (ctx.permissions && !rel.startsWith("..") && isManaged(ctx.permissions, rel, values))
      problems.push(`${rel}: a managed file changed; only its script writes it (a fixer edits slots, overlays and hand-written helpers)`);
  }
  return done({ fixed, notFixed, changed: [...changed.keys()].map((a) => relOf(ctx, a)) });
}
