// atf migrate (docs/packaging.md §3.10, scripts/lib/migrate.mjs): the step format, the chain, the dry run, the lock, the
// backup, the records, a failing step, and a run that resumes afterwards. The package ships no step yet (the contract
// is 2), so every test injects its own: synthetic steps over temp workspaces apart from the framework.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { plan, run } from "./lib/cli.mjs";
import { CONTRACT_VERSION, paths } from "./lib/contract.mjs";
import { BACKUP_ROOT, MIGRATION_LOCK, MIGRATION_LOG, loadSteps, migrateRefusal, migrateWorkspace, stateDirs, stepChain, withContract } from "./lib/migrate.mjs";
import { frameworkRoot } from "./lib/roots.mjs";
import { initRun } from "./run.mjs";
import { installedWorkspace, put, tempRoot, writeConfig } from "./test-helpers.mjs";

const PKG = { name: "@testagentic/atf", version: "9.9.9" };
const read = (root, rel) => readFileSync(path.join(root, rel), "utf8");
const json = (root, rel) => JSON.parse(read(root, rel));
const records = (root) => read(root, MIGRATION_LOG).trim().split("\n").map((l) => JSON.parse(l));
// a collecting console: log and error lines, in order
const sink = () => {
  const lines = [];
  return { lines, out: { log: (m) => lines.push(m), error: (m) => lines.push(`error: ${m}`) }, text: () => lines.join("\n") };
};
// every file under `dir`, `/` paths, with their text: a snapshot to prove nothing was written
const snapshot = (dir) => {
  const out = {};
  const walk = (rel) => {
    for (const d of readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) walk(r);
      else out[r] = readFileSync(path.join(dir, r), "utf8");
    }
  };
  walk("");
  return out;
};

// A client's workspace on contract `contract`, apart from the framework: atf/atf.json, and run state for product acme
// in the default environment and in staging, each run.json on that contract (an older package wrote them).
function workspace(contract = 1, { marker = `{\n  "contract": ${contract},\n  "cloud_agent": false\n}\n` } = {}) {
  const root = realpathSync.native(mkdtempSync(path.join(tmpdir(), "atf-migrate-")));
  put(root, "atf/atf.json", marker);
  for (const state of ["artifacts/acme/state", "artifacts/acme/envs/staging/state"]) {
    put(root, `${state}/run.json`, JSON.stringify({ layoutVersion: contract, product: "acme", runId: "acme-run-1", stages: {} }, null, 2) + "\n");
    put(root, `${state}/history/acme-run-0.json`, '{"runId":"acme-run-0"}\n');
  }
  put(root, "artifacts/acme/modules/contacts/explore/sitemap.json", '{"pages":[]}\n');
  return root;
}

// Synthetic steps. 1-to-2 renames every module's sitemap.json to pages.json (writes the new file; the old one stays, a
// step can't delete) and stamps each history file; 2-to-3 adds a `migrated` marker to each run.json.
const step12 = {
  from: 1,
  to: 2,
  describe: "Copies each module's explore/sitemap.json to explore/pages.json",
  touches: ["artifacts/*/modules/*/explore/"],
  migrate({ files }) {
    for (const p of files.list("artifacts/"))
      for (const m of files.list(`artifacts/${p}modules/`)) {
        const text = files.read(`artifacts/${p}modules/${m}explore/sitemap.json`);
        if (text !== null) files.write(`artifacts/${p}modules/${m}explore/pages.json`, text);
      }
  },
};
const step23 = {
  from: 2,
  to: 3,
  describe: "Marks each run.json as migrated",
  touches: ["artifacts/*/state/run.json", "artifacts/*/envs/*/state/run.json"],
  migrate({ files }) {
    for (const rel of ["artifacts/acme/state/run.json", "artifacts/acme/envs/staging/state/run.json"]) {
      const run = JSON.parse(files.read(rel));
      files.write(rel, JSON.stringify({ ...run, migrated: true }, null, 2) + "\n");
    }
  },
};
const migrate = (root, opts = {}, out = sink().out) => migrateWorkspace({ workspace: root, framework: frameworkRoot, pkg: PKG, steps: [step12, step23], contract: 3, ...opts }, out);

test("nothing to migrate: the workspace is on this framework's contract (recorded, or not recorded and so 2)", async () => {
  for (const marker of [`{ "contract": ${CONTRACT_VERSION} }\n`, "{}\n"]) {
    const root = workspace(CONTRACT_VERSION, { marker });
    const before = snapshot(root);
    const s = sink();
    assert.equal(await migrateWorkspace({ workspace: root, framework: frameworkRoot }, s.out), 0);
    assert.equal(s.text(), `atf migrate: nothing to migrate: the workspace is on artifact contract ${CONTRACT_VERSION}, this framework's.`);
    assert.deepEqual(snapshot(root), before, "nothing written, no lock, no log");
    const d = sink();
    assert.equal(await migrateWorkspace({ workspace: root, framework: frameworkRoot, dryRun: true }, d.out), 0);
    assert.match(d.text(), /^atf migrate --dry-run: nothing to migrate/);
  }
});

test("a newer workspace is refused (install the newer package); an unreadable marker too; nothing is written", async () => {
  const root = workspace(4);
  const before = snapshot(root);
  const s = sink();
  assert.equal(await migrate(root, {}, s.out), 1);
  assert.match(s.text(), /^error: atf migrate: atf\/atf\.json records artifact contract 4, newer than this framework's 3: a newer @testagentic\/atf migrated this workspace.*A migration only goes forward; instead: install that newer @testagentic\/atf in the workspace/);
  assert.deepEqual(snapshot(root), before);
  put(root, "atf/atf.json", '{ "contract": "two" }');
  const bad = sink();
  assert.equal(await migrate(root, {}, bad.out), 1);
  assert.match(bad.text(), /"contract" must be a whole number of 1 or more.*Fix: correct atf\/atf\.json/);
});

test("a gap in the chain is refused, naming the missing step; broken steps are refused; nothing is written", async () => {
  const root = workspace(1);
  const before = snapshot(root);
  const s = sink();
  assert.equal(await migrate(root, { steps: [step23] }, s.out), 1);
  assert.match(s.text(), /^error: atf migrate: no migration step from artifact contract 1: migrations\/1-to-2\.mjs is missing from this package, so the workspace can't go from 1 to 3\./);
  const dry = sink();
  assert.equal(await migrate(root, { steps: [step12], dryRun: true }, dry.out), 1);
  assert.match(dry.text(), /migrations\/2-to-3\.mjs is missing/);
  assert.deepEqual(snapshot(root), before);
  // the pure chain
  assert.deepEqual(stepChain([step12, step23], 1, 3).chain, [step12, step23]);
  assert.match(stepChain([step12, { ...step12, describe: "again" }], 1, 2).error, /two migration steps start at artifact contract 1/);
  assert.match(stepChain([{ ...step12, to: 4 }], 1, 3).error, /goes past this framework's contract 3/);
  // a step that declares nothing, or a path outside artifacts/, is not a step
  for (const [bad, message] of [
    [{ ...step12, touches: [] }, /touches must list the paths under artifacts\//],
    [{ ...step12, touches: ["atf/atf.json"] }, /touches 'atf\/atf\.json' must be under artifacts\//],
    [{ ...step12, touches: ["artifacts/../x"] }, /must be a workspace-relative path/],
    [{ ...step12, touches: ["artifacts/acme*/state/"] }, /\* stands for one whole path segment/],
    [{ ...step12, describe: "" }, /describe must say/],
    [{ ...step12, to: 1 }, /to above from/],
  ]) {
    const b = sink();
    assert.equal(await migrate(root, { steps: [bad, step23] }, b.out), 1);
    assert.match(b.text(), message);
  }
  assert.deepEqual(snapshot(root), before);
});

test("the package's own steps: a folder of <from>-to-<to>.mjs files, checked against their names", async () => {
  // the shipped folder: a README and no step yet
  assert.deepEqual(await loadSteps(path.join(frameworkRoot, "migrations")), { steps: [], errors: [] });
  assert.ok(existsSync(path.join(frameworkRoot, "migrations", "README.md")));
  const dir = mkdtempSync(path.join(tmpdir(), "atf-steps-"));
  writeFileSync(path.join(dir, "1-to-2.mjs"), 'export const from = 1;\nexport const to = 2;\nexport const describe = "Does nothing";\nexport const touches = ["artifacts/*/state/"];\nexport function migrate() {}\n');
  writeFileSync(path.join(dir, "README.md"), "# not a step\n");
  const ok = await loadSteps(dir);
  assert.deepEqual([ok.errors, ok.steps.map((s) => [s.name, s.from, s.to])], [[], [["1-to-2", 1, 2]]]);
  writeFileSync(path.join(dir, "2-to-3.mjs"), 'export const from = 2;\nexport const to = 4;\nexport const describe = "x";\nexport const touches = ["artifacts/x/"];\nexport function migrate() {}\n');
  writeFileSync(path.join(dir, "helper.mjs"), "export {};\n");
  assert.deepEqual((await loadSteps(dir)).errors, ["migrations/2-to-3.mjs: exports from 2 and to 4, not what its name says", "migrations/helper.mjs: a step is named <from>-to-<to>.mjs"]);
});

test("--dry-run prints each step, the files it would write and the runs it would move, and writes nothing", async () => {
  const root = workspace(1);
  const before = snapshot(root);
  const s = sink();
  assert.equal(await migrate(root, { dryRun: true }, s.out), 0);
  assert.deepEqual(s.lines, [
    "atf migrate --dry-run: artifact contract 1 -> 3, 2 step(s); nothing is written",
    "  1-to-2: Copies each module's explore/sitemap.json to explore/pages.json",
    "    would write: artifacts/acme/modules/contacts/explore/pages.json",
    "    would set layoutVersion 2 in: artifacts/acme/state/run.json, artifacts/acme/envs/staging/state/run.json",
    "  2-to-3: Marks each run.json as migrated",
    // the second step sees the first one's result: the run.json files it reads already say layoutVersion 2
    "    would write: artifacts/acme/envs/staging/state/run.json, artifacts/acme/state/run.json",
    "    would set layoutVersion 3 in: artifacts/acme/state/run.json, artifacts/acme/envs/staging/state/run.json",
    `  then: atf/atf.json "contract": 3; before the first step, a backup of artifacts/acme/state, artifacts/acme/envs/staging/state and atf/atf.json in ${BACKUP_ROOT}/; a record per step in ${MIGRATION_LOG}`,
    "Run atf migrate (without --dry-run) to apply it. Stop every session of this workspace first.",
  ]);
  assert.deepEqual(snapshot(root), before, "no file, no lock, no backup, no log");
});

test("a two-step chain: backup, the steps' files, layoutVersion in every run.json, atf.json's contract, one record per step; a rerun has nothing to do", async () => {
  const root = workspace(1);
  const before = snapshot(root);
  const s = sink();
  assert.equal(await migrate(root, {}, s.out), 0);
  assert.match(s.lines[0], /^atf migrate: artifact contract 1 -> 3, 2 step\(s\)$/);
  assert.match(s.lines[1], new RegExp(`^ {2}backed up 2 run-state folder\\(s\\) and atf/atf\\.json to ${BACKUP_ROOT}/\\d{4}-\\d\\d-\\d\\dT\\d\\d-\\d\\d-\\d\\d-\\d{3}Z-1-to-3/$`));
  assert.equal(s.lines[2], "  1-to-2: Copies each module's explore/sitemap.json to explore/pages.json (1 file(s) changed; layoutVersion 2 in artifacts/acme/state/run.json, artifacts/acme/envs/staging/state/run.json)");
  assert.match(s.lines.at(-1), /the workspace is on artifact contract 3 \(atf\/atf\.json\); each step is recorded in artifacts\/migrations\.jsonl\. An active run continues/);

  // the backup holds the state as it was, at its path under artifacts/, and the marker
  const backup = s.lines[1].match(/to (\S+)\/$/)[1];
  for (const rel of Object.keys(before).filter((r) => r.includes("/state/"))) assert.equal(read(root, `${backup}/${rel.replace(/^artifacts\//, "")}`), before[rel], rel);
  assert.equal(read(root, `${backup}/atf.json`), before["atf/atf.json"]);
  assert.equal(existsSync(path.join(root, `${backup}/acme/modules`)), false, "only the run state");

  // the steps' files, every run.json on the new contract, the marker's other keys and formatting kept
  assert.equal(read(root, "artifacts/acme/modules/contacts/explore/pages.json"), '{"pages":[]}\n');
  for (const rel of ["artifacts/acme/state/run.json", "artifacts/acme/envs/staging/state/run.json"]) assert.deepEqual([json(root, rel).layoutVersion, json(root, rel).migrated], [3, true], rel);
  assert.equal(read(root, "atf/atf.json"), '{\n  "contract": 3,\n  "cloud_agent": false\n}\n');
  assert.equal(existsSync(path.join(root, MIGRATION_LOCK)), false, "the lock is released");

  const log = records(root);
  assert.deepEqual(log.map(({ at, ...r }) => r), [
    { step: "1-to-2", from: 1, to: 2, outcome: "done", package: PKG, backup, changed: ["artifacts/acme/modules/contacts/explore/pages.json"], runs: ["artifacts/acme/state/run.json", "artifacts/acme/envs/staging/state/run.json"] },
    { step: "2-to-3", from: 2, to: 3, outcome: "done", package: PKG, backup, changed: ["artifacts/acme/envs/staging/state/run.json", "artifacts/acme/state/run.json"], runs: ["artifacts/acme/state/run.json", "artifacts/acme/envs/staging/state/run.json"] },
  ]);
  assert.ok(log.every((r) => !Number.isNaN(Date.parse(r.at))));

  // again: nothing to migrate, nothing written
  const after = snapshot(root);
  const again = sink();
  assert.equal(await migrate(root, {}, again.out), 0);
  assert.match(again.text(), /nothing to migrate: the workspace is on artifact contract 3/);
  assert.deepEqual(snapshot(root), after);

  // idempotent: the same steps over a workspace they already migrated (as after a crash before the contract was
  // recorded) change no file
  put(root, "atf/atf.json", '{ "contract": 1 }\n');
  const files = snapshot(root);
  assert.equal(await migrate(root), 0);
  const redo = records(root).slice(-2);
  assert.deepEqual(redo.map((r) => [r.step, r.outcome, r.changed, r.runs]), [["1-to-2", "done", [], []], ["2-to-3", "done", [], []]]);
  for (const [rel, text] of Object.entries(files)) if (rel.startsWith("artifacts/acme/")) assert.equal(read(root, rel), text, rel);
  assert.equal(json(root, "atf/atf.json").contract, 3);
});

test("a step that writes outside what it declares, or is not idempotent, fails before anything of it lands", async () => {
  const outside = { ...step12, migrate: ({ files }) => files.write("artifacts/acme/state/run.json", "{}") };
  const reserved = { ...step12, touches: ["artifacts/*"], migrate: ({ files }) => files.write("artifacts/migrations.jsonl", "") };
  const counter = { ...step23, from: 1, to: 2, migrate: ({ files }) => files.write("artifacts/acme/state/run.json", `${files.read("artifacts/acme/state/run.json")} `) };
  for (const [bad, message] of [
    [outside, /1-to-2: write 'artifacts\/acme\/state\/run\.json' is outside what the step declares \(touches: artifacts\/\*\/modules\/\*\/explore\/\)/],
    [reserved, /1-to-2: write 'artifacts\/migrations\.jsonl' is outside what the step declares/],
    [counter, /1-to-2 is not idempotent: run again over its own result, it changes artifacts\/acme\/state\/run\.json/],
  ]) {
    const root = workspace(1);
    const before = snapshot(root);
    const s = sink();
    assert.equal(await migrate(root, { steps: [bad, step23] }, s.out), 1);
    assert.match(s.text(), message);
    for (const rel of Object.keys(before).filter((r) => r.startsWith("artifacts/acme/"))) assert.equal(read(root, rel), before[rel], rel);
    assert.equal(json(root, "atf/atf.json").contract, 1);
  }
});

test("a failing step: the workspace stays on the last completed contract, the record says so, the message names the backup; a fixed step then finishes it", async () => {
  const root = workspace(1);
  const broken = { ...step23, migrate: ({ files }) => {
    files.write("artifacts/acme/state/run.json", "{}");
    throw new Error("the run state has an unknown shape");
  } };
  const s = sink();
  assert.equal(await migrate(root, { steps: [step12, broken] }, s.out), 1);
  const backup = s.lines[1].match(/to (\S+)\/$/)[1];
  assert.match(s.text(), /error: {3}2-to-3: FAILED: the run state has an unknown shape/);
  assert.match(s.text(), new RegExp(`error: atf migrate: stopped at step 2-to-3\\. The workspace stays on artifact contract 2 \\(atf/atf\\.json records it; the steps before it are done\\), and artifacts/migrations\\.jsonl records the failure\\. None of the step's writes was made\\. The run state as it was before this migration is in ${backup}/\\.`));
  assert.equal(json(root, "atf/atf.json").contract, 2, "the completed step's contract");
  for (const rel of ["artifacts/acme/state/run.json", "artifacts/acme/envs/staging/state/run.json"]) assert.deepEqual([json(root, rel).layoutVersion, json(root, rel).migrated], [2, undefined], rel);
  assert.equal(read(root, "artifacts/acme/modules/contacts/explore/pages.json"), '{"pages":[]}\n', "the first step's work stays");
  assert.deepEqual(records(root).map((r) => [r.step, r.outcome, r.contract, r.error, r.backup]), [["1-to-2", "done", undefined, undefined, backup], ["2-to-3", "failed", 2, "the run state has an unknown shape", backup]]);
  assert.equal(existsSync(path.join(root, MIGRATION_LOCK)), false, "the lock is released on failure too");
  // with the step fixed, a rerun goes on from contract 2
  const fixed = sink();
  assert.equal(await migrate(root, {}, fixed.out), 0);
  assert.match(fixed.lines[0], /artifact contract 2 -> 3, 1 step\(s\)/);
  assert.equal(json(root, "atf/atf.json").contract, 3);
  assert.equal(json(root, "artifacts/acme/state/run.json").migrated, true);
});

test("the lock is exclusive: a second migrate fails at once, and a lock it did not take is left alone", async () => {
  const root = workspace(1);
  put(root, MIGRATION_LOCK, JSON.stringify({ pid: 4242, at: "2026-10-26T10:00:00.000Z" }));
  const before = snapshot(root);
  const s = sink();
  assert.equal(await migrate(root, {}, s.out), 1);
  assert.match(s.text(), /^error: atf migrate: another atf migrate holds artifacts\/\.migrate\.lock \(since 2026-10-26T10:00:00\.000Z, process 4242\)\. Wait for it to finish\. If none is running .* then delete artifacts\/\.migrate\.lock and run atf migrate again$/);
  assert.deepEqual(snapshot(root), before, "no backup, no step, the lock kept");

  // a migrate started while one runs (from inside a step, so it is mid-way for sure)
  const fresh = workspace(1);
  let inner;
  const nesting = { ...step12, async migrate(ctx) {
    if (!inner) {
      const s2 = sink();
      inner = { code: await migrate(fresh, {}, s2.out), text: s2.text() };
    }
    return step12.migrate(ctx);
  } };
  assert.equal(await migrate(fresh, { steps: [nesting, step23] }), 0);
  assert.equal(inner.code, 1);
  assert.match(inner.text, /another atf migrate holds artifacts\/\.migrate\.lock \(since .*, process \d+\)/);
  assert.equal(json(fresh, "atf/atf.json").contract, 3, "the first one finished");
});

test("refused in the framework's source checkout, as atf init refuses it; allowed for an installed framework and a workspace apart", async () => {
  assert.match(migrateRefusal({ workspace: path.resolve(frameworkRoot, "..", ".."), framework: frameworkRoot }), /holds the framework's source checkout .*atf migrate is for a client's workspace/);
  const one = workspace(1);
  put(one, "scripts/x.mjs", "");
  const s = sink();
  assert.equal(await migrateWorkspace({ workspace: one, framework: one, steps: [step12], contract: 2 }, s.out), 1, "one directory that is both");
  assert.match(s.text(), /source checkout/);
  assert.equal(json(one, "atf/atf.json").contract, 1);
  assert.equal(migrateRefusal({ workspace: one, framework: frameworkRoot }), null, "a workspace apart from the checkout");
  const installed = path.join(one, "node_modules", "@testagentic", "atf");
  mkdirSync(installed, { recursive: true });
  assert.equal(migrateRefusal({ workspace: one, framework: installed }), null, "the package installed in the workspace");
});

test("an active run resumes after the migration: init --resume no longer refuses on the contract", async () => {
  const root = tempRoot();
  put(root, "atf/atf.json", `{ "contract": ${CONTRACT_VERSION} }\n`);
  const cfg = writeConfig(root);
  assert.equal(initRun(cfg, { root, framework: root, runId: "acme-run-1", env: { CLAUDECODE: "1" } }).errors, undefined);
  // as an older package left it: the workspace and the active run on the contract before this one
  const runFile = paths("acme", root).runFile;
  put(root, "atf/atf.json", `{ "contract": ${CONTRACT_VERSION - 1} }\n`);
  writeFileSync(runFile, JSON.stringify({ ...JSON.parse(readFileSync(runFile, "utf8")), layoutVersion: CONTRACT_VERSION - 1 }, null, 2));
  const resume = () => initRun(cfg, { root, framework: root, resume: true });
  assert.match(resume().errors[0], /older than this framework's .*npx atf migrate/);
  const noop = { from: CONTRACT_VERSION - 1, to: CONTRACT_VERSION, describe: "Changes nothing", touches: ["artifacts/*/state/"], migrate() {} };
  assert.equal(await migrateWorkspace({ workspace: root, framework: frameworkRoot, steps: [noop], pkg: PKG }, sink().out), 0);
  assert.ok(existsSync(paths("acme", root).lockFile), "the run is still active");
  const r = resume();
  assert.equal(r.errors, undefined);
  assert.equal(r.resumed, true);
  assert.equal(r.run.layoutVersion, CONTRACT_VERSION);
  assert.deepEqual(stateDirs(root), ["artifacts/acme/state"]);
});

test("atf.json keeps its other keys and its formatting: the value replaced in place, or the key added first", () => {
  assert.equal(withContract('{\n  "contract": 1,\n  "decisions": "docs/log.md"\n}\n', 2), '{\n  "contract": 2,\n  "decisions": "docs/log.md"\n}\n');
  assert.equal(withContract('{ "decisions": "x.md", "cloud_agent": true }', 3), '{ "contract": 3, "decisions": "x.md", "cloud_agent": true }');
  assert.equal(withContract('{\r\n    "cloud_agent": true\r\n}\r\n', 2), '{\r\n    "contract": 2,\r\n    "cloud_agent": true\r\n}\r\n');
  assert.equal(withContract("{}\n", 2), '{\n  "contract": 2\n}\n');
  assert.equal(withContract('\ufeff{"contract":1}', 2), '\ufeff{"contract":2}', "an editor's BOM stays");
  // a "contract" nested before the top-level one: written again rather than changed in the wrong place
  assert.equal(withContract('{"x": {"contract": 5}, "contract": 1}\n', 2), '{\n  "x": {\n    "contract": 5\n  },\n  "contract": 2\n}\n');
});

test("atf migrate on the command line: strict, no --env, run in a child node on the workspace", () => {
  const root = workspace(CONTRACT_VERSION, { marker: "{}\n" });
  const ctx = { workspace: root, framework: frameworkRoot, env: {} };
  const p = plan(["migrate", "--dry-run"], ctx);
  assert.deepEqual(p.steps[0].args.slice(0, 2), ["--input-type=module", "-e"]);
  assert.deepEqual(p.steps[0].args.slice(-3), [root, frameworkRoot, "--dry-run"]);
  assert.equal(p.steps[0].cmd, process.execPath);
  assert.deepEqual(plan(["migrate"], ctx).steps[0].args.slice(-2), [root, frameworkRoot]);
  assert.match(plan(["migrate", "--dry"], ctx).error, /Unknown option '--dry'/);
  assert.match(plan(["migrate", "acme"], ctx).error, /^atf migrate: unexpected 'acme'$/);
  assert.match(plan(["migrate", "--env", "staging"], ctx).error, /takes no --env/);
  // the real child, its output captured: nothing to migrate, exit 0; a newer workspace, exit 1
  const seen = [];
  const spawn = (cmd, args, opts) => {
    const r = spawnSync(cmd, args, { ...opts, stdio: "pipe", encoding: "utf8" });
    seen.push(r.stdout + r.stderr);
    return r;
  };
  const quiet = { log() {}, error() {} };
  assert.equal(run(p, { workspace: root, spawn, out: quiet }), 0);
  assert.equal(seen[0], `atf migrate --dry-run: nothing to migrate: the workspace is on artifact contract ${CONTRACT_VERSION}, this framework's.\n`);
  put(root, "atf/atf.json", `{ "contract": ${CONTRACT_VERSION + 1} }`);
  assert.equal(run(plan(["migrate"], ctx), { workspace: root, spawn, out: quiet }), 1);
  assert.match(seen[1], /^atf migrate: atf\/atf\.json records artifact contract \d+, newer than this framework's/);
});

test("in a client's workspace, the installed atf migrates: its own bin, its own steps folder", () => {
  const { root, framework } = installedWorkspace();
  const atf = (...args) => spawnSync(process.execPath, [path.join(framework, "bin", "atf.mjs"), ...args], { cwd: root, env: { ...process.env, ATF_WORKSPACE: "" }, encoding: "utf8" });
  const dry = atf("migrate", "--dry-run");
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(dry.stdout, `atf migrate --dry-run: nothing to migrate: the workspace is on artifact contract ${CONTRACT_VERSION}, this framework's.\n`);
  put(root, "atf/atf.json", `{ "contract": ${CONTRACT_VERSION - 1} }\n`);
  const gap = atf("migrate");
  assert.equal(gap.status, 1);
  assert.match(gap.stderr, new RegExp(`no migration step from artifact contract ${CONTRACT_VERSION - 1}: migrations/${CONTRACT_VERSION - 1}-to-${CONTRACT_VERSION}\\.mjs is missing from this package`));
  assert.equal(existsSync(path.join(root, MIGRATION_LOCK)), false);
});
