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

// The environment a session works in (D-081): ATF_ENV, set where the session starts (make run PRODUCT=<p> ENV=<e>) and
// inherited by every shell, script and hook of it; unset is `default`. A product's runs, lock, ledger and history are
// per environment; its knowledge, modules, foundation, test code and results are shared.
export const DEFAULT_ENV = "default";
export function envName(env = process.env) {
  const e = env.ATF_ENV || DEFAULT_ENV;
  if (!SLUG_RE.test(e)) throw new Error(`ATF_ENV '${e}' must be a lowercase kebab-case environment name`);
  return e;
}
// The state folder of an environment: the product's own state/ for `default` (the layout before D-081), else
// envs/<env>/state/.
export const stateDirOf = (productDir, environment) => (environment === DEFAULT_ENV ? path.join(productDir, "state") : path.join(productDir, "envs", environment, "state"));

export function paths(product, root = repoRoot, environment = envName()) {
  const productDir = path.join(root, "artifacts", product);
  const state = stateDirOf(productDir, environment);
  return {
    root,
    environment,
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

// The steps a human chooses for a run (run-config `steps`; absent = all six). Each is the stage of the same name; the
// other stages run only when a chosen step needs them (chosenStages).
export const STEPS = ["explore", "clarifications", "testcases", "playwright-ui", "playwright-api", "k6"];
// Test case types: UI always; @api when playwright-api is chosen, @performance when k6 is (or testcases.types asks).
export const CASE_TYPES = ["ui", "api", "performance"];

// The case types a run derives from its steps and the run-config's optional testcases.types (decision 11).
export function deriveCaseTypes(steps, configured = []) {
  const want = new Set(["ui", ...configured]);
  if (steps.includes("playwright-api")) want.add("api");
  if (steps.includes("k6")) want.add("performance");
  return CASE_TYPES.filter((t) => want.has(t));
}

// The stage set of a run: the chosen steps plus their automatic stages (knowledge for explore, clarifications and
// testcases; api-discovery when API or performance cases or tests are needed; the shared repo for Playwright) and the
// report, always. A run.json from before steps existed chose all six.
export function chosenStages(run) {
  const steps = run.steps ?? STEPS;
  const types = run.caseTypes ?? deriveCaseTypes(steps);
  const set = new Set(["report", ...steps]);
  if (steps.some((s) => ["explore", "clarifications", "testcases"].includes(s))) set.add("knowledge").add("module-knowledge");
  if (steps.includes("playwright-api") || steps.includes("k6") || (steps.includes("testcases") && types.some((t) => t !== "ui"))) set.add("api-discovery");
  if (steps.includes("playwright-ui") || steps.includes("playwright-api")) set.add("playwright-repo");
  return set;
}

// The testcases stage's mode for a module (D-066): `generate` for every module when the `testcases` step is chosen
// (generated and imported cases); else `import` for a module the run put in import mode (run.json testcasesMode: its
// imported cases need converting or linking, and nothing is generated); else null (the stage does not run for it).
export function testcasesModeOf(run, module) {
  if ((run?.steps ?? STEPS).includes("testcases")) return "generate";
  return run?.testcasesMode?.[module] === "import" ? "import" : null;
}

// Whether a stage runs for a module this run: chosen for the run, or the testcases stage of a module in import mode.
export const stageChosen = (run, stage, module) => chosenStages(run).has(stage) || (stage === "testcases" && !!module && testcasesModeOf(run, module) === "import");

// run.json testcasesMode for a run's steps: every module `generate` when testcases is chosen, else `import` for the
// modules listed (the earlier import-mode modules plus any added). -> {<m>: "import"|"generate"} (empty: none runs)
export function testcasesModes(run, importModules = []) {
  const gen = (run.steps ?? STEPS).includes("testcases");
  const imp = new Set([...Object.entries(run.testcasesMode ?? {}).filter(([, v]) => v === "import").map(([m]) => m), ...importModules]);
  return Object.fromEntries(run.modules.filter((m) => gen || imp.has(m)).map((m) => [m, gen ? "generate" : "import"]));
}

// A stage's hard needs in this run: `needs` plus each `needsWhen` entry whose condition holds for the run.
export const stageNeeds = (stage, run) => [...STAGES[stage].needs, ...Object.entries(STAGES[stage].needsWhen ?? {}).filter(([, when]) => when(run)).map(([dep]) => dep)];

// outputs: paths relative to the repo root. Tokens: {product} {m} (module) {run} (run id).
// needs: hard needs, complete in this run or (a stage not chosen for it) verified from an earlier one; needsWhen: needs
// that hold only for some runs; after: soft order, waited for only while chosen for this run, never blocking.
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
      { path: "artifacts/{product}/knowledge/coverage.json", schema: "knowledge-coverage" },
      { path: "artifacts/{product}/knowledge/open-points.json", schema: "knowledge-open-points" },
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
      { path: "artifacts/{product}/knowledge/modules/{m}/coverage.json", schema: "knowledge-coverage" },
      { path: "artifacts/{product}/knowledge/modules/{m}/open-points.json", schema: "knowledge-open-points" },
      { path: "artifacts/{product}/knowledge/modules/{m}/rule-facts.json", schema: "knowledge-rule-facts" },
    ],
  },
  // The exploration's state machine is script-built (D-052): done needs the verified stamp of `explore.mjs check`.
  explore: {
    scope: "module",
    orchestrator: "module-explorer",
    needs: ["module-knowledge"],
    outputs: [
      { path: "artifacts/{product}/modules/{m}/explore/sitemap.json", schema: "sitemap", check: "explore" },
      { path: "artifacts/{product}/modules/{m}/explore/module-summary.md" },
    ],
  },
  clarifications: {
    scope: "module",
    orchestrator: "clarification-orchestrator",
    needs: ["explore"],
    after: ["module-knowledge"],
    outputs: [
      { path: "artifacts/{product}/modules/{m}/clarifications.csv", check: "clarifications" },
      { path: "artifacts/{product}/modules/{m}/clarifications-summary.md" },
    ],
  },
  // The module's endpoint catalogue (endpoints.mjs, D-045), its own stage since it serves test cases, API tests and k6.
  // An empty catalogue is a valid outcome ("no API surface", or discovery blocked with its reason in coverage.json).
  "api-discovery": {
    scope: "module",
    orchestrator: "api-discoverer",
    needs: ["explore"],
    outputs: [
      { path: "artifacts/{product}/modules/{m}/api/discovered-endpoints.json", schema: "discovered-endpoints", check: "api-discovery" },
      { path: "artifacts/{product}/modules/{m}/api/coverage.json", schema: "api-coverage" },
      { path: "artifacts/{product}/modules/{m}/api/drift.json" },
    ],
  },
  // Answered clarifications are used when present: a chosen clarifications stage is waited for, never required.
  testcases: {
    scope: "module",
    orchestrator: "testcase-orchestrator",
    needs: ["explore"],
    // generated typed items need the catalogue; import mode (testcases not chosen) only waits for it while it runs
    needsWhen: { "api-discovery": (run) => (run.steps ?? STEPS).includes("testcases") && (run.caseTypes ?? deriveCaseTypes(run.steps ?? STEPS)).some((t) => t !== "ui") },
    after: ["module-knowledge", "clarifications", "api-discovery"],
    outputs: [{ path: "artifacts/{product}/modules/{m}/testcases/testcases-summary.md", check: "testcases" }],
  },
  "playwright-repo": {
    scope: "product",
    orchestrator: "pw-repo-owner",
    needs: [],
    // The shared files are rendered from templates/ (D-054): done needs foundation.mjs check's verified stamp.
    outputs: [{ path: "playwright-tests/{product}/package.json", check: "foundation-repo" }, { path: "playwright-tests/{product}/playwright.config.ts" }],
  },
  // approval: the case type a stage automates; only human-approved cases of that type are automated, and with none the
  // stage awaits approval (scripts/run.mjs, D-053).
  "playwright-ui": {
    scope: "module",
    orchestrator: "playwright-ui-orchestrator",
    needs: ["testcases", "playwright-repo"],
    approval: "ui",
    outputs: [{ path: "artifacts/{product}/results/{run}/{m}/playwright-ui/results.json", schema: "results" }],
  },
  "playwright-api": {
    scope: "module",
    orchestrator: "playwright-api-orchestrator",
    needs: ["testcases", "playwright-repo", "api-discovery"],
    approval: "api",
    outputs: [{ path: "artifacts/{product}/results/{run}/{m}/playwright-api/results.json", schema: "results" }],
  },
  // The workload is built from the approved @performance cases only, so k6 no longer waits for the API tests.
  k6: {
    scope: "module",
    orchestrator: "k6-orchestrator",
    needs: ["testcases", "api-discovery"],
    approval: "performance",
    outputs: [{ path: "artifacts/{product}/results/{run}/{m}/k6/results.json", schema: "results" }],
  },
  report: {
    scope: "product",
    orchestrator: "report-generator",
    needs: ["*"], // every other stage complete or failed
    // the deck is rendered by script from report.json and the agent's cited narrative: done needs the verified stamp of `report.mjs check` (G11)
    outputs: [{ path: "artifacts/{product}/results/{run}/report/report.json", schema: "report" }, { path: "artifacts/{product}/results/{run}/report/index.html", check: "report" }],
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
// The knowledge checks include the verified stamp a passing `knowledge.mjs check` writes (D-051).
const knowledgeLib = async (ctx) => {
  const k = await import("./knowledge.mjs");
  const p = paths(ctx.product, ctx.root ?? repoRoot);
  return { k, kp: k.knowledgePaths(p.productDir), cfg: loadJson(p.configFile) };
};
const CHECKS = {
  clarifications: async (file, ctx) => (await import("./clarifications.mjs")).checkComplete(file, ctx),
  testcases: async (file, ctx) => (await import("./testcases.mjs")).checkTestcases(file, ctx),
  "knowledge-product": async (_file, ctx) => {
    const { k, kp, cfg } = await knowledgeLib(ctx);
    return k.checkProduct(kp, cfg);
  },
  "knowledge-module": async (_file, ctx) => {
    const { k, kp, cfg } = await knowledgeLib(ctx);
    return k.checkModule(kp, cfg, ctx.module);
  },
  "foundation-repo": async (_file, ctx) => {
    const f = await import("./foundation.mjs");
    const p = paths(ctx.product, ctx.root ?? repoRoot);
    const why = f.foundationUnverified(f.foundationContext({ root: ctx.root ?? repoRoot, product: ctx.product, run: loadJson(p.runFile), cfg: loadJson(p.configFile), productDir: p.productDir, pwProject: p.pwProject, k6Project: p.k6Project }), "repo");
    return why ? [why] : [];
  },
  report: async (_file, ctx) => {
    const r = await import("./report.mjs");
    const why = r.reportUnverified(r.reportPaths(paths(ctx.product, ctx.root ?? repoRoot).productDir, ctx.runId));
    return why ? [why] : [];
  },
  // the catalogue checks endpoints.mjs check runs (schemas, ids against the registry, links, coverage targets)
  "api-discovery": async (_file, ctx) => {
    const e = await import("./endpoints.mjs");
    return e.check(e.apiPaths(paths(ctx.product, ctx.root ?? repoRoot).productDir, ctx.module), validateData);
  },
  explore: async (_file, ctx) => {
    const x = await import("./explore.mjs");
    const p = paths(ctx.product, ctx.root ?? repoRoot);
    return x.stageProblems(x.exploreContext({ root: ctx.root ?? repoRoot, product: ctx.product, module: ctx.module, run: loadJson(p.runFile), cfg: loadJson(p.configFile), productDir: p.productDir, ledgerFile: p.ledgerFile }));
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
