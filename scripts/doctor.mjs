#!/usr/bin/env node
// Dependency check for a human's terminal (make doctor | login | run | resume | automate), over scripts/lib/doctor.mjs
// (D-064). Works before a run exists; inside a run the orchestrator uses `run.mjs doctor <product>` instead, which
// records the result for `stage … start`.
//
//   doctor.mjs <config.yaml> [--stage all|<stage>[,<stage>…]] [--for login] [--fix] [--warn-only] [--json]
//     --stage      the stages to check for (default all); --for login checks what `make login` needs instead
//     --fix        run the installs first (npm install, npx playwright install chromium, in the framework or the
//                  product's Playwright repo; k6 through winget on Windows or Homebrew on macOS), then check again.
//                  Never edits a config, session or credential file.
//     --warn-only  report problems but exit 0 (make run: the run's own stage gate stops exactly the stage that needs them)
// Exit: 0 ok, 1 a blocking problem (or an invalid run-config), 2 usage.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import yaml from "js-yaml";
import { validateRunConfig } from "./run-config.mjs";
import { STAGES, repoRoot } from "./lib/contract.mjs";
import { LOGIN_NEEDS, STAGE_NEEDS, failures, groupsFor, runChecks } from "./lib/doctor.mjs";

const USAGE = "usage: doctor.mjs <config.yaml> [--stage all|<stage>[,<stage>…]] [--for login] [--fix] [--warn-only] [--json]";

export function scope(v) {
  if (v.for === "login") return { label: "make login", groups: LOGIN_NEEDS, stages: [] };
  if (v.for) return { error: `unknown --for ${v.for} (only: login)` };
  const stages = !v.stage || v.stage === "all" ? Object.keys(STAGES) : v.stage.split(",").map((s) => s.trim()).filter(Boolean);
  const unknown = stages.filter((s) => !STAGES[s]);
  if (unknown.length) return { error: `unknown stage(s) ${unknown.join(", ")} (one of ${Object.keys(STAGES).join(", ")})` };
  return { label: v.stage && v.stage !== "all" ? stages.join(", ") : "every stage", groups: groupsFor(stages), stages };
}

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

export async function main(argv, { root = repoRoot, exec, log = console.log, check = runChecks } = {}) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, options: { stage: { type: "string" }, for: { type: "string" }, fix: { type: "boolean" }, "warn-only": { type: "boolean" }, json: { type: "boolean" } } });
  } catch (e) {
    log(`${e.message}\n${USAGE}`);
    return 2;
  }
  const { values: v, positionals: [file] } = parsed;
  if (!file) return log(USAGE), 2;
  const sc = scope(v);
  if (sc.error) return log(`${sc.error}\n${USAGE}`), 2;
  let cfg;
  try {
    const r = validateRunConfig(yaml.load(readFileSync(file, "utf8")));
    if (r.errors?.length) return log(`${file} is not a valid run-config:\n  ${r.errors.join("\n  ")}`), 1;
    cfg = r.normalized;
  } catch (e) {
    return log(`cannot read ${file}: ${e.message}`), 1;
  }

  let checks = await check(cfg, sc.groups, { root });
  const steps = v.fix ? autofixSteps(checks) : [];
  if (steps.length) {
    const run = exec ?? ((s) => spawnSync(s.cmd, s.args, { cwd: s.cwd, stdio: "inherit", shell: process.platform === "win32" }).status === 0);
    for (const s of steps) {
      log(`Fixing: ${s.cmd} ${s.args.join(" ")}  (in ${s.cwd})`);
      if (!run(s)) log(`  that command failed; see its output above`);
      else if (s.newTerminal) log("  installed: open a new terminal so its PATH includes it");
    }
    checks = await check(cfg, sc.groups, { root });
  }
  log(v.json ? JSON.stringify({ scope: sc.label, checks: checks.map(({ autofix, ...c }) => c), fixed: steps.map((s) => `${s.cmd} ${s.args.join(" ")}`) }, null, 2) : render(checks, sc));
  return failures(checks).length && !v["warn-only"] ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
