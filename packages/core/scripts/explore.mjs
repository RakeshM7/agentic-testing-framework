#!/usr/bin/env node
// CLI over scripts/lib/explore.mjs -- a module's exploration as a script-owned state machine under
// artifacts/<product>/modules/<m>/explore/ (docs/agent-handoffs.md §1, D-052). Uses the product's active run
// (state/run.json + state/config.resolved.json). Never touches the product: the agent acts in the browser, saves what
// it saw under explore/captures/, and this script records it.
//
//   explore.mjs state <product> <module> --snapshot captures/<file> [--url URL] [--title T]
//                     [--via <ST id> --action "<role> \"<name>\"" ... | --item <FR id> ...]
//        record the state the snapshot shows: fingerprint, ST/PG ids, snapshot copy, transition, frontier; a new state
//        or page over explore.max_states / explore.max_pages becomes a `deferred: budget` frontier item instead
//   explore.mjs frontier <product> <module> [--limit N]       the open frontier items, navigation first
//   explore.mjs ingest-network <product> <module> --file captures/<file> [--state <ST id>] [--keep]
//        normalize a saved network capture into network-inventory.json (NI ids, key names only); the raw capture is
//        deleted afterwards unless --keep
//   explore.mjs build <product> <module>                      write sitemap, interactions, model, coverage, inventory,
//                                                             explore-model.md
//   explore.mjs check <product> <module>                      build + every rule; a pass stamps `verified`
//   explore.mjs paths <product> <module>                      the module's explore/ files
// Exits: 0 ok, 1 problems ({problems} or {errors}), 2 usage.
import "./lib/node-gate.mjs"; // first: on a Node.js older than 20, runs this command again under a newer one
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { frameworkRoot, loadJson, paths, workspaceRoot, validateData } from "./lib/contract.mjs";
import { build, exploreContext, ingestNetwork, openFrontier, recordState, runCheck } from "./lib/explore.mjs";

const USAGE = "usage: explore.mjs state|frontier|ingest-network|build|check|paths <product> <module> [options]";
const rel = (root, f) => path.relative(root, f).replaceAll("\\", "/");

// root: the workspace; framework: the framework root, whose browser config decides readonly input (D-076, D-085)
export function context(product, module, root, env = process.env, framework = frameworkRoot) {
  const p = paths(product, root);
  if (!existsSync(p.lockFile)) throw new Error(`no active run for product '${product}'`);
  const run = loadJson(p.runFile);
  if (!run.modules.includes(module)) throw new Error(`module must be one of [${run.modules.join(", ")}]`);
  return exploreContext({ root, framework, product, module, run, cfg: loadJson(p.configFile), productDir: p.productDir, ledgerFile: p.ledgerFile, env });
}

export async function main(argv, { root = workspaceRoot, framework = frameworkRoot, env = process.env } = {}) {
  const [cmd, product, module, ...rest] = argv;
  if (!cmd || !product || !module) return { code: 2, out: { errors: [USAGE] } };
  const { values: v } = parseArgs({
    args: rest,
    options: {
      snapshot: { type: "string" }, url: { type: "string" }, title: { type: "string" }, via: { type: "string" },
      action: { type: "string", multiple: true }, item: { type: "string", multiple: true },
      file: { type: "string" }, state: { type: "string" }, keep: { type: "boolean" }, limit: { type: "string" },
    },
  });
  const ctx = context(product, module, root, env, framework);
  if (cmd === "state") {
    if (!v.snapshot) return { code: 2, out: { errors: ["state needs --snapshot captures/<file>"] } };
    return { code: 0, out: recordState(ctx, { snapshot: v.snapshot, url: v.url, title: v.title, via: v.via, actions: [...(v.action ?? []), ...(v.item ?? [])] }) };
  }
  if (cmd === "frontier") return { code: 0, out: openFrontier(ctx, { limit: Number(v.limit ?? 40) || 40 }) };
  if (cmd === "ingest-network") {
    if (!v.file) return { code: 2, out: { errors: ["ingest-network needs --file captures/<file>"] } };
    return { code: 0, out: ingestNetwork(ctx, { file: v.file, state: v.state, keep: !!v.keep }) };
  }
  if (cmd === "build") {
    const { m, written } = build(ctx);
    return { code: m.problems.length ? 1 : 0, out: { written, open: m.frontier.filter((i) => i.status === "pending").length, problems: m.problems, warnings: m.warnings } };
  }
  if (cmd === "check") {
    const r = await runCheck(ctx, validateData);
    return { code: r.valid ? 0 : 1, out: r };
  }
  if (cmd === "paths") {
    const { registry, ...files } = ctx.xp;
    return { code: 0, out: { ...Object.fromEntries(Object.entries(files).map(([k, f]) => [k, rel(root, f)])), registry: Object.fromEntries(Object.entries(registry).map(([k, f]) => [k, rel(root, f)])) } };
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
