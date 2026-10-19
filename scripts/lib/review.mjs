// The per-test review of the code domains (G9, docs/conventions.md "Script-built agents", the generalization of the
// G3 per-case review in lib/testcases.mjs `reviewResult`). A reviewer writes results/<run>/<m>/<domain>/review.json
// (schema `review`): for EVERY test of the module (a UI test case id, an API scenario id, a k6 script id) a verdict on
// each rubric dimension (intent, assertion, flakiness, data-safety): `ok`, or finding(s) {severity, location
// "file:line", reason, fixHint?}. `check` refuses a test not reviewed in this round, an unknown id, a finding whose
// location is not a real file and line, and a review older than the code it judged; it derives the overall verdict
// (pass exactly when no blocker or major remains), renders review-findings.md and stamps review-check.json with the
// sha256 of the reviewed code. Nobody types a verdict: `reviewVerdict` (what orchestration.mjs reads) trusts only a
// stamp that is still fresh. Never runs anything against the product.
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { writeAtomic } from "./csv.mjs";
import { sha256, stampVerified, unverifiedReason } from "./verified.mjs";

export const REVIEW_DOMAINS = ["playwright-ui", "playwright-api", "k6"];
export const DIMENSIONS = ["intent", "assertion", "flakiness", "data-safety"];
export const SEVERITIES = ["blocker", "major", "minor", "info"];
export const BLOCKING = ["blocker", "major"];

const readJson = (f, fallback) => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : fallback);
const one = (s) => String(s ?? "").replace(/\s*\r?\n\s*/g, " ").trim();
const cell = (s) => one(s).replace(/\|/g, "\\|");
const uniq = (a) => [...new Set(a)];

// results/<run>/<m>/<domain>/: review.json (the reviewer's), review-findings.md and review-check.json (the script's).
export function reviewPaths(productDir, runId, module, domain) {
  const dir = path.join(productDir, "results", runId ?? "-", module, domain);
  return { dir, review: path.join(dir, "review.json"), findings: path.join(dir, "review-findings.md"), state: path.join(dir, "review-check.json") };
}

// What a domain's reviewer must cover and what it judged: {ids, root, files: {name: abs}, problems}. The ids come from
// the domain's own generated plan: UI ui-code/plan.json tests (the approved cases within budget, G5), API
// api-code/plan.json tests (one per plan scenario, G6), k6 k6/code-plan.json scripts (one per workload scenario, G7).
export function enumerateTests(ctx, domain) {
  const md = path.join(ctx.productDir, "modules", ctx.module);
  const pw = (f) => path.join(ctx.pwProject, f);
  const k6 = (f) => path.join(ctx.k6Project, f);
  if (domain === "playwright-ui") {
    const plan = readJson(path.join(md, "ui-code", "plan.json"), null);
    if (!plan) return { ids: [], root: ctx.pwProject, files: {}, problems: ["ui-code/plan.json is missing: the UI tests were never built"] };
    const f = plan.files ?? {};
    const files = { plan: path.join(md, "ui-code", "plan.json") };
    for (const k of ["spec", "data", "registration", "smoke", "index"]) if (f[k]) files[k] = pw(f[k]);
    for (const o of plan.objects ?? []) files[`po:${o.file}`] = pw(o.file);
    return { ids: uniq((plan.tests ?? []).map((t) => t.id)), root: ctx.pwProject, files, problems: [] };
  }
  if (domain === "playwright-api") {
    const plan = readJson(path.join(md, "api-code", "plan.json"), null);
    if (!plan) return { ids: [], root: ctx.pwProject, files: {}, problems: ["api-code/plan.json is missing: the API tests were never built"] };
    const f = plan.files ?? {};
    const files = { plan: path.join(md, "api-code", "plan.json") };
    for (const k of ["payloads", "glue", "composite", "registration", "types", "support", "sender", "facade", "index"]) if (f[k]) files[k] = pw(f[k]);
    for (const s of f.specs ?? []) files[`spec:${s}`] = pw(s);
    for (const c of plan.clients ?? []) files[`client:${c.file}`] = pw(c.file);
    return { ids: uniq((plan.tests ?? []).map((t) => t.id)), root: ctx.pwProject, files, problems: [] };
  }
  if (domain === "k6") {
    const planFile = path.join(md, "k6", "code-plan.json");
    const plan = readJson(planFile, null);
    if (!plan) return { ids: [], root: ctx.k6Project, files: {}, problems: ["k6/code-plan.json is missing: the k6 scripts were never built"] };
    const files = { plan: planFile };
    if (plan.files?.slots) files.slots = k6(plan.files.slots);
    for (const s of plan.scripts ?? []) files[`script:${s.file}`] = k6(s.file);
    return { ids: uniq((plan.scripts ?? []).map((s) => s.id)), root: ctx.k6Project, files, problems: [] };
  }
  throw new Error(`domain must be one of [${REVIEW_DOMAINS.join(", ")}]`);
}

const dimFindings = (v) => (v === "ok" || v == null ? [] : Array.isArray(v) ? v : [v]);

// A finding's location must name a real file (under the reviewed repo, else the framework repo) and a line within it.
function locationProblem(location, roots) {
  const m = /^(.+):([1-9][0-9]*)$/.exec(String(location ?? ""));
  if (!m || /\s|\|/.test(m[1])) return `location '${location ?? ""}' is not file:line`;
  const file = roots.map((r) => path.resolve(r, m[1])).find((f) => existsSync(f) && statSync(f).isFile());
  if (!file) return `location '${location}' names no file under the repo`;
  const lines = readFileSync(file, "utf8").split(/\r?\n/).length;
  return Number(m[2]) > lines ? `location '${location}' is beyond the file's ${lines} lines` : null;
}

// The reviewer's review.json for this round, checked (the schema is checked by the CLI first): every test of the
// module has all four dimensions, nothing unknown, every finding with a real location, no code edited after the review
// was written. -> {complete, verdict, counts, tests, problems, file}. On a pass: renders review-findings.md and stamps
// review-check.json; on a problem the old stamp is removed. Synchronous like reviewResult.
export function reviewCheck(ctx, domain, { round } = {}) {
  const rp = reviewPaths(ctx.productDir, ctx.runId, ctx.module, domain);
  const fail = (problems, extra = {}) => {
    rmSync(rp.state, { force: true });
    return { complete: false, verdict: null, problems, file: rp.findings, ...extra };
  };
  const en = enumerateTests(ctx, domain);
  if (en.problems.length) return fail(en.problems);
  if (!en.ids.length) return fail(["the module has no tests to review (build the tests first)"]);
  let review;
  try {
    review = readJson(rp.review, null);
  } catch (e) {
    return fail([`review.json is not valid JSON: ${e.message}`]);
  }
  if (!review) return fail(["review.json is missing: the reviewer writes a verdict per test there"]);
  const problems = [];
  if (review.module !== ctx.module) problems.push(`review.json: module is '${review.module}', not '${ctx.module}'`);
  if (round !== undefined && review.round !== Number(round)) problems.push(`review.json is for round ${review.round}, not round ${round}: every test is reviewed again in each round`);
  const tests = review.tests && typeof review.tests === "object" ? review.tests : {};
  const known = new Set(en.ids);
  const roots = [en.root, ctx.root].filter(Boolean);
  const findings = [];
  const add = (f, id, dimension, where) => {
    if (!f || !SEVERITIES.includes(f.severity)) problems.push(`${where}: a finding needs a severity (${SEVERITIES.join(", ")})`);
    if (!String(f?.reason ?? "").trim()) problems.push(`${where}: a finding needs a reason`);
    const lp = locationProblem(f?.location, roots);
    if (lp) problems.push(`${where}: ${lp}`);
    findings.push({ ...f, id, dimension });
  };
  for (const id of en.ids) {
    const t = tests[id];
    if (!t) {
      problems.push(`${id}: not reviewed in this round`);
      continue;
    }
    for (const d of DIMENSIONS) {
      if (t[d] === undefined) problems.push(`${id}: no verdict on ${d}`);
      else if (t[d] !== "ok" && !dimFindings(t[d]).length) problems.push(`${id}: ${d} must be ok or a finding`);
      for (const [i, f] of dimFindings(t[d]).entries()) add(f, id, d, `${id}.${d}${Array.isArray(t[d]) ? `[${i}]` : ""}`);
    }
  }
  for (const id of Object.keys(tests)) if (!known.has(id)) problems.push(`${id}: not a test of this module`);
  for (const [i, f] of (review.general ?? []).entries()) add(f, null, "general", `general[${i}]`);
  // a review older than the code it judged is stale: the code changed after it was written
  const reviewedAt = existsSync(rp.review) ? statSync(rp.review).mtimeMs : 0;
  const newer = Object.entries(en.files).filter(([, f]) => existsSync(f) && statSync(f).mtimeMs > reviewedAt).map(([n]) => n);
  if (newer.length) problems.push(`stale: ${newer.slice(0, 5).join(", ")} changed after review.json was written; review the code again`);
  const counts = Object.fromEntries(SEVERITIES.map((s) => [s, findings.filter((f) => f.severity === s).length]));
  if (problems.length) return fail(problems, { counts });
  const verdict = counts.blocker || counts.major ? "changes-required" : "pass";
  writeAtomic(rp.findings, renderReview({ domain, module: ctx.module, round: review.round, verdict, findings }));
  const state = { round: review.round, verdict, counts, tests: en.ids.length, review: sha256(rp.review), verified: stampVerified(en.files) };
  writeAtomic(rp.state, JSON.stringify(state, null, 2) + "\n");
  return { complete: true, verdict, counts, tests: en.ids.length, problems: [], file: rp.findings };
}

// review-findings.md in the findings format of docs/agent-handoffs.md §6 (what the fixers and unresolvedFindings read).
export function renderReview({ domain, module, round, verdict, findings }) {
  const order = (f) => SEVERITIES.indexOf(f.severity);
  const rows = [...findings].sort((a, b) => order(a) - order(b)).map((f, i) => {
    const [file, line] = /^(.+):(\d+)$/.exec(f.location)?.slice(1) ?? [f.location, ""];
    return `| ${i + 1} | ${f.severity} | ${cell(file)} | ${line} | ${f.dimension} | ${f.id ? `${f.id}: ` : ""}${cell(f.reason)} | ${cell(f.fixHint ?? "")} |`;
  });
  return [`# Review -- ${domain} / ${module} -- round ${round}`, `Verdict: ${verdict}`, "| # | Severity | File | Line | Rule | Problem | Required fix |", "|---|---|---|---|---|---|---|", ...rows, ""].join("\n");
}

// What orchestration reads: the derived verdict of THIS round, only from a stamp that is fresh (review.json unchanged
// since its check, every reviewed code file unchanged). -> {complete, verdict, counts, problems, file}
export function reviewVerdict(ctx, domain, round) {
  const rp = reviewPaths(ctx.productDir, ctx.runId, ctx.module, domain);
  const no = (why) => ({ complete: false, verdict: null, problems: [why], file: rp.findings });
  const state = readJson(rp.state, null);
  if (!state) return no(`review.json never passed review.mjs check (${domain}): the reviewer must run it and fix what it reports`);
  if (round !== undefined && state.round !== Number(round)) return no(`the checked review is for round ${state.round}, not round ${round}`);
  const en = enumerateTests(ctx, domain);
  if (en.problems.length) return no(en.problems[0]);
  const why = unverifiedReason(state.verified, en.files, { changed: "the reviewed code changed after the review was checked; review it again" });
  if (why) return no(why);
  if (state.review !== sha256(rp.review)) return no("review.json changed after review.mjs check; run it again");
  return { complete: true, verdict: state.verdict, counts: state.counts, tests: state.tests, problems: [], file: rp.findings };
}

// Re-renders review-findings.md from a review.json whose stamp is fresh (a fixer round may have deleted the file).
export function reviewRender(ctx, domain) {
  const rp = reviewPaths(ctx.productDir, ctx.runId, ctx.module, domain);
  const v = reviewVerdict(ctx, domain);
  if (!v.complete) return v;
  const review = readJson(rp.review, {});
  const findings = [];
  for (const [id, t] of Object.entries(review.tests ?? {})) for (const d of DIMENSIONS) for (const f of dimFindings(t[d])) findings.push({ ...f, id, dimension: d });
  for (const f of review.general ?? []) findings.push({ ...f, id: null, dimension: "general" });
  writeAtomic(rp.findings, renderReview({ domain, module: ctx.module, round: review.round, verdict: v.verdict, findings }));
  return v;
}
