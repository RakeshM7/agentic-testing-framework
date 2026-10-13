#!/usr/bin/env node
// CLI over scripts/lib/knowledge.mjs -- artifacts/<product>/knowledge/. Uses the product's active run
// (state/run.json + state/config.resolved.json).
//
//   knowledge.mjs plan <product>                                   {product, modules{}}: "reuse" | "generate" (orchestrator)
//   knowledge.mjs add-source <product> --title T --location URL|PATH --type TYPE [--module M]   -> {id, ...} (same location = same id)
//   knowledge.mjs render <product> [--module M]                    re-render product (and module) sources.md from the registry
//   knowledge.mjs merge-glossary <product> --module M              merge the module glossary into the product glossary
//   knowledge.mjs check <product> [--module M]                     the same checks the stage runs on `done`
//   TYPE: vendor-doc | knowledge-base | requirement | web | live-product
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { loadJson, paths, repoRoot } from "./lib/contract.mjs";
import { addSource, checkModule, checkProduct, knowledgePaths, mergeGlossary, plan, render } from "./lib/knowledge.mjs";

const [cmd, product, ...rest] = process.argv.slice(2);
const { values: v } = parseArgs({
  args: rest,
  options: { title: { type: "string" }, location: { type: "string" }, type: { type: "string" }, module: { type: "string" } },
});
const out = (x, code = 0) => {
  console.log(JSON.stringify(x, null, 2));
  process.exit(code);
};
if (!cmd || !product) {
  console.error("usage: knowledge.mjs plan|add-source|render|merge-glossary|check <product> [options]");
  process.exit(2);
}

try {
  const p = paths(product);
  const kp = knowledgePaths(p.productDir);
  const active = () => {
    if (!existsSync(p.lockFile)) throw new Error(`no active run for product '${product}'`);
    return { run: loadJson(p.runFile), cfg: loadJson(p.configFile) };
  };
  const needModule = () => {
    const { run } = active();
    if (!v.module || !run.modules.includes(v.module)) throw new Error(`--module must be one of [${run.modules.join(", ")}]`);
    return v.module;
  };
  if (cmd === "plan") out(plan(kp, active().cfg, repoRoot));
  else if (cmd === "add-source") {
    const { run } = active();
    const scope = v.module ? needModule() : "_product";
    out(addSource(kp, { title: v.title, location: v.location, type: v.type, scope, runId: run.runId }));
  } else if (cmd === "render") out(render(kp, v.module ? needModule() : undefined));
  else if (cmd === "merge-glossary") out(mergeGlossary(kp, needModule()));
  else if (cmd === "check") {
    const problems = v.module ? checkModule(kp, needModule()) : checkProduct(kp);
    out({ valid: !problems.length, problems }, problems.length ? 1 : 0);
  } else out({ errors: [`unknown command ${cmd}`] }, 2);
} catch (e) {
  out({ errors: [e.message] }, 1);
}
