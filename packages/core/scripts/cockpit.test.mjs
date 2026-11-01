// cockpit.mjs / lib/cockpit.mjs (D-111): the Cockpit's read-only data (C1 of docs/cockpit-plan.md), over a copy of the
// contract-2 workspace fixture with the results, triage and coverage files a failed UI case needs.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cockpitData } from "./lib/cockpit.mjs";
import { readJson, withResults, workspace, writeJson } from "./fixtures/cockpit-workspace.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(here, "cockpit.mjs");

// every file under root: name, size, mtime
function listing(root) {
  const out = [];
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      const f = path.join(d, n);
      const s = statSync(f);
      out.push(`${path.relative(root, f)}|${s.isDirectory() ? "dir" : s.size}|${s.mtimeMs}`);
      if (s.isDirectory()) walk(f);
    }
  };
  walk(root);
  return out.sort();
}

test("the C1 shape of a run with results", async () => {
  const root = workspace();
  withResults(root);
  const d = await cockpitData("acme", { root });
  assert.equal(d.schemaVersion, 1);
  assert.equal(d.product, "acme");
  assert.equal(d.environment, "default");
  assert.ok(!Number.isNaN(Date.parse(d.generatedAt)));
  assert.deepEqual(d.run, { runId: "acme-run-1", mode: "readonly", active: false, createdAt: "2026-10-01T09:00:00.000Z", target: "https://app.acme.test", modules: ["contacts"], steps: ["explore", "testcases", "playwright-ui", "k6"] });
  assert.ok(d.overview.stages.some((r) => r.stage === "explore" && r.complete));
  assert.ok(Array.isArray(d.overview.next));
  assert.ok(Array.isArray(d.overview.needsYou));
  assert.deepEqual(Object.keys(d.overview.intents.contacts).sort(), ["automate", "explore", "heal", "k6", "testcases"]);
  assert.ok(d.timeline.stages.some((s) => s.key === "contacts/explore" && s.module === "contacts" && s.status === "done"));
  assert.ok(d.timeline.stages.some((s) => s.key === "_product/knowledge" && s.module === null));
  assert.equal(typeof d.timeline.totals.durationMs, "number");
  assert.ok(d.timeline.history.every((h) => h.runId && "report" in h));
  assert.equal(d.timeline.history.find((h) => h.runId === "acme-run-1").report, "artifacts/acme/results/acme-run-1/report/index.html");
  assert.equal(d.safety.mode, "readonly");
  assert.match(d.safety.explanation, /Read-only/);
  assert.equal(d.safety.ledger.file, "artifacts/acme/state/ledger.jsonl");
  assert.equal(d.safety.ledger.entries.length, 1);
  assert.equal(d.safety.ledger.live, 1);
  assert.equal(d.safety.ledger.cleaned, 0);
  assert.equal(d.safety.ledger.entries[0].live, true);
  assert.equal(d.safety.frameworkIssues, 0);
  assert.ok(d.missing.every((m) => m.section && m.reason && "module" in m));
  assert.ok(d.overview.needsYou.some((n) => n.kind === "leftovers" && n.count === 1));
  assert.ok(d.overview.needsYou.some((n) => n.kind === "approval" && n.module === "contacts" && n.count === 25 && n.ids.length === 20));
  JSON.parse(JSON.stringify(d));
});

test("the trace joins a case to its spec and its result, with the triage class", async () => {
  const root = workspace();
  withResults(root);
  const { modules } = (await cockpitData("acme", { root })).trace;
  assert.equal(modules.length, 1);
  const cases = modules[0].cases;
  const one = cases.find((c) => c.id === "TC-contacts-1");
  assert.deepEqual(one.types, ["ui"]);
  assert.equal(one.approval, "approved");
  assert.deepEqual(one.automation.ui, { status: "mapped", files: ["playwright-tests/acme/tests/ui/contacts/cases.spec.ts"], reason: null });
  assert.equal(one.automation.api.status, "none");
  assert.equal(one.automation.k6.status, "none");
  assert.deepEqual(one.results, [{ framework: "playwright-ui", title: "TC-contacts-1 opens the New contact dialog", status: "failed", attempts: 2, passedOnRetry: false, triageClass: "locator-drift" }]);
  const two = cases.find((c) => c.id === "TC-contacts-2");
  assert.equal(two.automation.ui.status, "excluded");
  assert.equal(two.automation.ui.reason, "visual");
  assert.equal(two.results[0].triageClass, null);
  const three = cases.find((c) => c.id === "TC-contacts-3");
  assert.equal(three.approval, "pending");
  assert.equal(three.automation.ui.status, "none");
  assert.deepEqual(three.results, []);
});

test("failures: classes, clusters with rows and the bug draft path, healable rows, unverified triage", async () => {
  const root = workspace();
  withResults(root);
  const f = (await cockpitData("acme", { root })).failures;
  assert.deepEqual(f.byClass, { "locator-drift": 1 });
  assert.equal(f.clusters.length, 1);
  const c = f.clusters[0];
  assert.equal(c.id, "BUG-contacts-1");
  assert.equal(c.module, "contacts");
  assert.equal(c.framework, "playwright-ui");
  assert.equal(c.class, "locator-drift");
  assert.equal(c.severity, "major");
  assert.equal(c.count, 1);
  assert.deepEqual(c.rows[0], { key: "ui:TC-contacts-1", title: "TC-contacts-1 opens the New contact dialog", tcId: "TC-contacts-1", error: "Timeout 5000ms exceeded", fixHint: "re-ground the locator", evidence: ["artifacts/acme/modules/contacts/explore/sitemap.json"] });
  // the draft's file is not exported yet (report-data.mjs writes it): nothing to open
  assert.equal(c.bugDraft, null);
  assert.deepEqual(f.healable, [{ module: "contacts", framework: "playwright-ui", stage: "playwright-ui", count: 1 }]);
  // the triage was never stamped by `triage.mjs check`
  assert.deepEqual(f.unverified, [{ module: "contacts", framework: "playwright-ui" }]);

  // once exported beside the report, the draft is offered
  const bug = path.join(root, "artifacts", "acme", "results", "acme-run-1", "bugs", "BUG-contacts-1.md");
  mkdirSync(path.dirname(bug), { recursive: true });
  writeFileSync(bug, "# New contact button missing\n");
  const g = (await cockpitData("acme", { root })).failures;
  assert.deepEqual(g.clusters[0].bugDraft, { file: "artifacts/acme/results/acme-run-1/bugs/BUG-contacts-1.md", title: "New contact button missing" });
});

test("the intents say when they are enabled and why not", async () => {
  const root = workspace();
  withResults(root);
  const i = (await cockpitData("acme", { root })).overview.intents.contacts;
  assert.equal(i.explore.enabled, true);
  assert.equal(i.testcases.enabled, true);
  assert.equal(i.automate.enabled, true);
  assert.equal(i.k6.enabled, false);
  assert.match(i.k6.why, /performance/);
  assert.equal(i.heal.enabled, true);
  assert.equal(i.heal.stage, "playwright-ui");

  // a run that chose neither Playwright step: automate says so, and nothing is healable
  const bare = workspace();
  const d = await cockpitData("acme", { root: bare });
  const j = d.overview.intents.contacts;
  assert.equal(j.automate.enabled, false);
  assert.match(j.automate.why, /neither Playwright/);
  assert.equal(j.k6.enabled, false);
  assert.match(j.k6.why, /not chosen/);
  assert.equal(j.heal.enabled, false);
  assert.equal(j.heal.stage, null);
  assert.equal(j.heal.why, "no healable failure");

  // an active run (a lock) disables nothing: each intent resumes it
  writeJson(path.join(root, "artifacts", "acme", "state", "lock.json"), { pid: 1 });
  const locked = (await cockpitData("acme", { root })).overview.intents.contacts;
  assert.deepEqual(locked, i);
});

test("it writes nothing: no file created, changed or touched", async () => {
  const root = workspace();
  withResults(root);
  const before = listing(root);
  await cockpitData("acme", { root });
  const cli = spawnSync(process.execPath, [SCRIPT, "acme", "--json"], { env: { ...process.env, ATF_WORKSPACE: root }, encoding: "utf8" });
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(JSON.parse(cli.stdout).product, "acme");
  assert.deepEqual(listing(root), before);
  assert.ok(!existsSync(path.join(root, "artifacts", "acme", "state", "lock.json")));
  assert.ok(!existsSync(path.join(root, "artifacts", "acme", "results", "acme-run-1", "bugs")));
});

test("no run yet: the empty shape, exit code 0", async () => {
  const root = workspace();
  rmSync(path.join(root, "artifacts", "acme", "state", "run.json"));
  const d = await cockpitData("acme", { root });
  assert.equal(d.run, null);
  assert.deepEqual(d.overview, { stages: [], next: [], needsYou: [], intents: {} });
  assert.deepEqual(d.trace, { modules: [] });
  assert.deepEqual(d.failures, { byClass: {}, clusters: [], healable: [], unverified: [] });
  // the mode the next run would take, from the run-config, marked as planned (not a run's resolved mode)
  assert.equal(d.safety.mode, "readonly");
  assert.equal(d.safety.planned, true);
  assert.equal(d.safety.configFile, "config/acme.yaml");
  assert.match(d.safety.explanation, /^Before the first run: config\/acme\.yaml sets this mode/);
  assert.deepEqual(d.safety.customConfig, { permissions: null, other: [] });
  assert.deepEqual(d.safety.ledger.entries, []);
  assert.deepEqual(d.missing, [{ section: "run", module: null, reason: "no run yet" }]);
  const cli = spawnSync(process.execPath, [SCRIPT, "acme", "--json"], { env: { ...process.env, ATF_WORKSPACE: root }, encoding: "utf8" });
  assert.equal(cli.status, 0);
  assert.equal(JSON.parse(cli.stdout).run, null);
});

test("no run yet: a product the interview just drafted (a run-config, no artifacts/<product>) is empty, not unknown", async () => {
  const root = workspace();
  writeFileSync(path.join(root, "config", "eventhub.yaml"), readFileSync(path.join(root, "config", "acme.yaml"), "utf8").replace(/^product: .*$/m, "product: eventhub"));
  assert.ok(!existsSync(path.join(root, "artifacts", "eventhub")));
  const d = await cockpitData("eventhub", { root });
  assert.equal(d.run, null);
  assert.equal(d.safety.configFile, "config/eventhub.yaml");
  assert.deepEqual(d.missing, [{ section: "run", module: null, reason: "no run yet" }]);
  const cli = spawnSync(process.execPath, [SCRIPT, "eventhub", "--json"], { env: { ...process.env, ATF_WORKSPACE: root }, encoding: "utf8" });
  assert.equal(cli.status, 0, cli.stdout);
  assert.equal(JSON.parse(cli.stdout).product, "eventhub");
  assert.ok(!existsSync(path.join(root, "artifacts", "eventhub")), "read-only: nothing made");
});

test("no run yet: a run-config's full-run, own permissions_file and a workspace overlay are shown; no run-config, no mode", async () => {
  const root = workspace();
  rmSync(path.join(root, "artifacts", "acme", "state", "run.json"));
  const cfgFile = path.join(root, "config", "acme.yaml");
  const text = readFileSync(cfgFile, "utf8");
  writeFileSync(cfgFile, text.replace("authorizations: {mode: readonly}", "authorizations: {mode: full-run}\npermissions_file: perms/own.yaml"));
  mkdirSync(path.join(root, "atf"), { recursive: true });
  writeFileSync(path.join(root, "atf", "models.yaml"), "{}\n");
  let d = await cockpitData("acme", { root });
  assert.equal(d.safety.mode, "full-run");
  assert.equal(d.safety.planned, true);
  assert.deepEqual(d.safety.customConfig.permissions, { source: "run-config", files: ["perms/own.yaml"] });
  assert.deepEqual(d.safety.customConfig.other.map((c) => [c.name, c.source]), [["models.yaml", "overlay"]]);
  rmSync(cfgFile);
  d = await cockpitData("acme", { root });
  assert.equal(d.safety.mode, null);
  assert.equal(d.safety.planned, false);
  assert.equal(d.safety.customConfig, null);
});

test("an ATF_ENV=staging product reads its own environment's state", async () => {
  const root = workspace();
  withResults(root, { env: "staging" });
  const cli = spawnSync(process.execPath, [SCRIPT, "acme", "--json"], { env: { ...process.env, ATF_WORKSPACE: root, ATF_ENV: "staging" }, encoding: "utf8" });
  assert.equal(cli.status, 0, cli.stderr);
  const d = JSON.parse(cli.stdout);
  assert.equal(d.environment, "staging");
  assert.equal(d.run.runId, "acme-staging-run-1");
  assert.equal(d.safety.ledger.file, "artifacts/acme/envs/staging/state/ledger.jsonl");
  assert.equal(d.timeline.history[0].runId, "acme-staging-run-1");
  assert.equal(d.trace.modules[0].cases.find((c) => c.id === "TC-contacts-1").results[0].status, "failed");
});

test("the CLI: usage is exit 2, an unknown product is exit 1 with an error", () => {
  const root = workspace();
  const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { env: { ...process.env, ATF_WORKSPACE: root }, encoding: "utf8" });
  assert.equal(run().status, 2);
  assert.equal(run("acme").status, 2);
  assert.equal(run("acme", "--json", "--x").status, 2);
  const unknown = run("nope", "--json");
  assert.equal(unknown.status, 1);
  assert.match(JSON.parse(unknown.stdout).error, /unknown product 'nope'/);
});

test("D-113: the timeline carries each stage's ended attempts with their durations, and each ended run's stage times", async () => {
  const root = workspace();
  withResults(root);
  const runFile = path.join(root, "artifacts", "acme", "state", "run.json");
  const run = readJson(runFile);
  run.stages["contacts/explore"] = {
    ...run.stages["contacts/explore"],
    attempts: 2,
    previous: [{ attempt: 1, status: "failed", startedAt: "2026-10-01T08:00:00.000Z", finishedAt: "2026-10-01T08:05:00.000Z", error: "the browser crashed", interrupted: true }],
  };
  writeJson(runFile, run);
  const histFile = path.join(root, "artifacts", "acme", "state", "history", "acme-run-0.json");
  writeJson(histFile, {
    runId: "acme-run-0",
    outcome: "failed",
    createdAt: "2026-09-01T09:00:00.000Z",
    endedAt: "2026-09-01T10:00:00.000Z",
    stages: [
      { stage: "explore", module: "contacts", status: "failed", attempts: 2, startedAt: "2026-09-01T09:10:00.000Z", finishedAt: "2026-09-01T09:40:00.000Z", error: "boom", previous: [{ attempt: 1, status: "failed", startedAt: "2026-09-01T09:00:00.000Z", finishedAt: "2026-09-01T09:05:00.000Z" }] },
      { stage: "testcases", module: "contacts", status: "pending", complete: false },
    ],
  });
  const before = listing(root);
  const d = await cockpitData("acme", { root });
  const ex = d.timeline.stages.find((s) => s.key === "contacts/explore");
  assert.deepEqual(ex.previous, [{ attempt: 1, status: "failed", startedAt: "2026-10-01T08:00:00.000Z", finishedAt: "2026-10-01T08:05:00.000Z", durationMs: 300000, error: "the browser crashed", interrupted: true }]);
  assert.deepEqual(d.timeline.stages.find((s) => s.key === "_product/knowledge").previous, [], "none: an empty list");
  const h = d.timeline.history.find((x) => x.runId === "acme-run-0");
  assert.deepEqual(h.stages.map((s) => [s.stage, s.module, s.attempts, s.durationMs, s.previous.length]), [["explore", "contacts", 2, 1800000, 1]], "only stages that ran");
  assert.equal(h.stages[0].previous[0].durationMs, 300000);
  assert.deepEqual(d.timeline.history.find((x) => x.runId === "acme-run-1").stages, [], "an older summary has no times");
  assert.deepEqual(listing(root), before, "still read-only");
});
