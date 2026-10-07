#!/usr/bin/env node
// Loop and step bookkeeping for domain orchestrators: artifacts/<product>/state/orchestration/<domain>-<module>.json
// Deterministic so a resumed orchestrator knows exactly where it was and loops are bounded by the run-config
// (limits.review_rounds / limits.heal_rounds). State from a previous run is discarded automatically.
//
//   orchestration.mjs show  <product> <domain> <module>
//   orchestration.mjs step  <product> <domain> <module> <step> start|done|fail|skip [--note TEXT]
//   orchestration.mjs round <product> <domain> <module> review|heal
//        -> {round, limit, allowed}; exit 1 (allowed: false) once the limit is used up -- stop looping and report
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { loadJson, paths, repoRoot } from "./lib/contract.mjs";
import { withFileLock, writeAtomic } from "./lib/csv.mjs";

export const DOMAINS = ["clarifications", "testcases", "playwright-ui", "playwright-api", "k6"];
const LIMIT_KEY = { review: "review_rounds", heal: "heal_rounds" };

function context(product, domain, module, root) {
  if (!DOMAINS.includes(domain)) throw new Error(`domain must be one of [${DOMAINS}]`);
  const p = paths(product, root);
  if (!existsSync(p.lockFile)) throw new Error(`no active run for product '${product}'`);
  const run = loadJson(p.runFile);
  if (!run.modules.includes(module)) throw new Error(`module must be one of [${run.modules}]`);
  return { file: path.join(p.orchestrationDir, `${domain}-${module}.json`), run, cfg: loadJson(p.configFile) };
}

function load(file, run, domain, module) {
  const fresh = { runId: run.runId, domain, module, steps: {}, rounds: { review: 0, heal: 0 }, notes: [] };
  if (!existsSync(file)) return fresh;
  const s = loadJson(file);
  return s.runId === run.runId ? s : fresh;
}

export function show(product, domain, module, { root = repoRoot } = {}) {
  const c = context(product, domain, module, root);
  return load(c.file, c.run, domain, module);
}

export function step(product, domain, module, name, action, note, { root = repoRoot } = {}) {
  if (!["start", "done", "fail", "skip"].includes(action)) throw new Error("action must be start|done|fail|skip");
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name ?? "")) throw new Error("step name must be kebab-case");
  const c = context(product, domain, module, root);
  return withFileLock(c.file, () => {
    const s = load(c.file, c.run, domain, module);
    s.steps[name] = { status: { start: "running", done: "done", fail: "failed", skip: "skipped" }[action], at: new Date().toISOString(), ...(note ? { note } : {}) };
    if (note) s.notes.push(`${name}: ${note}`);
    writeAtomic(c.file, JSON.stringify(s, null, 2) + "\n");
    return s;
  });
}

export function round(product, domain, module, kind, { root = repoRoot } = {}) {
  if (!LIMIT_KEY[kind]) throw new Error("kind must be review|heal");
  const c = context(product, domain, module, root);
  const limit = c.cfg.limits?.[LIMIT_KEY[kind]] ?? 3;
  return withFileLock(c.file, () => {
    const s = load(c.file, c.run, domain, module);
    if (s.rounds[kind] >= limit) return { round: s.rounds[kind], limit, allowed: false };
    s.rounds[kind] += 1;
    writeAtomic(c.file, JSON.stringify(s, null, 2) + "\n");
    return { round: s.rounds[kind], limit, allowed: true };
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, product, domain, module, ...rest] = process.argv.slice(2);
  const { values: v, positionals: pos } = parseArgs({ args: rest, allowPositionals: true, options: { note: { type: "string" } } });
  const out = (x, code = 0) => {
    console.log(JSON.stringify(x, null, 2));
    process.exit(code);
  };
  try {
    if (cmd === "show") out(show(product, domain, module));
    else if (cmd === "step") out(step(product, domain, module, pos[0], pos[1], v.note));
    else if (cmd === "round") {
      const r = round(product, domain, module, pos[0]);
      out(r, r.allowed ? 0 : 1);
    } else out({ errors: ["usage: orchestration.mjs show|step|round <product> <domain> <module> ..."] }, 2);
  } catch (e) {
    out({ errors: [e.message] }, 1);
  }
}
