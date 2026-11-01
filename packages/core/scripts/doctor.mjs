#!/usr/bin/env node
// Dependency check for a human's terminal (atf doctor | login | run | resume | automate), over scripts/lib/doctor.mjs
// (D-064). Works before a run exists; inside a run the orchestrator uses `run.mjs doctor <product>` instead, which
// records the result for `stage … start`.
//
//   doctor.mjs <config.yaml> [--stage all|<stage>[,<stage>…]] [--for login] [--fix] [--warn-only] [--json]
//   doctor.mjs --machine [--fix] [--json]
//     --stage      the stages to check for (default: every stage the run-config's steps choose, see
//                  lib/contract.mjs chosenStages); --for login checks what `atf login` needs instead
//     --fix        run the installs first (npm install, npx playwright install chromium, in the framework or the
//                  product's Playwright repo; k6 through winget on Windows or Homebrew on macOS), then check again.
//                  Never edits a config, session or credential file.
//     --warn-only  report problems but exit 0 (atf run: the run's own stage gate stops exactly the stage that needs them)
//     --machine    no run-config: what this machine needs for any product (MACHINE_GROUPS: Node.js, the framework's
//                  dependencies, the login browser, the browser server, k6). A missing k6 only warns, since only a run
//                  with the k6 step needs it, and --fix leaves it alone (D-110)
// Exit: 0 ok, 1 a blocking problem (or an invalid run-config), 2 usage.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import yaml from "js-yaml";
import { validateRunConfig } from "./run-config.mjs";
import { STAGES, chosenStages, deriveCaseTypes, frameworkRoot, workspaceRoot } from "./lib/contract.mjs";
import { LOGIN_NEEDS, MACHINE_GROUPS, STAGE_NEEDS, failures, groupsFor, runChecks } from "./lib/doctor.mjs";
import { spawnEnv } from "./lib/npm-env.mjs";

const USAGE = "usage: doctor.mjs <config.yaml> [--stage all|<stage>[,<stage>…]] [--for login] [--fix] [--warn-only] [--json] | doctor.mjs --machine [--fix] [--json]";
// The run-config a machine check stands on: no product, no login, so no check reads one.
const NO_CONFIG = Object.freeze({ product: null, authorizations: {} });

// cfg (a normalized run-config): without --stage, only the stages its steps choose are checked; a stage it does not choose
// never reports a problem as blocking.
export function scope(v, cfg) {
  if (v.machine) return v.for || v.stage ? { error: "--machine takes no --for or --stage" } : { label: "this machine", groups: MACHINE_GROUPS, stages: [], machine: true };
  if (v.for === "login") return { label: "atf login", groups: LOGIN_NEEDS, stages: [] };
  if (v.for) return { error: `unknown --for ${v.for} (only: login)` };
  const all = !v.stage || v.stage === "all";
  if (all && cfg?.steps) {
    const chosen = chosenStages({ steps: cfg.steps, caseTypes: deriveCaseTypes(cfg.steps, cfg.testcases?.types) });
    const stages = Object.keys(STAGES).filter((s) => chosen.has(s));
    return { label: "every chosen stage", groups: groupsFor(stages), stages };
  }
  const stages = all ? Object.keys(STAGES) : v.stage.split(",").map((s) => s.trim()).filter(Boolean);
  const unknown = stages.filter((s) => !STAGES[s]);
  if (unknown.length) return { error: `unknown stage(s) ${unknown.join(", ")} (one of ${Object.keys(STAGES).join(", ")})` };
  return { label: v.stage && v.stage !== "all" ? stages.join(", ") : "every stage", groups: groupsFor(stages), stages };
}

// A machine check's k6: a warning, never a failure, and nothing --fix installs (only a run with the k6 step needs it).
export const machineChecks = (checks) =>
  checks.map(({ autofix, ...c }) => (c.group !== "k6" ? { ...c, ...(autofix ? { autofix } : {}) } : c.ok ? c : { ...c, ok: true, level: "warn", detail: `${c.detail} (needed only for k6 load tests)` }));

// The distinct installs the failing checks ask for, in order.
export function autofixSteps(checks) {
  const seen = new Set();
  const steps = [];
  for (const c of failures(checks)) for (const s of c.autofix?.steps ?? (c.autofix ? [c.autofix] : [])) {
    const key = JSON.stringify(s);
    if (!seen.has(key)) seen.add(key), steps.push(s);
  }
  return steps;
}

export function render(checks, sc) {
  const lines = [`Dependency check for ${sc.label}:`];
  for (const c of checks) {
    const tag = !c.ok ? "FAIL" : c.level === "warn" ? "warn" : " ok ";
    lines.push(`  [${tag}] ${c.detail}`);
    if ((!c.ok || c.level === "warn") && c.fix) lines.push(`         fix: ${c.fix}`);
  }
  const bad = failures(checks);
  if (!bad.length) lines.push("All set.");
  else if (sc.stages.length) {
    const blocked = sc.stages.filter((s) => failures(checks, STAGE_NEEDS[s]).length);
    lines.push(`Blocked until fixed: ${blocked.join(", ")}.`);
  } else lines.push("Fix the problems above, then run it again.");
  return lines.join("\n");
}

export async function main(argv, { root = workspaceRoot, framework = frameworkRoot, exec, log = console.log, check = runChecks } = {}) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, options: { stage: { type: "string" }, for: { type: "string" }, fix: { type: "boolean" }, "warn-only": { type: "boolean" }, json: { type: "boolean" }, machine: { type: "boolean" } } });
  } catch (e) {
    log(`${e.message}\n${USAGE}`);
    return 2;
  }
  const { values: v, positionals: [file] } = parsed;
  if (!file === !v.machine) return log(USAGE), 2;
  let sc = scope(v);
  if (sc.error) return log(`${sc.error}\n${USAGE}`), 2;
  let cfg = NO_CONFIG;
  if (!v.machine) {
    try {
      const r = validateRunConfig(yaml.load(readFileSync(file, "utf8")), { root });
      if (r.errors?.length) return log(`${file} is not a valid run-config:\n  ${r.errors.join("\n  ")}`), 1;
      cfg = r.normalized;
    } catch (e) {
      return log(`cannot read ${file}: ${e.message}`), 1;
    }
    sc = scope(v, cfg);
  }
  const checkAll = async () => {
    const checks = await check(cfg, sc.groups, { root, framework });
    return sc.machine ? machineChecks(checks) : checks;
  };

  let checks = await checkAll();
  const steps = v.fix ? autofixSteps(checks) : [];
  if (steps.length) {
    // npm and npx without an allow-scripts setting npx exported to this process (lib/npm-env.mjs, D-108)
    const run = exec ?? ((s) => spawnSync(s.cmd, s.args, { cwd: s.cwd, env: spawnEnv(s.cmd), stdio: "inherit", shell: process.platform === "win32" }).status === 0);
    for (const s of steps) {
      log(`Fixing: ${s.cmd} ${s.args.join(" ")}  (in ${s.cwd})`);
      if (!run(s)) log(`  that command failed; see its output above`);
      else if (s.newTerminal) log("  installed: open a new terminal so its PATH includes it");
    }
    checks = await checkAll();
  }
  // --json: each check as the doctor found it, `fixable` when --fix would install something for it (the extension offers
  // its Fix button then)
  log(v.json ? JSON.stringify({ scope: sc.label, checks: checks.map(({ autofix, ...c }) => ({ ...c, ...(autofix ? { fixable: true } : {}) })), fixed: steps.map((s) => `${s.cmd} ${s.args.join(" ")}`) }, null, 2) : render(checks, sc));
  return failures(checks).length && !v["warn-only"] ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
