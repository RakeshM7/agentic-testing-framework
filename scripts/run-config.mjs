#!/usr/bin/env node
// Run-config validation and normalization (layout v2).
//   node scripts/run-config.mjs validate <config.yaml>   -> normalized JSON, exit 1 with errors
// Exports validateRunConfig for run.mjs and tests. See config/run-config.example.yaml for the format.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { SLUG_RE } from "./lib/contract.mjs";
import { UNRESOLVED_POLICIES } from "./lib/clarifications.mjs";

const MODES = ["readonly", "full-run"];
const FORMATS = ["markdown-table", "gherkin", "csv", "testrail"];
const KNOWN = ["product", "target", "feature", "knowledge", "modules", "authorizations", "permissions_file", "testcases", "clarifications", "limits", "concurrency", "feedback_loop", "git"];
const posInt = (v) => Number.isInteger(v) && v > 0;
const strList = (v) => Array.isArray(v) && v.every((x) => typeof x === "string");

export function validateRunConfig(cfg) {
  const errors = [];
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) return { errors: ["config is not a YAML mapping"] };
  for (const k of Object.keys(cfg)) if (!KNOWN.includes(k)) errors.push(`${k}: unknown top-level key`);

  if (typeof cfg.product !== "string" || !SLUG_RE.test(cfg.product)) errors.push("product: required, lowercase kebab-case (folder name under artifacts/, playwright-tests/, k6-tests/)");
  if (typeof cfg.target?.url !== "string") errors.push("target.url: required string");
  else {
    try {
      new URL(cfg.target.url);
    } catch {
      errors.push(`target.url: '${cfg.target.url}' is not a valid URL`);
    }
  }
  if (cfg.feature !== undefined) {
    if (cfg.feature.description !== undefined && typeof cfg.feature.description !== "string") errors.push("feature.description: must be a string");
    if (cfg.feature.requirement_docs !== undefined && !strList(cfg.feature.requirement_docs)) errors.push("feature.requirement_docs: must be a list of paths/URLs");
  }
  if (cfg.knowledge?.references !== undefined && !strList(cfg.knowledge.references)) errors.push("knowledge.references: must be a list of URLs/paths");

  if (!Array.isArray(cfg.modules) || !cfg.modules.length) errors.push("modules: required, a non-empty list (modules are explored in this order)");
  else {
    const seen = new Set();
    cfg.modules.forEach((m, i) => {
      if (!m || typeof m.slug !== "string" || !SLUG_RE.test(m.slug)) errors.push(`modules[${i}].slug: required, lowercase kebab-case`);
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
    });
  }

  const auth = cfg.authorizations ?? {};
  if (auth.mode !== undefined && !MODES.includes(auth.mode)) errors.push(`authorizations.mode: '${auth.mode}' not in [${MODES}]`);
  if (auth.authenticated_crawl !== undefined && typeof auth.authenticated_crawl !== "boolean") errors.push("authorizations.authenticated_crawl: must be true/false");
  for (const k of ["credentials_file", "session_state_file"])
    if (auth[k] != null && typeof auth[k] !== "string") errors.push(`authorizations.${k}: must be a file path string or null`);
  if (cfg.permissions_file !== undefined && typeof cfg.permissions_file !== "string") errors.push("permissions_file: must be a path");
  if (cfg.testcases?.output_format !== undefined && !FORMATS.includes(cfg.testcases.output_format))
    errors.push(`testcases.output_format: '${cfg.testcases.output_format}' not in [${FORMATS}]`);
  if (cfg.clarifications?.unresolved_policy !== undefined && !UNRESOLVED_POLICIES.includes(cfg.clarifications.unresolved_policy))
    errors.push(`clarifications.unresolved_policy: not in [${UNRESOLVED_POLICIES}]`);
  for (const k of ["review_rounds", "heal_rounds"]) if (cfg.limits?.[k] !== undefined && !posInt(cfg.limits[k])) errors.push(`limits.${k}: must be a positive integer`);
  for (const k of ["modules", "clarification_rows"]) if (cfg.concurrency?.[k] !== undefined && !posInt(cfg.concurrency[k])) errors.push(`concurrency.${k}: must be a positive integer`);

  if (errors.length) return { errors };
  return {
    errors,
    normalized: {
      ...cfg,
      feature: { description: "", requirement_docs: [], ...cfg.feature },
      knowledge: { references: [], ...cfg.knowledge },
      authorizations: { authenticated_crawl: false, credentials_file: null, session_state_file: null, ...auth, mode: auth.mode ?? "readonly" },
      permissions_file: cfg.permissions_file ?? "config/permissions.yaml",
      testcases: { output_format: "gherkin", ...cfg.testcases },
      clarifications: { unresolved_policy: "stop", ...cfg.clarifications },
      limits: { review_rounds: 3, heal_rounds: 3, ...cfg.limits },
      concurrency: { modules: 1, clarification_rows: 1, ...cfg.concurrency },
      feedback_loop: { auto_invoke_implementor: false, ...cfg.feedback_loop },
      git: { auto_commit: false, ...cfg.git },
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, file] = process.argv.slice(2);
  if (cmd !== "validate" || !file) {
    console.error("usage: run-config.mjs validate <config.yaml>");
    process.exit(2);
  }
  const { errors, normalized } = validateRunConfig(yaml.load(readFileSync(file, "utf8")));
  if (errors.length) {
    console.error(errors.map((e) => `- ${e}`).join("\n"));
    process.exit(1);
  }
  console.log(JSON.stringify(normalized, null, 2));
}
