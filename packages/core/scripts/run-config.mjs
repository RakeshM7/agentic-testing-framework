#!/usr/bin/env node
// Run-config validation and normalization (layout v2).
//   node scripts/run-config.mjs validate <config.yaml>   -> normalized JSON, exit 1 with errors
//   node scripts/run-config.mjs draft <answers.json>     -> config/<product>.yaml from the interview (D-063), never over a file
//   node scripts/run-config.mjs set <config.yaml> [--steps a,b] [--testcases-file <module>=<path> ...]
//        [--testcases-import <path>] [--testcases-types ui,api,performance]
//                                                        validates the changed config, then rewrites only those keys in
//                                                        the file (comments and every other key untouched) -> {file,
//                                                        changed, steps}; an empty path clears a file (null); exit 1 with errors
// Exports validateRunConfig for run.mjs and tests. See config/run-config.example.yaml for the format.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, parseArgs } from "node:util";
import yaml from "js-yaml";
import { CASE_TYPES, DEFAULT_ENV, SLUG_RE, STEPS, workspaceRoot } from "./lib/contract.mjs";
import { UNRESOLVED_POLICIES } from "./lib/clarifications.mjs";
import { VISIBILITIES, applyChanges, buildDraft, rewriteKeys } from "./lib/run-config-draft.mjs";

const MODES = ["readonly", "full-run"];
const FORMATS = ["markdown-table", "gherkin", "csv", "testrail"];
const KNOWN = ["product", "environment", "about", "steps", "target", "feature", "knowledge", "explore", "modules", "api", "authorizations", "permissions_file", "testcases", "clarifications", "limits", "concurrency", "feedback_loop", "git", "k6"];
const posInt = (v) => Number.isInteger(v) && v > 0;
export const MAX_MODULE_CONCURRENCY = 1;
// The default permissions_file: the framework's own config/permissions.yaml (run.mjs init reads it from the framework
// root, D-085); any other path is resolved from the workspace root.
export const DEFAULT_PERMISSIONS = "config/permissions.yaml";
const strList = (v) => Array.isArray(v) && v.every((x) => typeof x === "string");
const httpUrl = (v) => {
  try {
    return ["http:", "https:"].includes(new URL(v).protocol);
  } catch {
    return false;
  }
};
// Exploration budgets per module (D-052): new states and pages over them are recorded as deferred: budget.
export const EXPLORE_DEFAULTS = { max_pages: 40, max_states: 150 };
// Test cases (scripts/testcases.mjs): the rendered format, and the budget of coverage items per module that need a case.
export const TESTCASES_DEFAULTS = { output_format: "gherkin", max_cases: 200 };
// Optional test case keys with no default: a product-level file of the human's own cases, and the case types to write.
const TESTCASES_OPTIONAL = ["import", "types"];
// k6 workloads (scripts/workload.mjs, G7): load units per module, the average-load caps, SLOs and opt-in test types.
export const K6_DEFAULTS = { budget: 10, caps: { rps: 10, duration_s: 120, soak_duration_s: 1800 }, slo: {}, modules: {} };
export const K6_OPT_IN_TYPES = ["stress", "spike", "soak", "breakpoint"];
const SLO_KEYS = ["p95_ms", "p99_ms", "error_rate", "rps"];
const isMap = (v) => v && typeof v === "object" && !Array.isArray(v);

// One SLO mapping (k6.slo, k6.modules.<m>.slo, or one of its endpoints): p95/p99 in ms, an error rate in (0, 1), a
// target rps. -> errors[]
function sloErrors(slo, where, { endpoints = false } = {}) {
  if (!isMap(slo)) return [`${where}: must be a mapping of ${SLO_KEYS.join(", ")}${endpoints ? ", endpoints" : ""}`];
  const errors = [];
  for (const k of Object.keys(slo)) if (!SLO_KEYS.includes(k) && !(endpoints && k === "endpoints")) errors.push(`${where}.${k}: unknown key`);
  for (const k of ["p95_ms", "p99_ms"]) if (slo[k] !== undefined && !posInt(slo[k])) errors.push(`${where}.${k}: must be a positive integer (milliseconds)`);
  if (posInt(slo.p95_ms) && posInt(slo.p99_ms) && slo.p99_ms < slo.p95_ms) errors.push(`${where}.p99_ms: must not be below p95_ms`);
  if (slo.error_rate !== undefined && !(typeof slo.error_rate === "number" && slo.error_rate > 0 && slo.error_rate < 1)) errors.push(`${where}.error_rate: must be a number between 0 and 1 (e.g. 0.01 for 1%)`);
  if (slo.rps !== undefined && !(typeof slo.rps === "number" && slo.rps > 0)) errors.push(`${where}.rps: must be a positive number (requests per second)`);
  if (endpoints && slo.endpoints !== undefined) {
    if (!isMap(slo.endpoints)) errors.push(`${where}.endpoints: must be a mapping of endpoint key or EP id -> SLO`);
    else for (const [k, v] of Object.entries(slo.endpoints)) errors.push(...sloErrors(v, `${where}.endpoints['${k}']`));
  }
  return errors;
}

function k6Errors(k6, slugs) {
  if (!isMap(k6)) return ["k6: must be a mapping"];
  const errors = [];
  for (const k of Object.keys(k6)) if (!(k in K6_DEFAULTS)) errors.push(`k6.${k}: unknown key`);
  if (k6.budget !== undefined && !posInt(k6.budget)) errors.push("k6.budget: must be a positive integer (load units per module; the rest are deferred: budget)");
  if (k6.caps !== undefined) {
    if (!isMap(k6.caps)) errors.push("k6.caps: must be a mapping");
    else {
      for (const k of Object.keys(k6.caps)) if (!(k in K6_DEFAULTS.caps)) errors.push(`k6.caps.${k}: unknown key`);
      if (k6.caps.rps !== undefined && !(typeof k6.caps.rps === "number" && k6.caps.rps > 0)) errors.push("k6.caps.rps: must be a positive number (the average-load read rate; writes get half)");
      for (const k of ["duration_s", "soak_duration_s"]) if (k6.caps[k] !== undefined && !posInt(k6.caps[k])) errors.push(`k6.caps.${k}: must be a positive integer (seconds)`);
    }
  }
  if (k6.slo !== undefined) errors.push(...sloErrors(k6.slo, "k6.slo"));
  if (k6.modules !== undefined) {
    if (!isMap(k6.modules)) errors.push("k6.modules: must be a mapping of module slug -> {types, slo}");
    else
      for (const [m, v] of Object.entries(k6.modules)) {
        const where = `k6.modules.${m}`;
        if (!slugs.includes(m)) errors.push(`${where}: not a module of this run-config`);
        if (!isMap(v)) {
          errors.push(`${where}: must be a mapping {types, slo}`);
          continue;
        }
        for (const k of Object.keys(v)) if (!["types", "slo"].includes(k)) errors.push(`${where}.${k}: unknown key`);
        if (v.types !== undefined && !(strList(v.types) && v.types.every((t) => K6_OPT_IN_TYPES.includes(t)) && new Set(v.types).size === v.types.length))
          errors.push(`${where}.types: a list of distinct [${K6_OPT_IN_TYPES}] (smoke and average-load follow the mode; opt-ins load only in full-run)`);
        if (v.slo !== undefined) errors.push(...sloErrors(v.slo, `${where}.slo`, { endpoints: true }));
      }
  }
  return errors;
}

export const API_DEFAULTS = { specs: [], graphql: [], auth_header: null, discovery_budget: 40, probe_budget: 50, probe_delay_ms: 500, plan_budget: 300 };

// A file the human points at (a test case file): null means none; a path must exist now, from the repo root (or
// absolute), and is reported, never guessed. -> error or null
function fileError(v, where, root) {
  if (v === null) return null;
  if (typeof v !== "string" || !v.trim()) return `${where}: must be a file path (from the repo root, or absolute) or null`;
  return existsSync(path.resolve(root, v)) ? null : `${where}: file not found: ${v} (give the path from the repo root, or an absolute path)`;
}

// root: what relative file paths (test case files) resolve against.
export function validateRunConfig(cfg, { root = workspaceRoot } = {}) {
  const errors = [];
  const warnings = [];
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) return { errors: ["config is not a YAML mapping"] };
  for (const k of Object.keys(cfg)) if (!KNOWN.includes(k)) errors.push(`${k}: unknown top-level key`);
  // The steps this run executes (absent = all of them); the stages a chosen step needs run automatically.
  if (cfg.steps !== undefined) {
    if (!strList(cfg.steps) || !cfg.steps.length) errors.push(`steps: must be a non-empty list of [${STEPS}]`);
    else {
      for (const s of cfg.steps) if (!STEPS.includes(s)) errors.push(`steps: unknown step '${s}' (one of ${STEPS.join(", ")})`);
      const dup = cfg.steps.filter((s, i) => cfg.steps.indexOf(s) !== i);
      if (dup.length) errors.push(`steps: duplicate ${[...new Set(dup)].join(", ")}`);
    }
  }

  if (typeof cfg.product !== "string" || !SLUG_RE.test(cfg.product)) errors.push("product: required, lowercase kebab-case (folder name under artifacts/, playwright-tests/, k6-tests/)");
  if (cfg.environment !== undefined && (typeof cfg.environment !== "string" || !SLUG_RE.test(cfg.environment)))
    errors.push("environment: lowercase kebab-case (D-081: e.g. staging; the session runs it with ATF_ENV set to the same name)");
  if (cfg.about !== undefined) {
    if (!isMap(cfg.about)) errors.push("about: must be a mapping {name?, visibility?, description?}");
    else {
      for (const k of Object.keys(cfg.about)) if (!["name", "visibility", "description"].includes(k)) errors.push(`about.${k}: unknown key`);
      if (cfg.about.visibility !== undefined && !VISIBILITIES.includes(cfg.about.visibility)) errors.push(`about.visibility: '${cfg.about.visibility}' not in [${VISIBILITIES}]`);
      for (const k of ["name", "description"]) if (cfg.about[k] !== undefined && typeof cfg.about[k] !== "string") errors.push(`about.${k}: must be a string`);
    }
  }
  if (typeof cfg.target?.url !== "string") errors.push("target.url: required string");
  else {
    try {
      new URL(cfg.target.url);
    } catch {
      errors.push(`target.url: '${cfg.target.url}' is not a valid URL`);
    }
  }
  if (cfg.target?.api_urls !== undefined && !(Array.isArray(cfg.target.api_urls) && cfg.target.api_urls.every(httpUrl)))
    errors.push("target.api_urls: must be a list of http(s) URLs (API hosts of the same product; the guard treats them as the target)");
  const api = cfg.api ?? {};
  if (cfg.api !== undefined && (typeof cfg.api !== "object" || Array.isArray(cfg.api))) errors.push("api: must be a mapping");
  else {
    for (const k of ["specs", "graphql"]) if (api[k] !== undefined && !strList(api[k])) errors.push(`api.${k}: must be a list of paths/URLs`);
    if (api.auth_header != null && !(typeof api.auth_header.name === "string" && typeof api.auth_header.env === "string" && (api.auth_header.prefix === undefined || typeof api.auth_header.prefix === "string")))
      errors.push("api.auth_header: needs {name, env, prefix?} -- the header name and the VARIABLE NAME in credentials_file, never a value");
    for (const k of ["discovery_budget", "probe_budget", "plan_budget"]) if (api[k] !== undefined && !posInt(api[k])) errors.push(`api.${k}: must be a positive integer`);
    if (api.probe_delay_ms !== undefined && !(Number.isInteger(api.probe_delay_ms) && api.probe_delay_ms >= 0)) errors.push("api.probe_delay_ms: must be a non-negative integer");
    for (const k of Object.keys(api)) if (!(k in API_DEFAULTS)) errors.push(`api.${k}: unknown key`);
  }
  if (cfg.feature !== undefined) {
    if (cfg.feature.description !== undefined && typeof cfg.feature.description !== "string") errors.push("feature.description: must be a string");
    if (cfg.feature.requirement_docs !== undefined && !strList(cfg.feature.requirement_docs)) errors.push("feature.requirement_docs: must be a list of paths/URLs");
  }
  if (cfg.knowledge?.references !== undefined && !strList(cfg.knowledge.references)) errors.push("knowledge.references: must be a list of URLs/paths");
  if (cfg.knowledge?.max_extra_sources !== undefined && !(Number.isInteger(cfg.knowledge.max_extra_sources) && cfg.knowledge.max_extra_sources >= 0))
    errors.push("knowledge.max_extra_sources: must be a non-negative integer (extra sources per knowledge pass, D-051)");

  if (cfg.explore !== undefined) {
    if (!cfg.explore || typeof cfg.explore !== "object" || Array.isArray(cfg.explore)) errors.push("explore: must be a mapping");
    else {
      for (const k of Object.keys(cfg.explore)) if (!(k in EXPLORE_DEFAULTS)) errors.push(`explore.${k}: unknown key`);
      for (const k of Object.keys(EXPLORE_DEFAULTS)) if (cfg.explore[k] !== undefined && !posInt(cfg.explore[k])) errors.push(`explore.${k}: must be a positive integer (per module, D-052)`);
    }
  }

  if (!Array.isArray(cfg.modules) || !cfg.modules.length) errors.push("modules: required, a non-empty list (modules are explored in this order)");
  else {
    const seen = new Set();
    cfg.modules.forEach((m, i) => {
      if (!m || typeof m.slug !== "string" || !SLUG_RE.test(m.slug)) errors.push(`modules[${i}].slug: required, lowercase kebab-case`);
      else if (m.slug === "product") errors.push(`modules[${i}].slug: 'product' is reserved (the product pass's open-point ids are KQ-product-<n>, D-051)`);
      else if (seen.has(m.slug)) errors.push(`modules[${i}].slug: duplicate '${m.slug}'`);
      else seen.add(m.slug);
      if (typeof m?.name !== "string" || !m.name) errors.push(`modules[${i}].name: required string`);
      if (m?.entry_url === undefined && m?.nav_path === undefined) errors.push(`modules[${i}]: needs entry_url and/or nav_path`);
      if (m?.entry_url !== undefined) {
        try {
          new URL(m.entry_url);
        } catch {
          errors.push(`modules[${i}].entry_url: not a valid URL`);
        }
      }
      if (m?.nav_path !== undefined && !strList(m.nav_path)) errors.push(`modules[${i}].nav_path: must be a list of menu labels`);
      if (m?.references !== undefined && !strList(m.references)) errors.push(`modules[${i}].references: must be a list of URLs/paths`);
      if (m?.testcases_file !== undefined) {
        const e = fileError(m.testcases_file, `modules[${i}].testcases_file`, root);
        if (e) errors.push(e);
      }
    });
  }

  const auth = cfg.authorizations ?? {};
  if (auth.mode !== undefined && !MODES.includes(auth.mode)) errors.push(`authorizations.mode: '${auth.mode}' not in [${MODES}]`);
  if (auth.authenticated_crawl !== undefined && typeof auth.authenticated_crawl !== "boolean") errors.push("authorizations.authenticated_crawl: must be true/false");
  for (const k of ["credentials_file", "session_state_file"])
    if (auth[k] != null && typeof auth[k] !== "string") errors.push(`authorizations.${k}: must be a file path string or null`);
  // Further identities for authorization scenarios (another user, a lower role): names, roles and FILE PATHS only (D-012, D-046).
  if (auth.identities !== undefined) {
    if (!Array.isArray(auth.identities)) errors.push("authorizations.identities: must be a list of {name, role, credentials_file?, session_state_file?}");
    else {
      const names = new Set();
      auth.identities.forEach((id, i) => {
        if (!id || typeof id.name !== "string" || !SLUG_RE.test(id.name)) errors.push(`authorizations.identities[${i}].name: required, lowercase kebab-case`);
        else if (names.has(id.name)) errors.push(`authorizations.identities[${i}].name: duplicate '${id.name}'`);
        else names.add(id.name);
        if (typeof id?.role !== "string" || !id.role) errors.push(`authorizations.identities[${i}].role: required string (e.g. 'peer' for another user with the same role, or the role name)`);
        for (const k of ["credentials_file", "session_state_file"]) if (id?.[k] != null && typeof id[k] !== "string") errors.push(`authorizations.identities[${i}].${k}: must be a file path string`);
        if (id && id.credentials_file == null && id.session_state_file == null) errors.push(`authorizations.identities[${i}]: needs credentials_file and/or session_state_file (paths, never values)`);
        for (const k of Object.keys(id ?? {})) if (!["name", "role", "credentials_file", "session_state_file"].includes(k)) errors.push(`authorizations.identities[${i}].${k}: unknown key`);
      });
    }
  }
  if (cfg.permissions_file !== undefined && typeof cfg.permissions_file !== "string") errors.push("permissions_file: must be a path");
  if (cfg.testcases !== undefined && (!cfg.testcases || typeof cfg.testcases !== "object" || Array.isArray(cfg.testcases))) errors.push("testcases: must be a mapping");
  else {
    if (cfg.testcases?.output_format !== undefined && !FORMATS.includes(cfg.testcases.output_format))
      errors.push(`testcases.output_format: '${cfg.testcases.output_format}' not in [${FORMATS}]`);
    if (cfg.testcases?.max_cases !== undefined && !posInt(cfg.testcases.max_cases))
      errors.push("testcases.max_cases: must be a positive integer (per module; coverage items over it are deferred: budget)");
    for (const k of Object.keys(cfg.testcases ?? {})) if (!(k in TESTCASES_DEFAULTS) && !TESTCASES_OPTIONAL.includes(k)) errors.push(`testcases.${k}: unknown key`);
    if (cfg.testcases?.import !== undefined) {
      const e = fileError(cfg.testcases.import, "testcases.import", root);
      if (e) errors.push(e);
    }
    const types = cfg.testcases?.types;
    if (types !== undefined && !(strList(types) && types.length && types.every((t) => CASE_TYPES.includes(t)) && new Set(types).size === types.length))
      errors.push(`testcases.types: a non-empty list of distinct [${CASE_TYPES}] (ui is always written; the chosen automation steps add api and performance)`);
  }
  if (cfg.clarifications?.unresolved_policy !== undefined && !UNRESOLVED_POLICIES.includes(cfg.clarifications.unresolved_policy))
    errors.push(`clarifications.unresolved_policy: not in [${UNRESOLVED_POLICIES}]`);
  for (const k of ["review_rounds", "heal_rounds"]) if (cfg.limits?.[k] !== undefined && !posInt(cfg.limits[k])) errors.push(`limits.${k}: must be a positive integer`);
  for (const k of ["modules", "clarification_rows"]) if (cfg.concurrency?.[k] !== undefined && !posInt(cfg.concurrency[k])) errors.push(`concurrency.${k}: must be a positive integer`);
  // D-072: modules run one at a time until parallel modules are safe (they share one browser server, and the product-level
  // files they write are not yet audited for parallel writers)
  if (posInt(cfg.concurrency?.modules) && cfg.concurrency.modules > MAX_MODULE_CONCURRENCY)
    errors.push(`concurrency.modules: at most ${MAX_MODULE_CONCURRENCY} for now (D-072): modules share one browser server and product-level files, so parallel modules are not safe yet`);
  if (cfg.k6 !== undefined) errors.push(...k6Errors(cfg.k6, Array.isArray(cfg.modules) ? cfg.modules.map((m) => m?.slug) : []));

  if (errors.length) return { errors };
  // accepted for older configs, but nothing reads them (D-083)
  if (cfg.feedback_loop?.auto_invoke_implementor !== undefined)
    warnings.push("feedback_loop.auto_invoke_implementor has no effect (D-083): run.mjs end writes the framework issues agents recorded to feedback/run-<run-id>/; start feedback-implementor-agent on them yourself");
  if (cfg.git?.auto_commit !== undefined) warnings.push("git.auto_commit has no effect: the framework never commits; a human does");
  return {
    errors,
    warnings,
    normalized: {
      ...cfg,
      steps: cfg.steps ?? [...STEPS],
      environment: cfg.environment ?? DEFAULT_ENV,
      about: { name: cfg.product, visibility: "public", description: "", ...cfg.about },
      target: { api_urls: [], ...cfg.target },
      api: { ...API_DEFAULTS, ...cfg.api },
      feature: { description: "", requirement_docs: [], ...cfg.feature },
      knowledge: { references: [], max_extra_sources: 20, ...cfg.knowledge },
      explore: { ...EXPLORE_DEFAULTS, ...cfg.explore },
      authorizations: { authenticated_crawl: false, credentials_file: null, session_state_file: null, identities: [], ...auth, mode: auth.mode ?? "readonly" },
      permissions_file: cfg.permissions_file ?? DEFAULT_PERMISSIONS,
      testcases: { ...TESTCASES_DEFAULTS, ...cfg.testcases },
      clarifications: { unresolved_policy: "stop", ...cfg.clarifications },
      limits: { review_rounds: 3, heal_rounds: 3, ...cfg.limits },
      concurrency: { modules: 1, clarification_rows: 1, ...cfg.concurrency },
      k6: { ...K6_DEFAULTS, ...cfg.k6, caps: { ...K6_DEFAULTS.caps, ...cfg.k6?.caps } },
    },
  };
}

// The interview's output (D-063): answers JSON -> a validated config/<product>.yaml, readonly, never over an existing file.
export function draftRunConfig(answers, { root = process.cwd() } = {}) {
  const draft = buildDraft(answers, { root });
  if (!draft.errors.length) {
    const { errors } = validateRunConfig(draft.config, { root });
    draft.errors.push(...errors);
  }
  if (draft.errors.length) return draft;
  const header = [
    `# Run-config for ${draft.config.about.name}, drafted from the orchestrator's interview.`,
    "# Everything not listed here uses the defaults of config/run-config.example.yaml (see it for every option).",
    "# authorizations.mode stays readonly: set full-run yourself, only for a target you are authorized to test.",
    "# Never put secret values in this file, only paths to files you prepared.",
    "",
  ].join("\n");
  const out = path.resolve(root, draft.file);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, header + yaml.dump(draft.config, { lineWidth: 120, noRefs: true }), { flag: "wx" });
  return draft;
}

// The step menu's answer and the human's test case files, written into an existing config: the changed config is
// validated first, then only those keys are rewritten in the text (every other byte, comments included, stays), and the
// result must parse to exactly the validated config. changes: see applyChanges. -> {errors, file?, changed?, steps?}
export function setRunConfig(file, changes, { root = workspaceRoot } = {}) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    return { errors: [`cannot read ${file}: ${e.message}`] };
  }
  const before = yaml.load(text);
  const { config, errors } = applyChanges(before, changes);
  if (errors.length) return { errors };
  const v = validateRunConfig(config, { root });
  if (v.errors.length) return { errors: v.errors };
  const out = rewriteKeys(text, changes);
  if (out.errors.length) return { errors: out.errors };
  let after;
  try {
    after = yaml.load(out.text);
  } catch (e) {
    after = e;
  }
  if (!isDeepStrictEqual(after, config)) return { errors: [`${file}: the rewrite would not read back as the validated config; nothing was written (edit the file by hand)`] };
  if (out.text !== text) writeFileSync(file, out.text, "utf8");
  const changed = [...(changes.steps ? ["steps"] : []), ...Object.keys(changes.testcasesFiles ?? {}).map((m) => `modules[${m}].testcases_file`), ...(changes.testcasesImport !== undefined ? ["testcases.import"] : []), ...(changes.testcasesTypes ? ["testcases.types"] : [])];
  return { errors: [], file, changed, steps: v.normalized.steps };
}

// `set` arguments -> changes. An empty file value clears it (null).
export function parseSetArgs(args) {
  const { values: v } = parseArgs({ args, options: { steps: { type: "string" }, "testcases-file": { type: "string", multiple: true }, "testcases-import": { type: "string" }, "testcases-types": { type: "string" } } });
  const list = (s) => s.split(",").map((x) => x.trim()).filter(Boolean);
  const changes = {};
  const errors = [];
  if (v.steps !== undefined) changes.steps = list(v.steps);
  for (const a of v["testcases-file"] ?? []) {
    const i = a.indexOf("=");
    if (i < 1) errors.push(`--testcases-file ${a}: expected <module>=<path>`);
    else (changes.testcasesFiles ??= {})[a.slice(0, i)] = a.slice(i + 1).trim() || null;
  }
  if (v["testcases-import"] !== undefined) changes.testcasesImport = v["testcases-import"].trim() || null;
  if (v["testcases-types"] !== undefined) changes.testcasesTypes = list(v["testcases-types"]);
  if (!errors.length && !Object.keys(changes).length) errors.push("nothing to set: give --steps, --testcases-file, --testcases-import or --testcases-types");
  return { changes, errors };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, file] = process.argv.slice(2);
  if (cmd === "set" && file) {
    let r;
    try {
      const a = parseSetArgs(process.argv.slice(4));
      r = a.errors.length ? a : setRunConfig(file, a.changes);
    } catch (e) {
      r = { errors: [e.message] };
    }
    if (r.errors.length) {
      console.error(r.errors.map((e) => `- ${e}`).join("\n"));
      process.exit(1);
    }
    console.log(JSON.stringify({ file: r.file, changed: r.changed, steps: r.steps }, null, 2));
    process.exit(0);
  }
  if (cmd === "draft" && file) {
    let answers;
    try {
      answers = JSON.parse(readFileSync(file, "utf8"));
    } catch (e) {
      console.error(`- cannot read answers from ${file}: ${e.message}`);
      process.exit(1);
    }
    const d = draftRunConfig(answers);
    if (d.errors.length) {
      console.error(d.errors.map((e) => `- ${e}`).join("\n"));
      process.exit(1);
    }
    console.log(JSON.stringify({ file: d.file, product: d.product, modules: d.config.modules.map((m) => m.slug), warnings: d.warnings, next: d.next }, null, 2));
    process.exit(0);
  }
  if (cmd !== "validate" || !file) {
    console.error("usage: run-config.mjs validate <config.yaml> | draft <answers.json> | set <config.yaml> [--steps ...] (see header comment)");
    process.exit(2);
  }
  const { errors, warnings = [], normalized } = validateRunConfig(yaml.load(readFileSync(file, "utf8")));
  if (errors.length) {
    console.error(errors.map((e) => `- ${e}`).join("\n"));
    process.exit(1);
  }
  if (warnings.length) console.error(warnings.map((w) => `warning: ${w}`).join("\n"));
  console.log(JSON.stringify(normalized, null, 2));
}
