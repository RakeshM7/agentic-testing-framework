// `atf migrate [--dry-run]` (docs/packaging.md §3.10, draft P-9): brings a workspace's artifacts from the artifact
// contract its atf/atf.json records (contract.mjs workspaceContract) to this framework's CONTRACT_VERSION, through the
// package's steps, migrations/<from>-to-<to>.mjs (migrations/README.md has the format and the rules). A human's
// command: it writes atf/atf.json, which no agent may (the guard's workspace-settings rule refuses `atf migrate` to the
// framework's agents, as it refuses `atf eject` and `atf init`).
//
//   same contract     "nothing to migrate", exit 0
//   newer contract    refused (exit 1): a later package migrated the workspace, so install that one; a migration only
//                     goes forward
//   older contract    the chain of steps from the workspace's contract to this one; a gap is an error naming the step
//                     that is missing, and nothing is written
//   --dry-run         the steps, the files each would change and the runs whose layoutVersion it would set; writes
//                     nothing (not even the lock)
//   otherwise         under an exclusive lock (MIGRATION_LOCK, created with O_EXCL: a second migrate fails at once):
//                       1. a backup of every artifacts/<product>/state/ and envs/<env>/state/, and atf/atf.json, into
//                          one timestamped folder under BACKUP_ROOT
//                       2. each step in order: its writes, then every run.json's layoutVersion (active runs included,
//                          so they resume afterwards; under the run lock, D-072), then atf/atf.json's "contract" (its
//                          other keys and its formatting kept as far as JSON allows), then a record in MIGRATION_LOG
//                       3. the lock released
//                     A step that fails leaves the workspace on the last completed contract: its own writes are held
//                     in memory until it returns, so none of them lands; atf/atf.json names that contract, the record
//                     says the step failed, and the message names the backup.
//
// A step is pure and idempotent: migrate(ctx) works only through ctx.files (read, write, list; workspace-relative `/`
// paths, limited to what the step's `touches` declares under artifacts/), and running it twice gives the same files.
// Both are checked as it runs: a path outside `touches` throws, and every step runs a second time over its own result,
// which must change nothing. In a source checkout (the framework's own repository) the command is refused, as atf init
// refuses one: that workspace is the maintainers' own, and moves with the source rather than across releases.
//
// The workspace's sessions must be stopped first: a migration rewrites run state an active session would also write.
import { appendFileSync, closeSync, copyFileSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, statSync, unlinkSync, writeSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { CONTRACT_VERSION, contractProblem, workspaceContract } from "./contract.mjs";
import { withFileLock, writeAtomic } from "./files.mjs";
import { packageOf } from "./provenance.mjs";
import { WORKSPACE_MARKER, frameworkRoot, isInstalled, isWithin, workspaceRoot } from "./roots.mjs";

export const MIGRATIONS_DIR = "migrations"; // in the framework
export const MIGRATION_LOCK = "artifacts/.migrate.lock";
export const MIGRATION_LOG = "artifacts/migrations.jsonl";
export const BACKUP_ROOT = "artifacts/.migrate-backups";
// the machinery's own files under artifacts/: no step reads, writes or lists them
const RESERVED = new Set([".migrate.lock", ".migrate-backups", "migrations.jsonl"]);
const STEP_FILE_RE = /^(\d+)-to-(\d+)\.mjs$/;
// the run lock's settings in run.mjs (D-072): a `stage done` holds it for seconds, never minutes
const RUN_LOCK = { staleMs: 300_000, retries: 600 };

const abs =(root, rel) => path.join(root, ...rel.split("/"));
const readDisk = (root, rel) => {
  const p = abs(root, rel);
  return existsSync(p) && statSync(p).isFile() ? readFileSync(p, "utf8") : null;
};

// ---- the steps ---------------------------------------------------------------------------------------------------------

// A workspace-relative `/` path as segments; throws on anything else (absolute, `\`, `.`, `..`, empty segments).
function segmentsOf(rel, who) {
  const bad = () => new Error(`${who}: '${rel}' must be a workspace-relative path with / (no ., .. or drive)`);
  if (typeof rel !== "string" || !rel || rel.startsWith("/") || rel.includes("\\") || /^[A-Za-z]:/.test(rel)) throw bad();
  const s = rel.replace(/\/$/, "").split("/");
  if (s.some((x) => !x || x === "." || x === "..")) throw bad();
  return s;
}

// A `touches` entry: a file (`artifacts/*/state/run.json`) or, ending in `/`, a folder and everything in it
// (`artifacts/*/state/`). `*` is one whole path segment. Always under artifacts/ (§3.10: a step changes artifacts/ and
// nothing else; the machinery alone writes atf/atf.json).
function parsePattern(p, who) {
  const segs = segmentsOf(p, who);
  if (segs[0] !== "artifacts" || segs.length < 2) throw new Error(`${who}: touches '${p}' must be under artifacts/`);
  if (segs.some((x) => x.includes("*") && x !== "*")) throw new Error(`${who}: touches '${p}': * stands for one whole path segment`);
  return { segs, dir: p.endsWith("/") };
}
const segMatch = (p, s) => p === "*" || p === s;
const covers = (pat, s) => (pat.dir ? s.length >= pat.segs.length : s.length === pat.segs.length) && pat.segs.every((p, i) => segMatch(p, s[i]));
// a folder on the way to a pattern (artifacts/, artifacts/acme/ for artifacts/*/state/): listable, to find what it names
const leadsTo = (pat, s) => s.length < pat.segs.length && s.every((x, i) => segMatch(pat.segs[i], x));
const reserved = (s) => s[0] === "artifacts" && s.length >= 2 && RESERVED.has(s[1]);

// Why a step can't be used, or []. `step`: what its module exports (or a test's object).
export function stepProblems(step, who) {
  const out = [];
  const whole = (n) => Number.isInteger(n) && n >= 1;
  if (!whole(step.from) || !whole(step.to) || step.to <= step.from) out.push(`${who}: from and to must be whole numbers of 1 or more, to above from (got ${JSON.stringify(step.from)}, ${JSON.stringify(step.to)})`);
  if (typeof step.describe !== "string" || !step.describe.trim()) out.push(`${who}: describe must say, in a sentence, what the step changes`);
  if (typeof step.migrate !== "function") out.push(`${who}: migrate(ctx) must be a function`);
  if (!Array.isArray(step.touches) || !step.touches.length) out.push(`${who}: touches must list the paths under artifacts/ it reads and writes`);
  else
    for (const p of step.touches)
      try {
        parsePattern(p, who);
      } catch (e) {
        out.push(e.message);
      }
  return out;
}

// The package's steps: every migrations/<from>-to-<to>.mjs, its exports checked against its name. Other files (the
// README) are not steps. -> { steps: [{name, from, to, describe, touches, migrate}], errors }
export async function loadSteps(dir) {
  const steps = [];
  const errors = [];
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".mjs")).sort() : [];
  for (const f of files) {
    const who = `${MIGRATIONS_DIR}/${f}`;
    const m = STEP_FILE_RE.exec(f);
    if (!m) {
      errors.push(`${who}: a step is named <from>-to-<to>.mjs`);
      continue;
    }
    let mod;
    try {
      mod = await import(pathToFileURL(path.join(dir, f)).href);
    } catch (e) {
      errors.push(`${who}: can't be loaded (${e.message})`);
      continue;
    }
    const problems = stepProblems(mod, who);
    if (!problems.length && (mod.from !== Number(m[1]) || mod.to !== Number(m[2]))) problems.push(`${who}: exports from ${mod.from} and to ${mod.to}, not what its name says`);
    if (problems.length) errors.push(...problems);
    else steps.push(named(mod));
  }
  return { steps, errors };
}
const named = (s) => ({ name: `${s.from}-to-${s.to}`, from: s.from, to: s.to, describe: s.describe, touches: s.touches, migrate: s.migrate });

// The steps from contract `from` to `to`, in order. -> { chain } | { error }
export function stepChain(steps, from, to) {
  const chain = [];
  for (let at = from; at < to; ) {
    const next = steps.filter((s) => s.from === at);
    if (!next.length) return { error: `no migration step from artifact contract ${at}: ${MIGRATIONS_DIR}/${at}-to-${at + 1}.mjs is missing from this package, so the workspace can't go from ${from} to ${to}. Install the @testagentic/atf release that ships it, or report it to the framework's maintainers` };
    if (next.length > 1) return { error: `two migration steps start at artifact contract ${at} (${next.map((s) => `${MIGRATIONS_DIR}/${s.name}.mjs`).join(", ")}): the package is broken; reinstall it` };
    if (next[0].to > to) return { error: `${MIGRATIONS_DIR}/${next[0].name}.mjs goes past this framework's contract ${to}: the package is broken; reinstall it` };
    chain.push(next[0]);
    at = next[0].to;
  }
  return { chain };
}

// ---- the file API a step gets ------------------------------------------------------------------------------------------

// read(rel) -> text | null, write(rel, text), list(rel) -> sorted names (folders end in /). Reads see, in order, the
// step's own writes (`pending`), what earlier steps would have written (`view`, a dry run) and the disk. Writes go to
// `pending` only: the caller commits them once migrate() has returned.
function fileApi(root, step, pending, view) {
  const pats = step.touches.map((p) => parsePattern(p, step.name));
  const outside = (rel, verb) => new Error(`${step.name}: ${verb} '${rel}' is outside what the step declares (touches: ${step.touches.join(", ")})`);
  const may = (s) => !reserved(s) && pats.some((p) => covers(p, s));
  const current = (rel) => (pending.has(rel) ? pending.get(rel) : view.has(rel) ? view.get(rel) : readDisk(root, rel));
  return {
    read(rel) {
      const s = segmentsOf(rel, step.name);
      if (!may(s)) throw outside(rel, "read");
      return current(s.join("/"));
    },
    write(rel, text) {
      const s = segmentsOf(rel, step.name);
      if (!may(s) || rel.endsWith("/")) throw outside(rel, "write");
      if (typeof text !== "string") throw new Error(`${step.name}: write('${rel}') takes the file's whole text, as a string`);
      pending.set(s.join("/"), text);
    },
    list(rel) {
      const s = segmentsOf(rel, step.name);
      if (!may(s) && !pats.some((p) => leadsTo(p, s))) throw outside(rel, "list");
      const names = new Set();
      const dir = abs(root, s.join("/"));
      if (existsSync(dir) && statSync(dir).isDirectory()) for (const d of readdirSync(dir, { withFileTypes: true })) names.add(d.isDirectory() ? `${d.name}/` : d.name);
      const prefix = `${s.join("/")}/`;
      for (const k of [...view.keys(), ...pending.keys()])
        if (k.startsWith(prefix)) {
          const rest = k.slice(prefix.length).split("/");
          names.add(rest.length > 1 ? `${rest[0]}/` : rest[0]);
        }
      return [...names].filter((n) => !reserved([...s, n.replace(/\/$/, "")])).sort();
    },
  };
}

// Runs a step over the workspace (and `view`), checks it is idempotent, and returns the files it changes with their new
// text. Nothing is written here.
async function runStep(root, step, view) {
  const ctx = (files) => ({ root, from: step.from, to: step.to, files });
  const pending = new Map();
  await step.migrate(ctx(fileApi(root, step, pending, view)));
  const result = new Map([...view, ...pending]);
  const again = new Map();
  await step.migrate(ctx(fileApi(root, step, again, result)));
  const before = (m, rel) => (m.has(rel) ? m.get(rel) : readDisk(root, rel));
  const drift = [...again].filter(([rel, text]) => text !== before(result, rel)).map(([rel]) => rel);
  if (drift.length) throw new Error(`${step.name} is not idempotent: run again over its own result, it changes ${drift.sort().join(", ")}`);
  return new Map([...pending].filter(([rel, text]) => text !== before(view, rel)).sort(([a], [b]) => a.localeCompare(b)));
}

// ---- the workspace ---------------------------------------------------------------------------------------------------

// Every run-state folder: artifacts/<product>/state and artifacts/<product>/envs/<env>/state (D-081), as `/` paths.
export function stateDirs(root) {
  const dirs = (p) => (existsSync(p) && statSync(p).isDirectory() ? readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith(".")).map((d) => d.name).sort() : []);
  const isDir = (rel) => existsSync(abs(root, rel)) && statSync(abs(root, rel)).isDirectory();
  const out = [];
  for (const product of dirs(path.join(root, "artifacts"))) {
    if (isDir(`artifacts/${product}/state`)) out.push(`artifacts/${product}/state`);
    for (const env of dirs(path.join(root, "artifacts", product, "envs"))) if (isDir(`artifacts/${product}/envs/${env}/state`)) out.push(`artifacts/${product}/envs/${env}/state`);
  }
  return out;
}

// Every run.json older than `to` gets layoutVersion `to` (the contract the run continues on; run.mjs resumeProblem
// refuses any other). -> the run.json paths changed. In a dry run, only `view` changes.
function setLayoutVersions(root, to, view, { dryRun }) {
  const changed = [];
  for (const dir of stateDirs(root)) {
    const rel = `${dir}/run.json`;
    const bump = (text) => {
      const run = JSON.parse(text);
      if (!Number.isInteger(run.layoutVersion) || run.layoutVersion >= to) return null;
      return JSON.stringify({ ...run, layoutVersion: to }, null, 2) + "\n"; // as files.mjs writeJson writes it
    };
    if (dryRun) {
      const text = view.has(rel) ? view.get(rel) : readDisk(root, rel);
      const next = text === null ? null : bump(text);
      if (next !== null) view.set(rel, next), changed.push(rel);
      continue;
    }
    if (!existsSync(abs(root, rel))) continue;
    withFileLock(abs(root, rel), () => {
      const next = bump(readFileSync(abs(root, rel), "utf8"));
      if (next !== null) writeAtomic(abs(root, rel), next), changed.push(rel);
    }, RUN_LOCK);
  }
  return changed;
}

// atf/atf.json's text with "contract": n, everything else as it was where JSON allows: the value replaced in place, or
// the key added first, in the file's own spacing. When that can't be done exactly (a "contract" key nested deeper, say),
// the object is written again with the file's indent. A BOM and the line endings stay.
export function withContract(text, n) {
  const bom = text.charCodeAt(0) === 0xfeff ? "﻿" : "";
  const body = bom ? text.slice(1) : text;
  const cfg = JSON.parse(body);
  const want = { ...cfg, contract: n };
  const eol = body.includes("\r\n") ? "\r\n" : "\n";
  const indent = /^([ \t]+)"/m.exec(body)?.[1] ?? "  ";
  let next;
  if (Object.hasOwn(cfg, "contract")) next = body.replace(/("contract"\s*:\s*)(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|"(?:[^"\\]|\\.)*"|true|false|null)/, `$1${n}`);
  else if (!Object.keys(cfg).length) next = body.replace(/\{\s*\}/, `{${eol}${indent}"contract": ${n}${eol}}`);
  else next = body.replace(/\{(\s*)"/, (_, ws) => `{${ws}"contract": ${n},${ws}"`);
  let ok = false;
  try {
    ok = isDeepStrictEqual(JSON.parse(next), want);
  } catch {}
  if (!ok) next = JSON.stringify(want, null, indent).replaceAll("\n", eol) + (body.endsWith("\n") ? eol : "");
  return bom + next;
}

function writeContract(root, n) {
  const file = path.join(root, ...WORKSPACE_MARKER.split("/"));
  writeAtomic(file, existsSync(file) ? withContract(readFileSync(file, "utf8"), n) : JSON.stringify({ contract: n }, null, 2) + "\n");
}

// The backup: every state folder at its path under artifacts/, and atf/atf.json, in BACKUP_ROOT/<time>-<from>-to-<to>.
function backUp(root, at, from, to) {
  const base = `${BACKUP_ROOT}/${at.replace(/[:.]/g, "-")}-${from}-to-${to}`;
  let rel = base;
  for (let n = 2; existsSync(abs(root, rel)); n++) rel = `${base}-${n}`;
  mkdirSync(abs(root, rel), { recursive: true });
  const dirs = stateDirs(root);
  for (const d of dirs) cpSync(abs(root, d), abs(root, `${rel}/${d.split("/").slice(1).join("/")}`), { recursive: true });
  const marker = path.join(root, ...WORKSPACE_MARKER.split("/"));
  if (existsSync(marker)) copyFileSync(marker, abs(root, `${rel}/atf.json`));
  return { rel, dirs };
}

const record = (root, entry) => {
  mkdirSync(path.join(root, "artifacts"), { recursive: true });
  appendFileSync(abs(root, MIGRATION_LOG), JSON.stringify(entry) + "\n", "utf8");
};

// The lock: created exclusively, so a second migrate fails at once instead of waiting. Never broken automatically: a
// lock left by a crash is a human's to look at (the backup, the log) before removing.
function takeLock(root, info) {
  const file = abs(root, MIGRATION_LOCK);
  mkdirSync(path.dirname(file), { recursive: true });
  let fd;
  try {
    fd = openSync(file, "wx");
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    let held = {};
    try {
      held = JSON.parse(readFileSync(file, "utf8"));
    } catch {}
    return { error: `another atf migrate holds ${MIGRATION_LOCK}${held.at ? ` (since ${held.at}, process ${held.pid})` : ""}. Wait for it to finish. If none is running (one was stopped), look at ${MIGRATION_LOG}, atf/atf.json and the newest folder in ${BACKUP_ROOT}/, then delete ${MIGRATION_LOCK} and run atf migrate again` };
  }
  try {
    writeSync(fd, JSON.stringify(info) + "\n");
  } finally {
    closeSync(fd);
  }
  return { release: () => unlinkSync(file) };
}

// Why atf migrate can't run with this framework: a source checkout inside the workspace (the monorepo), as atf init
// decides it. -> message | null
export function migrateRefusal({ workspace = workspaceRoot, framework = frameworkRoot } = {}) {
  if (!isInstalled(framework) && isWithin(framework, workspace)) return `atf migrate: ${workspace} holds the framework's source checkout (${framework}), whose workspace is the maintainers' own: atf migrate is for a client's workspace, where the package is installed`;
  return null;
}

// atf migrate. `steps` and `contract` replace the package's own (tests inject them); `out` gets the messages.
// -> exit code: 0 done or nothing to do, 1 refused or failed
export async function migrateWorkspace({ workspace = workspaceRoot, framework = frameworkRoot, dryRun = false, steps, contract = CONTRACT_VERSION, pkg = packageOf(framework) } = {}, out = console) {
  const refusal = migrateRefusal({ workspace, framework });
  if (refusal) return out.error(refusal), 1;
  const label = `atf migrate${dryRun ? " --dry-run" : ""}`;
  const plan = await planMigration(workspace, framework, steps, contract);
  if (plan.error) return out.error(`${label}: ${plan.error}`), 1;
  if (!plan.chain) return out.log(`${label}: nothing to migrate: the workspace is on artifact contract ${contract}, this framework's.`), 0;
  const { from, chain } = plan;
  const span = `artifact contract ${from} -> ${contract}, ${chain.length} step(s)`;
  if (dryRun) return dryRunReport(workspace, chain, { span, contract }, out);

  const at = new Date().toISOString();
  const lock = takeLock(workspace, { pid: process.pid, at, from, to: contract });
  if (lock.error) return out.error(`${label}: ${lock.error}`), 1;
  try {
    // the workspace may have changed between the check and the lock (another migrate that just finished)
    const again = await planMigration(workspace, framework, steps, contract);
    if (again.error || again.from !== from) {
      out.error(`${label}: the workspace changed while this migrate started (${again.error ?? `it is now on contract ${again.from ?? contract}`}); nothing was written. Run atf migrate again.`);
      return 1;
    }
    const backup = backUp(workspace, at, from, contract);
    out.log(`${label}: ${span}`);
    out.log(`  backed up ${backup.dirs.length} run-state folder(s) and ${WORKSPACE_MARKER} to ${backup.rel}/`);
    const base = { package: pkg ? { name: pkg.name, version: pkg.version } : null, backup: backup.rel };
    let on = from;
    for (const step of chain) {
      let changed = [];
      let runs = [];
      try {
        const files = await runStep(workspace, step, new Map());
        for (const [rel, text] of files) writeAtomic(abs(workspace, rel), text), changed.push(rel);
        runs = setLayoutVersions(workspace, step.to, null, { dryRun: false });
        writeContract(workspace, step.to);
      } catch (e) {
        record(workspace, { at: new Date().toISOString(), step: step.name, from: step.from, to: step.to, outcome: "failed", error: e.message, contract: on, ...base, changed });
        out.error(`  ${step.name}: FAILED: ${e.message}`);
        out.error(
          `${label}: stopped at step ${step.name}. The workspace stays on artifact contract ${on} (${WORKSPACE_MARKER} records it${on === from ? "" : `; the steps before it are done`}), and ${MIGRATION_LOG} records the failure. ` +
            `${changed.length ? `The step had already written ${changed.join(", ")}; running it again (it is idempotent) completes it. ` : "None of the step's writes was made. "}` +
            `The run state as it was before this migration is in ${backup.rel}/. Fix the cause, then run atf migrate again.`
        );
        return 1;
      }
      record(workspace, { at: new Date().toISOString(), step: step.name, from: step.from, to: step.to, outcome: "done", ...base, changed, runs });
      out.log(`  ${step.name}: ${step.describe} (${changed.length} file(s) changed${runs.length ? `; layoutVersion ${step.to} in ${runs.join(", ")}` : ""})`);
      on = step.to;
    }
    out.log(`${label}: the workspace is on artifact contract ${contract} (${WORKSPACE_MARKER}); each step is recorded in ${MIGRATION_LOG}. An active run continues with npx atf run <product>.`);
    return 0;
  } finally {
    lock.release();
  }
}

// What the workspace needs. -> { error } | { from } (nothing to do) | { from, chain }
async function planMigration(workspace, framework, steps, contract) {
  const w = workspaceContract(workspace);
  if (w.error || w.contract > contract) {
    const p = contractProblem(workspace, { contract });
    return { error: `${p.detail}. ${w.error ? "Fix" : "A migration only goes forward; instead"}: ${p.fix}` };
  }
  if (w.contract === contract) return { from: w.contract };
  let all = steps?.map(named);
  if (!all) {
    const loaded = await loadSteps(path.join(framework, MIGRATIONS_DIR));
    if (loaded.errors.length) return { error: `the package's migration steps can't be used: ${loaded.errors.join("; ")}` };
    all = loaded.steps;
  } else {
    const problems = steps.flatMap((s) => stepProblems(s, `step ${s.from}-to-${s.to}`));
    if (problems.length) return { error: problems.join("; ") };
  }
  const c = stepChain(all, w.contract, contract);
  return c.error ? { error: c.error } : { from: w.contract, chain: c.chain };
}

async function dryRunReport(workspace, chain, { span, contract }, out) {
  out.log(`atf migrate --dry-run: ${span}; nothing is written`);
  const view = new Map();
  for (const step of chain) {
    out.log(`  ${step.name}: ${step.describe}`);
    let files;
    try {
      files = await runStep(workspace, step, view);
    } catch (e) {
      out.error(`    FAILED: ${e.message}`);
      out.error(`atf migrate --dry-run: step ${step.name} fails, so atf migrate would stop there, on contract ${step.from}. Nothing was written.`);
      return 1;
    }
    for (const [rel, text] of files) view.set(rel, text);
    const runs = setLayoutVersions(workspace, step.to, view, { dryRun: true });
    out.log(files.size ? `    would write: ${[...files.keys()].join(", ")}` : "    would write: nothing");
    if (runs.length) out.log(`    would set layoutVersion ${step.to} in: ${runs.join(", ")}`);
  }
  const dirs = stateDirs(workspace);
  out.log(`  then: ${WORKSPACE_MARKER} "contract": ${contract}; before the first step, a backup of ${dirs.length ? dirs.join(", ") : "no run-state folder (none yet)"} and ${WORKSPACE_MARKER} in ${BACKUP_ROOT}/; a record per step in ${MIGRATION_LOG}`);
  out.log("Run atf migrate (without --dry-run) to apply it. Stop every session of this workspace first.");
  return 0;
}
