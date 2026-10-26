#!/usr/bin/env node
// CLI over scripts/lib/endpoints.mjs (+ api-discovery.mjs, probe.mjs) -- a module's endpoint catalogue under
// artifacts/<product>/modules/<m>/api/ (docs/agent-handoffs.md §4, D-045). Uses the product's active run
// (state/run.json + state/config.resolved.json). Every network request is a guarded GET (scripts/lib/probe.mjs).
//
//   endpoints.mjs find-spec  <product> <module> [--spec PATH|URL ...]   fetch/read OpenAPI documents into sources/
//   endpoints.mjs introspect <product> <module>                         GraphQL introspection over GET
//   endpoints.mjs build      <product> <module>                         merge sources + inventory + overlay -> catalogue,
//                                                                       coverage.json, drift.json (exit 1 on problems)
//   endpoints.mjs probe      <product> <module> [--budget N]            GET the catalogue's documented GETs with the run's
//                                                                       session; then run build again
//   endpoints.mjs check      <product> <module>                         schemas, ids vs registry, links, coverage
//   endpoints.mjs paths      <product> <module>                         the module's api/ file paths
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { loadJson, paths, workspaceRoot, validateData } from "./lib/contract.mjs";
import { findSpecs, introspect, runProbes } from "./lib/api-discovery.mjs";
import { apiPaths, build, check } from "./lib/endpoints.mjs";
import { createClient, loadAuth } from "./lib/probe.mjs";

export const DEFAULTS = { discovery_budget: 40, probe_budget: 50, probe_delay_ms: 500 };

function context(product, module, root) {
  const p = paths(product, root);
  if (!existsSync(p.lockFile)) throw new Error(`no active run for product '${product}'`);
  const run = loadJson(p.runFile);
  if (!run.modules.includes(module)) throw new Error(`module must be one of [${run.modules.join(", ")}]`);
  return { run, cfg: loadJson(p.configFile), ap: apiPaths(p.productDir, module) };
}

const rel = (root, f) => path.relative(root, f).replaceAll("\\", "/");

export async function main(argv, { root = workspaceRoot, fetchImpl, sleep } = {}) {
  const [cmd, product, module, ...rest] = argv;
  const { values: v } = parseArgs({ args: rest, options: { spec: { type: "string", multiple: true }, budget: { type: "string" } } });
  if (!cmd || !product || !module) return { code: 2, out: { errors: ["usage: endpoints.mjs find-spec|introspect|build|probe|check|paths <product> <module> [options]"] } };
  const { run, cfg, ap } = context(product, module, root);
  const api = { ...DEFAULTS, ...(cfg.api ?? {}) };
  const client = (budget) => createClient({ cfg, auth: loadAuth(cfg, root), budget, delayMs: api.probe_delay_ms, ...(fetchImpl ? { fetchImpl } : {}), ...(sleep ? { sleep } : {}) });

  if (cmd === "paths") return { code: 0, out: Object.fromEntries(Object.entries(ap).map(([k, f]) => [k, rel(root, f)])) };
  if (cmd === "find-spec") return { code: 0, out: await findSpecs(ap, cfg, client(api.discovery_budget), { root, extra: v.spec ?? [] }) };
  if (cmd === "introspect") return { code: 0, out: await introspect(ap, cfg, client(api.discovery_budget)) };
  if (cmd === "probe") {
    const c = client(Number(v.budget ?? api.probe_budget) || api.probe_budget);
    return { code: 0, out: { auth: loadAuth(cfg, root).describe, ...(await runProbes(ap, c)) } };
  }
  if (cmd === "build") {
    if (existsSync(ap.overlay)) {
      const bad = await validateData("api-overlay", loadJson(ap.overlay));
      if (bad.length) return { code: 1, out: { problems: bad.map((e) => `overlay.json: ${e}`), note: "fix overlay.json; nothing was built" } };
    }
    const r = build(ap, { module, cfg, runId: run.runId });
    const schemaProblems = await check(ap, validateData);
    const problems = [...r.problems, ...schemaProblems];
    return { code: problems.length ? 1 : 0, out: { ...r.summary, catalogue: rel(root, ap.catalogue), problems } };
  }
  if (cmd === "check") {
    const problems = await check(ap, validateData);
    return { code: problems.length ? 1 : 0, out: { valid: !problems.length, problems } };
  }
  return { code: 2, out: { errors: [`unknown command ${cmd}`] } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const { code, out } = await main(process.argv.slice(2));
    console.log(JSON.stringify(out, null, 2));
    process.exit(code);
  } catch (e) {
    console.log(JSON.stringify({ errors: [e.message] }, null, 2));
    process.exit(1);
  }
}
