#!/usr/bin/env node
// CLI over scripts/lib/knowledge.mjs -- artifacts/<product>/knowledge/ (D-015, D-051). Uses the product's active run
// (state/run.json + state/config.resolved.json). `--module M` selects a module pass; without it, the product pass.
//
//   knowledge.mjs plan <product>                                  {product, modules{}}: "reuse" | "generate" (orchestrator)
//   knowledge.mjs add-source <product> --title T --location URL|PATH --type TYPE [--module M]
//                                    -> {id, ...} (same location = same id); a configured input becomes read; an extra
//                                       source over knowledge.max_extra_sources -> {deferred: true} (no id)
//   knowledge.mjs input <product> --location L --status failed|excluded --reason R [--module M]
//                                    account for a configured input that was not read
//   knowledge.mjs snapshot <product> S<n> [--from-file captures/F] [--module M]
//                                    cache the source's text (sources/S<n>.txt) for quote checks: a plain GET of a URL
//                                    (never the product's hosts or their subdomains), a repo file read directly (never
//                                    a credentials file). Text cached in an earlier run is fetched again (kept as
//                                    `stale` if that fails). --from-file (captured_by: agent) only for a live-product
//                                    source or after the script's own fetch failed in this run
//   knowledge.mjs render <product> [--module M]                   sources.md from the registry; open-points.json ids
//   knowledge.mjs merge-glossary <product> --module M             merge the module glossary into the product glossary
//   knowledge.mjs check <product> [--module M]                    every check the stage runs; stamps `verified`
//   knowledge.mjs paths <product> [--module M]                    the pass's files
//   TYPE: vendor-doc | knowledge-base | requirement | web | live-product
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { loadJson, paths, workspaceRoot } from "./lib/contract.mjs";
import { knowledgePaths, markInput, mergeGlossary, plan, registerSource, render, runCheck, snapshot } from "./lib/knowledge.mjs";

const USAGE = "usage: knowledge.mjs plan|add-source|input|snapshot|render|merge-glossary|check|paths <product> [options]";
const rel = (root, f) => path.relative(root, f).replaceAll("\\", "/");

export async function main(argv, { root = workspaceRoot, fetchImpl } = {}) {
  const [cmd, product, ...rest] = argv;
  if (!cmd || !product) return { code: 2, out: { errors: [USAGE] } };
  const { values: v, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: { title: { type: "string" }, location: { type: "string" }, type: { type: "string" }, module: { type: "string" }, status: { type: "string" }, reason: { type: "string" }, "from-file": { type: "string" } },
  });
  const p = paths(product, root);
  const kp = knowledgePaths(p.productDir);
  if (!existsSync(p.lockFile)) throw new Error(`no active run for product '${product}'`);
  const run = loadJson(p.runFile);
  const cfg = loadJson(p.configFile);
  if (v.module !== undefined && !run.modules.includes(v.module)) throw new Error(`--module must be one of [${run.modules.join(", ")}]`);
  const module = v.module;
  const needModule = () => {
    if (!module) throw new Error(`--module must be one of [${run.modules.join(", ")}]`);
    return module;
  };

  if (cmd === "plan") return { code: 0, out: plan(kp, cfg, root) };
  if (cmd === "add-source") return { code: 0, out: registerSource(kp, cfg, { title: v.title, location: v.location, type: v.type, module, runId: run.runId }) };
  if (cmd === "input") return { code: 0, out: markInput(kp, cfg, { module, location: v.location, status: v.status, reason: v.reason, runId: run.runId }) };
  if (cmd === "snapshot") {
    const id = positionals[0];
    if (!/^S[1-9]\d*$/.test(id ?? "")) return { code: 2, out: { errors: ["usage: knowledge.mjs snapshot <product> S<n> [--from-file captures/<file>]"] } };
    // --from-file: relative to the product's knowledge/ (captures/<file>), or a repo path (artifacts/<p>/knowledge/captures/<file>)
    const f = v["from-file"];
    const fromFile = f && (path.isAbsolute(f) ? f : /^artifacts[\\/]/.test(f) ? path.join(root, f) : path.join(kp.dir, f));
    return { code: 0, out: await snapshot(kp, cfg, { id, fromFile, root, runId: run.runId, ...(fetchImpl ? { fetchImpl } : {}) }) };
  }
  if (cmd === "render") return { code: 0, out: render(kp, module, { runId: run.runId }) };
  if (cmd === "merge-glossary") return { code: 0, out: mergeGlossary(kp, needModule()) };
  if (cmd === "check") {
    const r = runCheck(kp, cfg, { module, runId: run.runId });
    return { code: r.valid ? 0 : 1, out: r };
  }
  if (cmd === "paths") {
    const files = module
      ? { ...Object.fromEntries(Object.entries(kp.module(module)).filter(([k]) => k !== "dir").map(([k, f]) => [k, rel(root, f)])) }
      : { ...Object.fromEntries(Object.entries(kp.product).map(([k, f]) => [k, rel(root, f)])), coverage: rel(root, kp.coverage), openPoints: rel(root, kp.openPoints) };
    return { code: 0, out: { ...files, registry: rel(root, kp.registry), cache: rel(root, kp.cacheDir), captures: rel(root, kp.captures) } };
  }
  return { code: 2, out: { errors: [`unknown command ${cmd}`, USAGE] } };
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
