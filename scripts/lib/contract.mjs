// The artifact contract, in code -- layout v2 (see docs/agent-architecture.md). Everything is product-level:
//
//   artifacts/<product>/
//     knowledge/                       reusable product knowledge
//     modules/<module>/                latest working state per module (explore/, clarifications.csv, testcases/, ...)
//     state/{run.json, lock.json, ledger.jsonl, permissions.resolved.json, config.resolved.json, orchestration/, history/}
//     results/<run-id>/                per-run archive (review findings, results, triage, report)
//   playwright-tests/<product>/        one Playwright repo: tests/ui + tests/api
//   k6-tests/<product>/
//
// The STAGES table is the main orchestrator's view (one stage per domain). Sub-steps inside a domain are owned by
// that domain's orchestrator and tracked in state/orchestration/. A stage is complete only when run.json says
// `done` AND every declared output exists, is non-empty and passes its schema/check.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const LAYOUT_VERSION = 2;
export const PRODUCT_SCOPE = "_product";
export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const schemaDir = path.join(repoRoot, "schemas");
export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function paths(product, root = repoRoot) {
  const productDir = path.join(root, "artifacts", product);
  const state = path.join(productDir, "state");
  return {
    root,
    productDir,
    knowledge: path.join(productDir, "knowledge"),
    module: (m) => path.join(productDir, "modules", m),
    state,
    runFile: path.join(state, "run.json"),
    lockFile: path.join(state, "lock.json"),
    ledgerFile: path.join(state, "ledger.jsonl"),
    permissionsFile: path.join(state, "permissions.resolved.json"),
    configFile: path.join(state, "config.resolved.json"),
    historyDir: path.join(state, "history"),
    orchestrationDir: path.join(state, "orchestration"),
    results: (runId) => path.join(productDir, "results", runId),
    pwProject: path.join(root, "playwright-tests", product),
    k6Project: path.join(root, "k6-tests", product),
  };
}

// outputs: paths relative to the repo root. Tokens: {product} {m} (module) {run} (run id).
// PROVISIONAL outputs are placeholders until that domain is designed in detail; they are confirmed or changed
// when the domain is implemented.
export const STAGES = {
  // Product pass: product-wide overview/glossary from the run-config's references and requirement docs.
  knowledge: {
    scope: "product",
    orchestrator: "knowledge-generator",
    needs: [],
    onDone: "record-knowledge-inputs",
    outputs: [
      { path: "artifacts/{product}/knowledge/overview.md", check: "knowledge-product" },
      { path: "artifacts/{product}/knowledge/glossary.md" },
      { path: "artifacts/{product}/knowledge/sources.md" },
      { path: "artifacts/{product}/knowledge/sources.json", schema: "sources" },
    ],
  },
  // Module pass: one knowledge-generator invocation per module.
  "module-knowledge": {
    scope: "module",
    orchestrator: "knowledge-generator",
    needs: ["knowledge"],
    onDone: "record-knowledge-inputs",
    outputs: [
      { path: "artifacts/{product}/knowledge/modules/{m}/overview.md", check: "knowledge-module" },
      { path: "artifacts/{product}/knowledge/modules/{m}/glossary.md" },
      { path: "artifacts/{product}/knowledge/modules/{m}/notes.md" },
      { path: "artifacts/{product}/knowledge/modules/{m}/sources.md" },
    ],
  },
  explore: {
    scope: "module",
    orchestrator: "module-explorer",
    needs: ["module-knowledge"],
    outputs: [
      { path: "artifacts/{product}/modules/{m}/explore/sitemap.json", schema: "sitemap" },
      { path: "artifacts/{product}/modules/{m}/explore/module-summary.md" },
    ],
  },
  clarifications: {
    scope: "module",
    orchestrator: "clarification-orchestrator",
    needs: ["explore"],
    outputs: [
      { path: "artifacts/{product}/modules/{m}/clarifications.csv", check: "clarifications" },
      { path: "artifacts/{product}/modules/{m}/clarifications-summary.md" },
    ],
  },
  testcases: {
    scope: "module",
    orchestrator: "testcase-orchestrator",
    needs: ["clarifications"],
    outputs: [{ path: "artifacts/{product}/modules/{m}/testcases/testcases-summary.md", provisional: true }],
  },
  "playwright-repo": {
    scope: "product",
    orchestrator: "pw-repo-owner",
    needs: [],
    outputs: [{ path: "playwright-tests/{product}/package.json" }, { path: "playwright-tests/{product}/playwright.config.ts" }],
  },
  "playwright-ui": {
    scope: "module",
    orchestrator: "playwright-ui-orchestrator",
    needs: ["testcases", "playwright-repo"],
    outputs: [{ path: "artifacts/{product}/results/{run}/{m}/playwright-ui/results.json", provisional: true }],
  },
  "playwright-api": {
    scope: "module",
    orchestrator: "playwright-api-orchestrator",
    needs: ["testcases", "playwright-repo"],
    outputs: [{ path: "artifacts/{product}/results/{run}/{m}/playwright-api/results.json", provisional: true }],
  },
  k6: {
    scope: "module",
    orchestrator: "k6-orchestrator",
    needs: ["playwright-api"],
    outputs: [{ path: "artifacts/{product}/results/{run}/{m}/k6/results.json", provisional: true }],
  },
  report: {
    scope: "product",
    orchestrator: "report-generator",
    needs: ["*"], // every other stage complete or failed
    outputs: [{ path: "artifacts/{product}/results/{run}/report/index.html", provisional: true }],
  },
};

export const stageKey = (stage, module) => `${STAGES[stage].scope === "product" ? PRODUCT_SCOPE : module}/${stage}`;
export const resolveOutput = (pattern, { product, module, runId }) =>
  pattern.replaceAll("{product}", product).replaceAll("{m}", module ?? "").replaceAll("{run}", runId);

export const loadJson = (file) => JSON.parse(readFileSync(file, "utf8"));

let ajvInstance;
async function getAjv() {
  if (!ajvInstance) {
    const { default: Ajv2020 } = await import("ajv/dist/2020.js");
    ajvInstance = new Ajv2020({ allErrors: true, strict: false });
    for (const f of readdirSync(schemaDir)) if (f.endsWith(".schema.json")) ajvInstance.addSchema(loadJson(path.join(schemaDir, f)));
  }
  return ajvInstance;
}

export async function validateData(schema, data) {
  const validate = (await getAjv()).getSchema(`${schema}.schema.json`);
  if (!validate) throw new Error(`unknown schema '${schema}'`);
  return validate(data) ? [] : validate.errors.map((e) => `${e.instancePath || "/"} ${e.message}`);
}

export async function validateFile(schema, file) {
  let data;
  try {
    data = loadJson(file);
  } catch (e) {
    return [`not valid JSON: ${e.message}`];
  }
  return validateData(schema, data);
}

// Named content checks for non-JSON outputs. Each returns string[] problems. Registered lazily to avoid cycles.
const knowledgeLib = async (ctx) => {
  const k = await import("./knowledge.mjs");
  return { k, kp: k.knowledgePaths(paths(ctx.product, ctx.root ?? repoRoot).productDir) };
};
const CHECKS = {
  clarifications: async (file, ctx) => (await import("./clarifications.mjs")).checkComplete(file, ctx),
  "knowledge-product": async (_file, ctx) => {
    const { k, kp } = await knowledgeLib(ctx);
    return k.checkProduct(kp);
  },
  "knowledge-module": async (_file, ctx) => {
    const { k, kp } = await knowledgeLib(ctx);
    return k.checkModule(kp, ctx.module);
  },
};

export async function verifyOutputs(ctx, stage, module) {
  const problems = [];
  for (const out of STAGES[stage].outputs) {
    const rel = resolveOutput(out.path, { product: ctx.product, module, runId: ctx.runId });
    const abs = path.join(ctx.root ?? repoRoot, rel);
    if (!existsSync(abs) || statSync(abs).size === 0) {
      problems.push(`${rel}: missing or empty`);
      continue;
    }
    if (out.schema) for (const e of await validateFile(out.schema, abs)) problems.push(`${rel}: ${e}`);
    if (out.check) for (const e of await CHECKS[out.check](abs, { ...ctx, module })) problems.push(`${rel}: ${e}`);
  }
  return problems;
}
