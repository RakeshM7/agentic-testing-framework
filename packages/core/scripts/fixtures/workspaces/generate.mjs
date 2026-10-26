#!/usr/bin/env node
// Generates a frozen workspace fixture (README.md here): a client's workspace as this release writes it, made by the
// real scripts with the offline pipeline's stand-in agents (scripts/pipeline.test.mjs, D-084). Run it only when a
// contract bump adds a new fixture, never to refresh an old one: an old fixture is what an earlier release wrote, and
// regenerating it with later code would test nothing.
//
//   node packages/core/scripts/fixtures/workspaces/generate.mjs <out dir>     (the folder must not exist yet)
//
// What it does, offline (no model, browser or network):
//   - a client workspace with the framework installed (test-helpers installedWorkspace), atf/atf.json recording this
//     release's contract, and the run-configs config/acme.yaml (steps: explore, testcases) and config/acme-staging.yaml
//     (D-081)
//   - one run driven through run.mjs next to its end: the knowledge, the fixture module's exploration (with its
//     clarifications CSV), the test cases (built and checked), the report; a ledger entry; the run ended (its history
//     and manifest); then two cases approved by a stand-in human between runs
//   - a run in the staging environment, started and abandoned, so envs/staging/state/ exists
//   - the workspace's atf/ (atf.json, and the decision log with one house rule), config/*.yaml and artifacts/ copied to
//     <out dir>, and nothing else
// The clock is fixed, so no timestamp depends on the day it ran, and the copy is checked for absolute paths.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONTRACT_VERSION, paths } from "../../lib/contract.mjs";
import { parseCsv, serializeCsv } from "../../lib/csv.mjs";
import { GROUPS, recordDoctor } from "../../lib/doctor.mjs";
import { writeJson } from "../../lib/files.mjs";
import { recordCanary } from "../../lib/guard-check.mjs";
import { append as appendLedger } from "../../lib/ledger.mjs";
import { reportPaths } from "../../lib/report.mjs";
import { expandFw } from "../../lib/roots.mjs";
import { collect } from "../../report-data.mjs";
import { main as report } from "../../report.mjs";
import { endRun, initRun, nextStep, setStage } from "../../run.mjs";
import { main as testcases } from "../../testcases.mjs";
import { INSTALLED_PACKAGE, exploreFixture, exploreSession, finishExploration, installedWorkspace, put, writeConfig, writeModuleKnowledge, writeProductKnowledge } from "../../test-helpers.mjs";

// every `new Date()` and Date.now() is this instant
const FIXED = Date.parse("2026-10-01T09:00:00.000Z");
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...args) {
    if (args.length) super(...args);
    else super(FIXED);
  }
  static now() {
    return FIXED;
  }
};

const fail = (what, x) => {
  throw new Error(`${what}: ${typeof x === "string" ? x : JSON.stringify(x)}`);
};
const promptArgs = (prompt) => Object.fromEntries(prompt.split(" ").map((kv) => kv.split("=")));

// testcases.mjs on the fixture module, with a stand-in human at a terminal who types the module slug to confirm
const tc = (root, cmd) => testcases([cmd, "acme", "contacts"], { root, interactive: { isTTY: true, ask: async () => "contacts" } });

// The writer's cases, built and checked: one per coverage item the exploration gives (one behavior per case).
async function writeCases(root) {
  const cases = (await tc(root, "items")).out.items.map((it, i) => ({
    key: `contacts-${i + 1}`,
    title: `Contacts ${it.technique} item ${i + 1} behaves as observed`,
    type: "functional",
    priority: "p2",
    action: "the user opens the New contact dialog",
    steps: ["Open Contacts", "Click New contact"],
    expected: "the New contact dialog opens",
    covers: [it.id],
    evidence: ["observation:explore/flows/create-contact.md"],
  }));
  put(root, "artifacts/acme/modules/contacts/testcases/cases.json", JSON.stringify({ cases }, null, 2));
  for (const cmd of ["build", "check"]) {
    const r = await tc(root, cmd);
    if (r.code) fail(`testcases ${cmd}`, r.out);
  }
}

// A human's sign-off of the first two cases: approval.csv edited, then recorded at a terminal.
async function signOffTwo(root) {
  const sheet = path.join(root, "artifacts/acme/modules/contacts/testcases/approval.csv");
  const rows = parseCsv(readFileSync(sheet, "utf8"));
  const col = rows[0].indexOf("Approved");
  rows[1][col] = "yes";
  rows[2][col] = "yes";
  writeFileSync(sheet, serializeCsv(rows));
  const r = await tc(root, "approve");
  if (r.code) fail("sign-off", r.out);
}

function standIns(root) {
  return {
    "knowledge-generator": ({ pass, module }) => (pass === "product" ? writeProductKnowledge(root) : writeModuleKnowledge(root, module)),
    "module-explorer": async ({ module }) => {
      const s = exploreSession(root);
      finishExploration(s, await exploreFixture(s));
      await s.ex("ingest-network", "acme", module, "--file", s.cap("network-requests.txt"));
      const c = await s.ex("check", "acme", module);
      if (c.out.problems?.length) fail("explore check", c.out.problems);
    },
    // the writer's cases (the domain's review loop is its own, and leaves nothing this fixture needs)
    "testcase-orchestrator": () => writeCases(root),
    "report-generator": async ({ product, run }) => {
      const rp = reportPaths(paths(product, root).productDir, run);
      writeJson(rp.report, await collect(product, { root }));
      writeJson(rp.narrative, { executiveSummary: [{ text: "The run explored the contacts module.", cites: ["modules[module=contacts].explored"] }], risks: [], recommendations: [] });
      if ((await report(["render", product], { root })).code) fail("report render", "");
      const checked = await report(["check", product], { root });
      if (checked.code) fail("report check", checked.out);
    },
  };
}

export async function generate(out) {
  if (existsSync(out)) fail("generate", `${out} exists; give a new folder`);
  const { root, framework } = installedWorkspace();
  rmSync(path.join(root, "atf"), { recursive: true, force: true }); // the client fixture's overlay: not part of this one
  // atf/ as atf init writes it, the decision log with one house rule a human recorded
  put(root, "atf/atf.json", JSON.stringify({ contract: CONTRACT_VERSION }, null, 2) + "\n");
  const log = expandFw(readFileSync(path.join(framework, "templates", "workspace", "decisions.md"), "utf8"), INSTALLED_PACKAGE).replace(
    "|---|---|---|---|\n",
    "|---|---|---|---|\n| D-001 | The acme run-config stays readonly | Accepted | 2026-10-01 |\n"
  );
  put(root, "atf/decisions.md", `${log}
### D-001 · The acme run-config stays readonly
- **Status:** Accepted · **Date:** 2026-10-01 · **Source:** the test lead, 2026-10-01
- **Decision:** \`config/acme.yaml\` keeps \`authorizations.mode: readonly\`; a full run uses a run-config of its own.
- **Why:** the acme target is shared with the sales team's demo data.
- **Affects:** \`config/acme.yaml\`
`);
  const cfg = writeConfig(root, { extra: ["steps: [explore, testcases]"], modules: ["contacts"] });

  const started = initRun(cfg, { root, framework, runId: "acme-run-1", env: { CLAUDECODE: "1" } });
  if (started.errors) fail("init", started.errors);
  recordCanary("acme", root, { host: "claude-code", agent: "orchestrator-agent" });
  recordDoctor("acme", root, { groups: GROUPS, checks: [] });
  const agents = standIns(root);
  let end;
  for (let round = 0; round < 20 && !end; round++) {
    const r = await nextStep("acme", { root });
    if (r.end) end = r.end;
    for (const a of r.actions ?? []) {
      if (!agents[a.agent]) fail("no stand-in for", a);
      if ((await setStage("acme", a.stage, a.module, "start", undefined, { root })).errors) fail("start", a);
      await agents[a.agent](promptArgs(a.prompt));
      const done = await setStage("acme", a.stage, a.module, "done", undefined, { root });
      if (done.errors?.length) fail(`${a.stage} done`, done.errors);
    }
  }
  if (end?.outcome !== "completed") fail("run", end);
  // what a full-run test leaves in the target: one created entity, recorded as the generated code records it
  appendLedger(paths("acme", root).ledgerFile, { runId: "acme-run-1", event: "created", type: "contact", ref: "c-1001", label: "ATF contact 1", module: "contacts", stage: "playwright-ui", agent: "pw-ui-test-runner-triager" });
  const ended = await endRun("acme", { root });
  if (ended.outcome !== "completed") fail("end", ended);
  await signOffTwo(root);

  // another environment of the product (D-081): its own run state, from a run started and abandoned
  const staging = path.join(root, "config", "acme-staging.yaml");
  writeFileSync(staging, readFileSync(cfg, "utf8").replace(/^product: acme$/m, "product: acme\nenvironment: staging"));
  const s = initRun(staging, { root, framework, runId: "acme-staging-run-1", env: { CLAUDECODE: "1", ATF_ENV: "staging" } });
  if (s.errors) fail("init staging", s.errors);
  const was = process.env.ATF_ENV;
  process.env.ATF_ENV = "staging"; // endRun's paths() read the session's environment
  try {
    const e = await endRun("acme", { root, abandon: true });
    if (e.errors) fail("end staging", e.errors);
  } finally {
    if (was === undefined) delete process.env.ATF_ENV;
    else process.env.ATF_ENV = was;
  }

  mkdirSync(out, { recursive: true });
  for (const rel of ["atf/atf.json", "atf/decisions.md", "config/acme.yaml", "config/acme-staging.yaml", "artifacts"]) cpSync(path.join(root, rel), path.join(out, rel), { recursive: true });
  const leaks = new Set();
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else {
        const text = readFileSync(p, "utf8");
        for (const abs of [root, framework, path.dirname(root)]) if (text.includes(abs) || text.includes(abs.replaceAll("\\", "/")) || text.includes(JSON.stringify(abs).slice(1, -1))) leaks.add(path.relative(out, p));
      }
    }
  };
  walk(out);
  rmSync(root, { recursive: true, force: true });
  if (leaks.size) fail("absolute paths in", [...leaks]);
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) {
    console.error("usage: generate.mjs <out dir>");
    process.exit(2);
  }
  console.log(`wrote ${await generate(path.resolve(process.argv[2]))}`);
}
