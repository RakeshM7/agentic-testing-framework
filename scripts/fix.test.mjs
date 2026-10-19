// fix.mjs / lib/fix.mjs: the fixers' accountability (G9): every blocker/major finding (or healable triage row) answered,
// `fixed` verified against a pre-round snapshot, `not-fixed` with a valid reason, no managed file changed.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { paths } from "./lib/contract.mjs";
import { fixCheck, fixSnapshot } from "./lib/fix.mjs";
import { main } from "./fix.mjs";
import { put, startRun } from "./test-helpers.mjs";

const ARTIFACTS = "artifacts/acme/modules/contacts";
const RESULTS = "artifacts/acme/results/acme-run-1/contacts";
const UI_SPEC = "tests/ui/contacts/cases.spec.ts";
const D = {
  "playwright-ui": { code: `playwright-tests/acme/${UI_SPEC}`, planFile: `${ARTIFACTS}/ui-code/plan.json`,
    plan: (f) => ({ files: { spec: f.replace(/^playwright-tests\/acme\//, "") }, objects: [], tests: [{ id: "TC-contacts-1" }, { id: "TC-contacts-2" }] }) },
  k6: { code: "k6-tests/acme/scripts/contacts-smoke.js", planFile: `${ARTIFACTS}/k6/code-plan.json`,
    plan: (f) => ({ files: {}, scripts: [{ id: "K6-contacts-1", file: f.replace(/^k6-tests\/acme\//, "") }] }) },
};
const ok = { intent: "ok", assertion: "ok", flakiness: "ok", "data-safety": "ok" };
const blocker = { severity: "blocker", location: "x:1", reason: "r" };

function setup(domain, { findings = { "TC-contacts-1": { intent: blocker } }, round = 1 } = {}) {
  const { root } = startRun();
  const d = D[domain];
  put(root, d.code, "// v1\n");
  put(root, d.planFile, JSON.stringify(d.plan(d.code)));
  const p = paths("acme", root);
  const ids = domain === "k6" ? ["K6-contacts-1"] : ["TC-contacts-1", "TC-contacts-2"];
  const tests = Object.fromEntries(ids.map((id) => [id, { ...ok, ...(findings[id] ?? {}) }]));
  put(root, `${RESULTS}/${domain}/review.json`, JSON.stringify({ module: "contacts", round, tests }));
  const ctx = { root, product: "acme", module: "contacts", runId: "acme-run-1", productDir: p.productDir, pwProject: p.pwProject, k6Project: p.k6Project, permissions: JSON.parse(readFileSync(p.permissionsFile, "utf8")) };
  const report = (entries, extra = {}) => put(root, `${RESULTS}/${domain}/fix-report.json`, JSON.stringify({ module: "contacts", round, source: "review", entries, ...extra }));
  const edit = (f = d.code) => writeFileSync(path.join(root, f), `// v2 ${Math.random()}\n`);
  const run = (cmd, ...more) => main([cmd, "acme", "contacts", domain, "--round", String(round), ...more], { root });
  return { root, ctx, d, report, edit, run, id: domain === "k6" ? "K6-contacts-1/intent" : "TC-contacts-1/intent" };
}
const fixed = (id, files) => ({ id, status: "fixed", files });
const notFixed = (id, reason = "needs-human", text = "why") => ({ id, status: "not-fixed", reason, text });

test("a fix round passes when every blocker/major finding is answered and a fixed file really changed since the snapshot", async () => {
  const s = setup("playwright-ui");
  assert.equal((await s.run("snapshot")).code, 0);
  s.edit();
  s.report([fixed(s.id, [UI_SPEC])]);
  const r = await s.run("check");
  assert.deepEqual(r.out.problems, []);
  assert.equal(r.code, 0);
  assert.equal(r.out.fixed, 1);
});

test("minor findings need no entry; a missing blocker/major entry, an unknown id and a duplicate fail", async () => {
  const s = setup("playwright-ui", { findings: { "TC-contacts-1": { intent: { ...blocker, severity: "major" }, assertion: { ...blocker, severity: "minor" }, flakiness: [blocker, { ...blocker, severity: "major" }] } } });
  await s.run("snapshot");
  s.edit();
  s.report([fixed("TC-contacts-1/intent", [UI_SPEC])]);
  let r = await s.run("check");
  assert.deepEqual(r.out.problems.sort(), ["TC-contacts-1/flakiness#1: no entry in fix-report.json (every blocker/major finding needs one)", "TC-contacts-1/flakiness#2: no entry in fix-report.json (every blocker/major finding needs one)"]);
  s.report([fixed("TC-contacts-1/intent", [UI_SPEC]), fixed("TC-contacts-1/intent", [UI_SPEC]), notFixed("TC-contacts-1/flakiness#1"), notFixed("TC-contacts-1/flakiness#2"), notFixed("TC-contacts-9/intent")]);
  r = await s.run("check");
  assert.ok(r.out.problems.some((p) => /intent: answered twice/.test(p)));
  assert.ok(r.out.problems.some((p) => /TC-contacts-9\/intent: not a blocker\/major finding/.test(p)));
});

test("not-fixed needs one of the four reasons and a text", async () => {
  const s = setup("playwright-ui");
  await s.run("snapshot");
  s.report([{ id: s.id, status: "not-fixed", reason: "too-hard", text: "x" }]);
  const r = await s.run("check");
  assert.equal(r.code, 1);
  assert.ok(r.out.problems.some((p) => p.startsWith("fix-report.json:")), "the schema refuses an unknown reason");
  s.report([{ id: s.id, status: "not-fixed", reason: "needs-human" }]);
  assert.equal((await s.run("check")).code, 1, "no text");
  for (const reason of ["disagree-with-cited-reason", "needs-product-change", "needs-human", "out-of-scope"]) {
    s.report([notFixed(s.id, reason, "the cited line does assert it")]);
    assert.equal((await s.run("check")).code, 0, reason);
  }
  s.report([notFixed(s.id, "needs-human", "  ")]);
  assert.match(fixCheck(s.ctx, "playwright-ui", { round: 1 }).problems[0], /needs a text/);
});

test("fixed must list files that changed this round: an unchanged file, a foreign file and an empty list fail", async () => {
  const s = setup("playwright-ui");
  await s.run("snapshot");
  s.report([fixed(s.id, [UI_SPEC])]);
  const r = await s.run("check");
  assert.ok(r.out.problems.some((p) => /did not change this round/.test(p)), JSON.stringify(r.out));
  s.report([fixed(s.id, ["package.json"])]);
  assert.ok((await s.run("check")).out.problems.some((p) => /not one of this domain's code files/.test(p)));
  s.report([{ id: s.id, status: "fixed", files: [] }]);
  assert.equal((await s.run("check")).code, 1);
});

test("a missing snapshot fails; a snapshot is kept per source and round, and another round's does not count", async () => {
  const s = setup("playwright-ui");
  s.edit();
  s.report([fixed(s.id, [UI_SPEC])]);
  assert.match((await s.run("check")).out.problems[0], /fix-snapshot\.json .* is missing/);
  assert.equal(fixSnapshot(s.ctx, "playwright-ui", { round: 1, source: "review" }).kept, false);
  s.edit();
  assert.equal(fixSnapshot(s.ctx, "playwright-ui", { round: 1, source: "review" }).kept, true, "a resumed fixer keeps its baseline");
  assert.equal(fixSnapshot(s.ctx, "playwright-ui", { round: 2, source: "review" }).kept, false);
  assert.match(fixCheck(s.ctx, "playwright-ui", { round: 1 }).problems[0], /missing/);
});

test("a changed managed file or generated plan is a finding, listed or not (k6 scripts and the plan are script-owned)", async () => {
  const s = setup("k6");
  await s.run("snapshot");
  s.edit();
  s.report([fixed(s.id, ["scripts/contacts-smoke.js"])]);
  let r = await s.run("check");
  assert.ok(r.out.problems.some((p) => /k6-tests\/acme\/scripts\/contacts-smoke\.js: a managed file changed/.test(p)), JSON.stringify(r.out));
  writeFileSync(path.join(s.root, s.d.planFile), JSON.stringify({ ...s.d.plan(s.d.code), changed: true }));
  r = await s.run("check");
  assert.ok(r.out.problems.some((p) => /code-plan\.json: a generated plan changed/.test(p)), JSON.stringify(r.out));
});

test("source triage: every healable row needs an entry, rows that are not healable need none", async () => {
  const s = setup("playwright-ui");
  put(s.root, `${RESULTS}/playwright-ui/triage.json`, JSON.stringify({ rows: [
    { key: "ui:TC-contacts-1", class: "locator-drift", healable: true, fixHint: "h" },
    { key: "ui:TC-contacts-2", class: "product-bug", healable: false },
  ] }));
  const triageReport = (entries) => put(s.root, `${RESULTS}/playwright-ui/fix-report.json`, JSON.stringify({ module: "contacts", round: 1, source: "triage", entries }));
  await s.run("snapshot", "--source", "triage");
  s.edit();
  triageReport([]);
  let r = await s.run("check", "--source", "triage");
  assert.deepEqual(r.out.problems, ["ui:TC-contacts-1: no entry in fix-report.json (every healable row needs one)"]);
  triageReport([fixed("ui:TC-contacts-1", [UI_SPEC])]);
  r = await s.run("check", "--source", "triage");
  assert.equal(r.code, 0, JSON.stringify(r.out));
  triageReport([fixed("ui:TC-contacts-1", [UI_SPEC]), notFixed("ui:TC-contacts-2")]);
  assert.ok((await s.run("check", "--source", "triage")).out.problems.some((p) => /not a healable row/.test(p)));
  s.report([fixed(s.id, [UI_SPEC])]);
  assert.ok((await s.run("check", "--source", "triage")).out.problems.some((p) => /for source 'review', not 'triage'/.test(p)));
});

test("usage errors exit 2 and paths names the files", async () => {
  const s = setup("playwright-ui");
  assert.equal((await main(["check", "acme", "contacts", "playwright-ui"], { root: s.root })).code, 2);
  assert.equal((await main(["check", "acme", "contacts", "testcases", "--round", "1"], { root: s.root })).code, 2);
  assert.equal((await s.run("check", "--source", "nope")).code, 2);
  const r = await main(["paths", "acme", "contacts", "k6"], { root: s.root });
  assert.match(r.out.report, /contacts\/k6\/fix-report\.json$/);
  assert.ok(!existsSync(path.join(s.root, r.out.report)));
});

test("a fixer cannot launder the baseline: a CLI snapshot never overwrites one, even for another round", async () => {
  const s = setup("playwright-ui");
  assert.equal(fixSnapshot(s.ctx, "playwright-ui", { round: 1, source: "review" }).kept, false); // orchestration (library) takes it
  s.edit();
  for (const round of [99, 1]) {
    const r = await main(["snapshot", "acme", "contacts", "playwright-ui", "--round", String(round)], { root: s.root });
    assert.equal(r.code, 1);
    assert.match(r.out.problems[0], /will not re-baseline/);
  }
  s.report([fixed(s.id, [UI_SPEC])]);
  const r = await s.run("check");
  assert.deepEqual(r.out.problems, [], "the original baseline still stands: the edit is seen");
  assert.equal(r.out.changed.length, 1);
});

test("deleting the snapshot does not help once the orchestration has started a fixer step", async () => {
  const s = setup("playwright-ui");
  fixSnapshot(s.ctx, "playwright-ui", { round: 1, source: "review" });
  put(s.root, "artifacts/acme/state/orchestration/playwright-ui-contacts.json", JSON.stringify({ steps: { "fix-1": { status: "running" } } }));
  rmSync(path.join(s.root, RESULTS, "playwright-ui", "fix-snapshot.json"));
  const r = await s.run("snapshot");
  assert.equal(r.code, 1);
  assert.match(r.out.problems[0], /already started/);
});

test("hand-written helpers outside the enumerated files are snapshotted and may be listed as fixed; a managed one is still a finding", async () => {
  for (const [domain, file, rel] of [["playwright-ui", "playwright-tests/acme/helpers/ui/forms.ts", "helpers/ui/forms.ts"], ["k6", "k6-tests/acme/lib/ext/extra.js", "lib/ext/extra.js"]]) {
    const s = setup(domain, domain === "k6" ? { findings: { "K6-contacts-1": { intent: blocker } } } : {});
    put(s.root, file, "// h1\n");
    await s.run("snapshot");
    s.edit(file);
    s.report([fixed(s.id, [rel])]);
    const r = await s.run("check");
    assert.deepEqual(r.out.problems, [], domain);
    assert.ok(r.out.changed.includes(file), domain);
  }
});
