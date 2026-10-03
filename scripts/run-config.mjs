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
  const known = ["target", "feature", "authorizations", "testcases", "defaults", "answers", "feedback_loop", "git"];
  for (const k of Object.keys(cfg)) if (!known.includes(k)) errors.push(`${k}: unknown top-level key`);

  if (errors.length) return { errors };
  return {
    errors,
    normalized: {
      ...cfg,
      target: { ...cfg.target, slug: cfg.target.slug ?? deriveSlug(cfg.target.url) },
      authorizations: { ...cfg.authorizations, mode: cfg.authorizations?.mode ?? "readonly" },
      feedback_loop: { auto_invoke_implementor: false, ...cfg.feedback_loop },
      git: { auto_commit: false, ...cfg.git },
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
