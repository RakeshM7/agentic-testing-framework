// review.mjs / lib/review.mjs: the per-test review of the code domains (G9): every test reviewed in this round, findings
// with a real file:line, the verdict derived (never typed), a stamp that goes stale when the code changes.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, utimesSync } from "node:fs";
import path from "node:path";
import { paths } from "./lib/contract.mjs";
import { unresolvedFindings } from "./lib/domain-flows.mjs";
import { reviewCheck, reviewVerdict } from "./lib/review.mjs";
import { main } from "./review.mjs";
import { put, startRun } from "./test-helpers.mjs";

const ARTIFACTS = "artifacts/acme/modules/contacts";
const CODE = Array.from({ length: 12 }, (_, i) => `// line ${i + 1}`).join("\n") + "\n";
const strip = (f) => f.replace(/^(playwright-tests|k6-tests)\/acme\//, "");
// A domain's plan and code on disk, the way its generator leaves them: only the plan's ids and files matter to review.
const DOMAINS = {
  "playwright-ui": {
    ids: ["TC-contacts-1", "TC-contacts-2"], code: "playwright-tests/acme/tests/ui/contacts/cases.spec.ts", planFile: `${ARTIFACTS}/ui-code/plan.json`,
    plan: (f) => ({ files: { spec: strip(f) }, objects: [], tests: [{ id: "TC-contacts-1" }, { id: "TC-contacts-2" }] }),
  },
  "playwright-api": {
    ids: ["API-contacts-1", "API-contacts-2"], code: "playwright-tests/acme/tests/api/contacts/people.spec.ts", planFile: `${ARTIFACTS}/api-code/plan.json`,
    plan: (f) => ({ files: { specs: [strip(f)] }, clients: [], tests: [{ id: "API-contacts-1" }, { id: "API-contacts-2" }] }),
  },
  k6: {
    ids: ["K6-contacts-1", "K6-contacts-2"], code: "k6-tests/acme/scripts/contacts-smoke.js", planFile: `${ARTIFACTS}/k6/code-plan.json`,
    plan: (f) => ({ files: {}, scripts: [{ id: "K6-contacts-1", file: strip(f) }, { id: "K6-contacts-2", file: strip(f) }] }),
  },
};
const setup = (domain) => {
  const { root } = startRun();
  const d = DOMAINS[domain];
  put(root, d.code, CODE);
  put(root, d.planFile, JSON.stringify(d.plan(d.code)));
  const p = paths("acme", root);
  const ctx = { root, module: "contacts", productDir: p.productDir, runId: "acme-run-1", pwProject: p.pwProject, k6Project: p.k6Project };
  const file = `artifacts/acme/results/acme-run-1/contacts/${domain}/review.json`;
  const ok = { intent: "ok", assertion: "ok", flakiness: "ok", "data-safety": "ok" };
  const write = (tests, round = 1) => put(root, file, JSON.stringify({ module: "contacts", round, tests }));
  const all = (over = {}) => Object.fromEntries(d.ids.map((id) => [id, { ...ok, ...(over[id] ?? {}) }]));
  return { root, ctx, d, file, loc: `${strip(d.code)}:3`, ok, write, all };
};
// set a file's mtime relative to now (same-millisecond writes cannot order the review and the code)
const touch = (root, file, seconds) => {
  const t = new Date(Date.now() + seconds * 1000);
  utimesSync(path.join(root, file), t, t);
};
const check = (s, domain) => main(["check", "acme", "contacts", domain, "--round", "1"], { root: s.root });

for (const domain of Object.keys(DOMAINS)) {
  test(`${domain}: every test must be reviewed in this round; an unknown id and a missing dimension are refused`, async () => {
    const s = setup(domain);
    s.write({ [s.d.ids[0]]: s.ok });
    let r = reviewCheck(s.ctx, domain, { round: 1 });
    assert.equal(r.complete, false);
    assert.ok(r.problems.some((p) => p.startsWith(`${s.d.ids[1]}: not reviewed`)), JSON.stringify(r));
    s.write({ ...s.all(), "TC-contacts-99": s.ok });
    r = reviewCheck(s.ctx, domain, { round: 1 });
    assert.ok(r.problems.some((p) => p.startsWith("TC-contacts-99: not a test of this module")), JSON.stringify(r));
    assert.equal(r.verdict, null);
    // a missing dimension is the schema's, checked by the CLI
    s.write({ ...s.all(), [s.d.ids[0]]: { intent: "ok", assertion: "ok", flakiness: "ok" } });
    const cli = await check(s, domain);
    assert.equal(cli.code, 1);
    assert.match(cli.out.problems.join("\n"), /data-safety/);
  });

  test(`${domain}: the verdict is derived (pass exactly when no blocker or major) and review-findings.md is rendered`, async () => {
    const s = setup(domain);
    const [a, b] = s.d.ids;
    s.write(s.all({ [a]: { assertion: { severity: "minor", location: s.loc, reason: "asserts only visibility" }, flakiness: { severity: "info", location: s.loc, reason: "fine" } } }));
    let r = await check(s, domain);
    assert.equal(r.code, 0, JSON.stringify(r));
    assert.deepEqual([r.out.complete, r.out.verdict, r.out.counts.minor, r.out.counts.info], [true, "pass", 1, 1]);
    const md = readFileSync(path.join(s.root, r.out.file), "utf8");
    assert.match(md, /^Verdict: pass$/m);
    assert.match(md, new RegExp(`\\| minor \\| .* \\| 3 \\| assertion \\| ${a}: asserts only visibility`));
    assert.equal(unresolvedFindings(path.join(s.root, r.out.file)).length, 0);

    s.write(s.all({ [b]: { intent: [{ severity: "major", location: s.loc, reason: "tests an adjacent behavior", fixHint: "assert the saved row" }, { severity: "blocker", location: s.loc, reason: "wrong oracle" }] } }));
    r = await check(s, domain);
    assert.equal(r.code, 0, "a complete review with findings is valid; its verdict is changes-required");
    assert.deepEqual([r.out.verdict, r.out.counts.blocker, r.out.counts.major], ["changes-required", 1, 1]);
    const open = unresolvedFindings(path.join(s.root, r.out.file));
    assert.deepEqual(open.map((f) => f.severity), ["blocker", "major"]);
    assert.match(open[0].problem, new RegExp(`^${b}: wrong oracle`));
    assert.equal(reviewVerdict(s.ctx, domain, 1).verdict, "changes-required");
  });

  test(`${domain}: a finding without a real file:line is rejected`, async () => {
    const s = setup(domain);
    const bad = (finding) => {
      s.write(s.all({ [s.d.ids[0]]: { intent: finding } }));
      return check(s, domain);
    };
    let r = await bad({ severity: "major", reason: "no location at all" });
    assert.equal(r.code, 1);
    assert.match(r.out.problems.join("\n"), /location/);
    r = await bad({ severity: "major", location: "somewhere", reason: "not file:line" });
    assert.equal(r.code, 1);
    r = await bad({ severity: "major", location: "no/such/file.ts:3", reason: "no such file" });
    assert.match(r.out.problems.join("\n"), /names no file/);
    r = await bad({ severity: "major", location: `${strip(s.d.code)}:99`, reason: "beyond the file" });
    assert.match(r.out.problems.join("\n"), /beyond the file/);
    r = await bad({ severity: "major", location: s.loc, reason: "" });
    assert.equal(r.code, 1);
    assert.ok(!existsSync(path.join(s.root, "artifacts/acme/results/acme-run-1/contacts", domain, "review-findings.md")), "nothing is rendered from a refused review");
  });

  test(`${domain}: a review is stale once the code changes; the stamp is read only while fresh`, () => {
    const s = setup(domain);
    assert.match(reviewVerdict(s.ctx, domain, 1).problems[0], /never passed review\.mjs check/);
    s.write(s.all());
    touch(s.root, s.d.code, -30);
    assert.equal(reviewCheck(s.ctx, domain, { round: 1 }).verdict, "pass");
    assert.equal(reviewVerdict(s.ctx, domain, 1).verdict, "pass");
    assert.match(reviewVerdict(s.ctx, domain, 2).problems[0], /round 1, not round 2/);
    // code edited after the review was written
    touch(s.root, s.d.code, 30);
    const r = reviewCheck(s.ctx, domain, { round: 1 });
    assert.equal(r.complete, false);
    assert.match(r.problems.join("\n"), /stale/);
    assert.equal(reviewVerdict(s.ctx, domain, 1).complete, false, "a failed check removes the stamp");
    // a stamped review whose code then changes
    touch(s.root, s.d.code, -30);
    assert.equal(reviewCheck(s.ctx, domain, { round: 1 }).complete, true);
    put(s.root, s.d.code, CODE + "// edited\n");
    assert.match(reviewVerdict(s.ctx, domain, 1).problems[0], /code changed after the review was checked/);
    // review.json edited after its check
    put(s.root, s.d.code, CODE);
    touch(s.root, s.d.code, -60);
    reviewCheck(s.ctx, domain, { round: 1 });
    assert.equal(reviewVerdict(s.ctx, domain, 1).verdict, "pass");
    s.write(s.all({ [s.d.ids[0]]: { intent: { severity: "blocker", location: s.loc, reason: "changed my mind" } } }));
    assert.match(reviewVerdict(s.ctx, domain, 1).problems[0], /review\.json changed after review\.mjs check/);
  });
}

test("a review of another round does not count, and render re-creates review-findings.md from a fresh stamp", async () => {
  const s = setup("k6");
  s.write(s.all(), 1);
  assert.match(reviewCheck(s.ctx, "k6", { round: 2 }).problems.join("\n"), /round 1, not round 2/);
  s.write(s.all({ [s.d.ids[0]]: { flakiness: { severity: "major", location: s.loc, reason: "sleep without a reason" } } }));
  const c = await check(s, "k6");
  assert.equal(c.out.verdict, "changes-required");
  const f = path.join(s.root, c.out.file);
  put(s.root, c.out.file, "gone");
  const rr = await main(["render", "acme", "contacts", "k6"], { root: s.root });
  assert.equal(rr.code, 0);
  assert.match(readFileSync(f, "utf8"), /^Verdict: changes-required$/m);
  assert.equal((await main(["paths", "acme", "contacts", "k6"], { root: s.root })).out.review, "artifacts/acme/results/acme-run-1/contacts/k6/review.json");
});

test("usage errors, and testcases delegates to the G3 per-case review-check", async () => {
  const { root } = startRun();
  assert.equal((await main(["check", "acme", "contacts", "k6"], { root })).code, 2, "--round is required");
  assert.equal((await main(["check", "acme", "contacts", "nope", "--round", "1"], { root })).code, 2);
  const r = await main(["check", "acme", "contacts", "testcases", "--round", "1"], { root });
  assert.equal(r.code, 1);
  assert.equal(r.out.complete, false);
  assert.match(r.out.problems.join("\n"), /coverage\.json is missing/);
});

test("a module with no tests built has nothing to review: the check refuses", () => {
  const { root } = startRun();
  const p = paths("acme", root);
  const ctx = { root, module: "contacts", productDir: p.productDir, runId: "acme-run-1", pwProject: p.pwProject, k6Project: p.k6Project };
  assert.match(reviewCheck(ctx, "playwright-api", { round: 1 }).problems[0], /api-code\/plan\.json is missing/);
  put(root, `${ARTIFACTS}/k6/code-plan.json`, JSON.stringify({ files: {}, scripts: [] }));
  assert.match(reviewCheck(ctx, "k6", { round: 1 }).problems[0], /no tests to review/);
});
