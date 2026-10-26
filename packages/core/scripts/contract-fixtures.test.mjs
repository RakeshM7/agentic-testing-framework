// What a release wrote, this release must read (docs/packaging.md §3.10: patch and minor releases read every artifact a
// previous release of the same major wrote). Each scripts/fixtures/workspaces/contract-<n>/ is a client's workspace as
// the release that introduced contract <n> left it, frozen (its README says how it was made and when to add one). For
// each, in a temp copy: a workspace on an older contract is migrated first with the package's own steps (a missing
// step fails here), and then this release must read it as its own: atf version, the doctor's contract check, run.mjs
// status, next and validate, every JSON file against its schema, the decision lookup, report-data on the frozen run,
// atf migrate --dry-run (nothing left to migrate), and atf sync then atf check.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { plan, versionInfo } from "./lib/cli.mjs";
import { CONTRACT_VERSION, validateData } from "./lib/contract.mjs";
import { runChecks } from "./lib/doctor.mjs";
import { migrateWorkspace } from "./lib/migrate.mjs";
import { frameworkRoot } from "./lib/roots.mjs";
import { sync } from "./lib/sync.mjs";
import { main as decisions } from "./decisions.mjs";
import { collect } from "./report-data.mjs";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "workspaces");
const fixtures = readdirSync(FIXTURES).filter((d) => /^contract-\d+$/.test(d)).sort();

// Every JSON file a workspace keeps, by its path from the workspace: the schema it must pass, or null for a file with
// none. A file no rule names fails the test, so a new kind of file gets a decision here. `.jsonl`: each line.
const SCHEMAS = [
  [/^atf\/atf\.json$/, null],
  [/^artifacts\/[^/]+\/(?:envs\/[^/]+\/)?state\/run\.json$/, "run"],
  [/^artifacts\/[^/]+\/(?:envs\/[^/]+\/)?state\/lock\.json$/, "lock"],
  [/^artifacts\/[^/]+\/(?:envs\/[^/]+\/)?state\/ledger\.jsonl$/, "ledger-entry"],
  [/^artifacts\/[^/]+\/(?:envs\/[^/]+\/)?state\/(?:config|permissions)\.resolved\.json$/, null],
  [/^artifacts\/[^/]+\/(?:envs\/[^/]+\/)?state\/history\/[^/]+\.json$/, null],
  [/^artifacts\/[^/]+\/knowledge\/sources\.json$/, "sources"],
  [/^artifacts\/[^/]+\/knowledge\/(?:modules\/[^/]+\/)?coverage\.json$/, "knowledge-coverage"],
  [/^artifacts\/[^/]+\/knowledge\/(?:modules\/[^/]+\/)?open-points\.json$/, "knowledge-open-points"],
  [/^artifacts\/[^/]+\/knowledge\/modules\/[^/]+\/rule-facts\.json$/, "knowledge-rule-facts"],
  [/^artifacts\/[^/]+\/knowledge\/sources\/index\.json$/, "knowledge-source-cache"],
  [/^artifacts\/[^/]+\/knowledge\/inputs\.json$/, null],
  [/^artifacts\/[^/]+\/modules\/[^/]+\/explore\/sitemap\.json$/, "sitemap"],
  [/^artifacts\/[^/]+\/modules\/[^/]+\/explore\/model\.json$/, "explore-model"],
  [/^artifacts\/[^/]+\/modules\/[^/]+\/explore\/coverage\.json$/, "explore-coverage"],
  [/^artifacts\/[^/]+\/modules\/[^/]+\/explore\/interactions\.json$/, "interactions"],
  [/^artifacts\/[^/]+\/modules\/[^/]+\/explore\/overlay\.json$/, "explore-overlay"],
  [/^artifacts\/[^/]+\/modules\/[^/]+\/explore\/network-inventory\.json$/, "network-inventory"],
  [/^artifacts\/[^/]+\/modules\/[^/]+\/explore\/(?:new-questions\.json|log\.jsonl|registry\/[^/]+\.json)$/, null],
  [/^artifacts\/[^/]+\/modules\/[^/]+\/testcases\/cases\.json$/, "testcases-overlay"],
  [/^artifacts\/[^/]+\/modules\/[^/]+\/testcases\/coverage\.json$/, "testcases-coverage"],
  [/^artifacts\/[^/]+\/modules\/[^/]+\/testcases\/approvals\.json$/, "testcases-approvals"],
  [/^artifacts\/[^/]+\/modules\/[^/]+\/testcases\/registry\/[^/]+\.json$/, null],
  [/^artifacts\/[^/]+\/results\/[^/]+\/report\/report\.json$/, "report"],
  [/^artifacts\/[^/]+\/results\/[^/]+\/report\/narrative\.json$/, "report-narrative"],
  [/^artifacts\/[^/]+\/results\/[^/]+\/(?:manifest\.json|report\/report-check\.json)$/, null],
];

const filesOf = (root, rel = "") =>
  readdirSync(path.join(root, rel), { withFileTypes: true }).flatMap((d) => {
    const r = rel ? `${rel}/${d.name}` : d.name;
    return d.isDirectory() ? filesOf(root, r) : [r];
  });

// The frozen workspace in a temp folder, migrated to this release's contract when it is older.
async function workspaceFrom(fixture) {
  const root = realpathSync.native(mkdtempSync(path.join(tmpdir(), `atf-${fixture}-`)));
  cpSync(path.join(FIXTURES, fixture), root, { recursive: true });
  const contract = Number(fixture.split("-")[1]);
  assert.ok(contract <= CONTRACT_VERSION, `${fixture} is newer than this release's contract ${CONTRACT_VERSION}`);
  if (contract < CONTRACT_VERSION) {
    const lines = [];
    const code = await migrateWorkspace({ workspace: root, framework: frameworkRoot }, { log: (m) => lines.push(m), error: (m) => lines.push(m) });
    assert.equal(code, 0, `${fixture} must migrate with the package's own steps:\n${lines.join("\n")}`);
  }
  return root;
}

// a framework script in a child node, in the workspace, as an agent runs it -> { code, out (parsed JSON) }
const script = (root, args, env = {}) => {
  const r = spawnSync(process.execPath, [path.join(frameworkRoot, "scripts", args[0]), ...args.slice(1)], { cwd: root, env: { ...process.env, ATF_WORKSPACE: root, ATF_ENV: "", ...env }, encoding: "utf8" });
  let out;
  try {
    out = JSON.parse(r.stdout);
  } catch {
    out = r.stdout + r.stderr;
  }
  return { code: r.status, out };
};

test("there is a frozen workspace for this release's contract", () => {
  assert.ok(fixtures.includes(`contract-${CONTRACT_VERSION}`), `add scripts/fixtures/workspaces/contract-${CONTRACT_VERSION}/ (its README says how)`);
});

for (const fixture of fixtures) {
  test(`${fixture}: atf version and the doctor read the workspace's contract as this release's`, async () => {
    const root = await workspaceFrom(fixture);
    const info = versionInfo({ workspace: root, framework: frameworkRoot });
    assert.deepEqual([info.workspace.contract, info.workspace.recorded, info.workspace.problem], [CONTRACT_VERSION, true, undefined]);
    assert.match(plan(["version"], { workspace: root, framework: frameworkRoot, env: {} }).print, new RegExp(`^workspace contract: ${CONTRACT_VERSION} \\(atf/atf\\.json\\)$`, "m"));
    const check = (await runChecks({}, ["base"], { root, framework: frameworkRoot })).find((c) => c.id === "workspace-contract");
    assert.deepEqual([check.ok, check.detail], [true, `artifact contract ${CONTRACT_VERSION}`]);
  });

  test(`${fixture}: run.mjs status, next and validate read the ended run in every environment`, async () => {
    const root = await workspaceFrom(fixture);
    const status = script(root, ["run.mjs", "status", "acme"]);
    assert.equal(status.code, 0, JSON.stringify(status.out));
    assert.equal(status.out.active, false);
    const chosen = status.out.stages.filter((s) => !s.notChosen);
    assert.ok(chosen.length >= 4, "the frozen run chose stages");
    for (const s of chosen) assert.deepEqual([`${s.module ?? "_product"}/${s.stage}`, s.status, s.complete, s.problems], [`${s.module ?? "_product"}/${s.stage}`, "done", true, []], "a stage the frozen run completed still verifies");
    const next = script(root, ["run.mjs", "next", "acme"]);
    assert.deepEqual([next.code, next.out], [0, { actions: [], end: { outcome: "no-active-run" } }]);
    for (const env of ["", "staging"]) {
      const v = script(root, ["run.mjs", "validate", "acme"], { ATF_ENV: env });
      assert.deepEqual([v.code, v.out], [0, { valid: true, problems: [] }], `validate${env ? ` (ATF_ENV=${env})` : ""}`);
    }
    const staging = script(root, ["run.mjs", "status", "acme"], { ATF_ENV: "staging" });
    assert.equal(staging.code, 0);
    assert.deepEqual([staging.out.runId, staging.out.active], ["acme-staging-run-1", false]);
  });

  test(`${fixture}: every JSON file passes its schema, and every one is accounted for`, async () => {
    const root = await workspaceFrom(fixture);
    const json = filesOf(root).filter((f) => /\.jsonl?$/.test(f));
    const unnamed = json.filter((f) => !SCHEMAS.some(([re]) => re.test(f)));
    assert.deepEqual(unnamed, [], "a JSON file no rule in SCHEMAS names: give it its schema, or null");
    let validated = 0;
    for (const f of json) {
      const schema = SCHEMAS.find(([re]) => re.test(f))[1];
      const text = readFileSync(path.join(root, f), "utf8");
      const docs = f.endsWith(".jsonl") ? text.split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [JSON.parse(text)];
      if (!schema) continue;
      for (const [i, d] of docs.entries()) assert.deepEqual(await validateData(schema, d), [], `${f}${docs.length > 1 ? `:${i + 1}` : ""} (${schema})`);
      validated++;
    }
    assert.ok(validated >= 15, `${validated} files validated`);
  });

  test(`${fixture}: the decision lookup reads the workspace's own log`, () => {
    const root = path.join(FIXTURES, fixture); // read only
    const r = decisions(["for", "config/acme.yaml"], { root, cwd: root });
    assert.equal(r.code, 0);
    assert.equal(r.out.log, "atf/decisions.md");
    assert.deepEqual(r.out.files[0].decisions.map((d) => d.id), ["D-001"]);
    assert.ok(decisions(["index"], { root, cwd: root }).out.accepted.length >= 1);
  });

  test(`${fixture}: report-data collects the frozen run into a report.json this release accepts`, async () => {
    const root = await workspaceFrom(fixture);
    const run = JSON.parse(readFileSync(path.join(root, "artifacts/acme/state/run.json"), "utf8"));
    const frozen = JSON.parse(readFileSync(path.join(root, `artifacts/acme/results/${run.runId}/report/report.json`), "utf8"));
    const data = await collect("acme", { root });
    assert.deepEqual(await validateData("report", data), []);
    assert.deepEqual([data.product, data.runId, data.provenance], [frozen.product, frozen.runId, frozen.provenance]);
    // the same totals from the same artifacts, but for what changed after the report (generate.mjs): the ledger entry
    // the run left, and the two cases a human approved between runs
    const { approvals, assumptions, ...rest } = data.totals;
    const { approvals: a0, assumptions: s0, ...frozenRest } = frozen.totals;
    assert.deepEqual(rest, frozenRest);
    assert.deepEqual(approvals, { ...a0, approved: a0.approved + 2, awaiting: a0.awaiting - 2 });
    assert.deepEqual(assumptions, { ...s0, k6Leftovers: s0.k6Leftovers + 1 });
  });

  test(`${fixture}: nothing is left to migrate, and atf sync then atf check accept the workspace's atf/`, async () => {
    const root = await workspaceFrom(fixture);
    const lines = [];
    assert.equal(await migrateWorkspace({ workspace: root, framework: frameworkRoot, dryRun: true }, { log: (m) => lines.push(m), error: (m) => lines.push(m) }), 0);
    assert.deepEqual(lines, [`atf migrate --dry-run: nothing to migrate: the workspace is on artifact contract ${CONTRACT_VERSION}, this framework's.`]);
    // the host files are never part of a workspace's history (git-ignored): rendered here, then checked
    assert.deepEqual(sync({ workspace: root, framework: frameworkRoot }).errors, []);
    const check = sync({ workspace: root, framework: frameworkRoot, check: true });
    assert.deepEqual([check.errors, check.changed, check.problems ?? []], [[], [], []]);
  });
}
