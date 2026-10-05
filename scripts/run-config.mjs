#!/usr/bin/env node
// Deterministic mechanics for the orchestrator, moved out of the prompt:
//   node scripts/run-config.mjs validate <config.yaml>   -> prints normalized JSON (incl. slug), exit 1 on error
//   node scripts/run-config.mjs match <config.yaml> "<question text>"  -> prints the matching answer JSON or null
// Exports validateRunConfig / deriveSlug / matchAnswer for tests.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const MODES = ["readonly", "full-run"];
const FORMATS = ["markdown-table", "gherkin", "csv", "testrail"];
const BEHAVIOR_POLICIES = ["assume-standard-and-flag", "skip-coverage"];
const EDGE_POLICIES = ["flag-as-unconfirmed-case", "omit"];
// feature.slug value that switches the orchestrator into full-product mode
// (discover modules -> explore each -> one parallel pipeline track per module).
export const FULL_PRODUCT_SLUG = "full-product";
const FULL_PRODUCT_DEFAULTS = {
  max_modules: 12,
  explore_concurrency: 1, // one Playwright MCP browser is shared by every subagent; >1 is opt-in
  max_parallel_tracks: 4,
  per_module: { maxPages: 40, maxDepth: 4 },
  modules: { include: [], exclude: [] },
  knowledge_urls: [],
  // Human clarification session: more than csv_threshold open questions across all modules -> questions.csv;
  // a module still unresolved after max_rounds question rounds is marked uncovered.
  clarifications: { csv_threshold: 5, max_rounds: 5 },
};

export function deriveSlug(url) {
  // First hostname label, lowercased, non-alphanumerics -> '-'
  // (eventhub.rahulshettyacademy.com -> eventhub). An explicit target.slug always wins.
  const label = new URL(url).hostname.toLowerCase().split(".")[0];
  return label.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function normalize(s) {
  return String(s).toLowerCase().replace(/[-_]/g, " ").replace(/\s+/g, " ").trim();
}

export function matchAnswer(answers, question) {
  const q = normalize(question);
  return (answers ?? []).find((a) => a.match && q.includes(normalize(a.match))) ?? null;
}

export function validateRunConfig(cfg) {
  const errors = [];
  const oneOf = (v, allowed, path) => {
    if (v !== undefined && !allowed.includes(v)) errors.push(`${path}: '${v}' not in [${allowed.join(", ")}]`);
  };
  if (!cfg || typeof cfg !== "object") return { errors: ["config is not a YAML mapping"] };

  if (typeof cfg.target?.url !== "string") errors.push("target.url: required string");
  else {
    try {
      new URL(cfg.target.url);
    } catch {
      errors.push(`target.url: '${cfg.target.url}' is not a valid URL`);
    }
  }
  const prod = cfg.target?.product;
  if (prod !== undefined && !(typeof prod === "string" && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(prod)))
    errors.push("target.product: must be lowercase kebab-case (letters, digits, single hyphens)");
  for (const k of ["maxPages", "maxDepth"]) {
    const v = cfg.target?.[k];
    if (v !== undefined && !(Number.isInteger(v) && v > 0)) errors.push(`target.${k}: must be a positive integer`);
  }
  oneOf(cfg.authorizations?.mode, MODES, "authorizations.mode");
  oneOf(cfg.testcases?.output_format, FORMATS, "testcases.output_format");
  oneOf(cfg.defaults?.unconfirmed_behavior_policy, BEHAVIOR_POLICIES, "defaults.unconfirmed_behavior_policy");
  oneOf(cfg.defaults?.unconfirmed_edge_case_policy, EDGE_POLICIES, "defaults.unconfirmed_edge_case_policy");
  for (const k of ["credentials_file", "session_state_file"]) {
    const v = cfg.authorizations?.[k];
    if (v != null && typeof v !== "string") errors.push(`authorizations.${k}: must be a file path string or null`);
  }
  if (cfg.answers !== undefined) {
    if (!Array.isArray(cfg.answers)) errors.push("answers: must be a list");
    else
      cfg.answers.forEach((a, i) => {
        if (typeof a?.match !== "string" || typeof a?.answer !== "string")
          errors.push(`answers[${i}]: needs string 'match' and 'answer'`);
      });
  }
  const isFullProduct = cfg.feature?.slug === FULL_PRODUCT_SLUG;
  const fp = cfg.full_product;
  if (fp !== undefined) {
    if (!isFullProduct) errors.push(`full_product: only valid when feature.slug is '${FULL_PRODUCT_SLUG}'`);
    else if (!fp || typeof fp !== "object" || Array.isArray(fp)) errors.push("full_product: must be a mapping");
    else {
      for (const k of ["max_modules", "explore_concurrency", "max_parallel_tracks"]) {
        if (fp[k] !== undefined && !(Number.isInteger(fp[k]) && fp[k] > 0)) errors.push(`full_product.${k}: must be a positive integer`);
      }
      for (const k of ["csv_threshold", "max_rounds"]) {
        const v = fp.clarifications?.[k];
        if (v !== undefined && !(Number.isInteger(v) && v >= 0 && (k === "csv_threshold" || v > 0)))
          errors.push(`full_product.clarifications.${k}: must be ${k === "max_rounds" ? "a positive" : "a non-negative"} integer`);
      }
      for (const k of ["maxPages", "maxDepth"]) {
        const v = fp.per_module?.[k];
        if (v !== undefined && !(Number.isInteger(v) && v > 0)) errors.push(`full_product.per_module.${k}: must be a positive integer`);
      }
      for (const [path, v] of [
        ["modules.include", fp.modules?.include],
        ["modules.exclude", fp.modules?.exclude],
        ["knowledge_urls", fp.knowledge_urls],
      ]) {
        if (v !== undefined && !(Array.isArray(v) && v.every((x) => typeof x === "string")))
          errors.push(`full_product.${path}: must be a list of strings`);
      }
    }
  }
  const known = ["target", "feature", "authorizations", "testcases", "defaults", "answers", "feedback_loop", "git", "full_product"];
  for (const k of Object.keys(cfg)) if (!known.includes(k)) errors.push(`${k}: unknown top-level key`);

  if (errors.length) return { errors };
  return {
    errors,
    normalized: {
      ...cfg,
      target: (({ slug, product, ...t }) => ({
        ...t,
        slug: slug ?? deriveSlug(t.url),
        // Folder name under playwright-tests/ for this product's Playwright project; defaults to the slug.
        product: product ?? slug ?? deriveSlug(t.url),
      }))(cfg.target),
      authorizations: { ...cfg.authorizations, mode: cfg.authorizations?.mode ?? "readonly" },
      feedback_loop: { auto_invoke_implementor: false, ...cfg.feedback_loop },
      git: { auto_commit: false, ...cfg.git },
      ...(isFullProduct && {
        feature: { ...cfg.feature, full_product: true },
        full_product: {
          ...FULL_PRODUCT_DEFAULTS,
          ...fp,
          per_module: { ...FULL_PRODUCT_DEFAULTS.per_module, ...fp?.per_module },
          modules: { ...FULL_PRODUCT_DEFAULTS.modules, ...fp?.modules },
          clarifications: { ...FULL_PRODUCT_DEFAULTS.clarifications, ...fp?.clarifications },
        },
      }),
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, file, question] = process.argv.slice(2);
  if (!cmd || !file) {
    console.error("usage: run-config.mjs validate <config.yaml> | match <config.yaml> <question>");
    process.exit(2);
  }
  const cfg = yaml.load(readFileSync(file, "utf8"));
  if (cmd === "validate") {
    const { errors, normalized } = validateRunConfig(cfg);
    if (errors.length) {
      console.error(errors.map((e) => `- ${e}`).join("\n"));
      process.exit(1);
    }
    console.log(JSON.stringify(normalized, null, 2));
  } else if (cmd === "match") {
    console.log(JSON.stringify(matchAnswer(cfg.answers, question ?? "")));
  } else {
    console.error(`unknown command ${cmd}`);
    process.exit(2);
  }
}
