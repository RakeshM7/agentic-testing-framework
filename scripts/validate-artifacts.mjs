#!/usr/bin/env node
// Validates the framework's machine-readable contracts against JSON Schemas in /schemas.
//
//   config/models.yaml                      -> schemas/models.schema.json
//   config/*.yaml (other)                   -> schemas/run-config.schema.json
//   artifacts/**/sitemap.json               -> schemas/sitemap.schema.json
//   artifacts/**/created-entities.json      -> schemas/created-entities.schema.json
//   artifacts/**/discovered-endpoints.json  -> schemas/discovered-endpoints.schema.json
//
// Beyond schema validation it runs a few semantic checks the schemas can't express
// (referenced files exist, duplicate ledger entries, vague run-config answer matchers).
//
// Usage:
//   node scripts/validate-artifacts.mjs              validate everything under the repo
//   node scripts/validate-artifacts.mjs --strict     treat warnings as failures
//   node scripts/validate-artifacts.mjs <file...>    validate specific files (schema inferred from name)
//
// Exit code: 0 = ok, 1 = at least one error (or warning under --strict), 2 = usage/internal error.

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import yaml from "js-yaml";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_DIRS = new Set(["node_modules", ".git", ".auth", "playwright-report", "test-results"]);

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const SCHEMAS = {};
for (const name of ["run-config", "models", "sitemap", "created-entities", "discovered-endpoints"]) {
  const schema = JSON.parse(readFileSync(path.join(repoRoot, "schemas", `${name}.schema.json`), "utf8"));
  SCHEMAS[name] = ajv.compile(schema);
}

/** Decide which schema applies to a file, or null if none does. */
export function schemaFor(file) {
  const rel = path.relative(repoRoot, path.resolve(file)).split(path.sep).join("/");
  const base = path.basename(rel);
  if (rel === "config/models.yaml") return "models";
  if (/^config\/[^/]+\.ya?ml$/.test(rel)) return "run-config";
  if (base === "sitemap.json") return "sitemap";
  if (base === "created-entities.json") return "created-entities";
  if (base === "discovered-endpoints.json") return "discovered-endpoints";
  return null;
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function fmt(err) {
  const where = err.instancePath || "(root)";
  const extra = err.params?.allowedValues ? ` [allowed: ${err.params.allowedValues.join(", ")}]`
    : err.params?.additionalProperty ? ` ('${err.params.additionalProperty}')` : "";
  return `${where} ${err.message}${extra}`;
}

// ---- semantic checks (warnings unless noted) --------------------------------------------------
function semanticChecks(kind, data, file) {
  const warnings = [];
  const errors = [];
  if (kind === "sitemap") {
    const dir = path.dirname(file);
    const seen = new Set();
    for (const page of data) {
      if (seen.has(page.slug)) errors.push(`duplicate slug '${page.slug}' in sitemap`);
      seen.add(page.slug);
      for (const key of ["screenshotPath", "domSnapshotPath", "networkRequestsPath", "consoleLogPath"]) {
        if (page[key] && !existsSync(path.join(dir, page[key]))) {
          warnings.push(`'${page.slug}'.${key} points to a missing file: ${page[key]}`);
        }
      }
    }
  }
  if (kind === "created-entities") {
    const seen = new Set();
    for (const e of data) {
      const key = `${e.type}::${e.identifier}`;
      if (seen.has(key)) warnings.push(`duplicate ledger entry ${key}`);
      seen.add(key);
    }
  }
  if (kind === "discovered-endpoints") {
    const seen = new Set();
    for (const e of data.endpoints) {
      const key = `${e.method} ${e.pathTemplate}`;
      if (seen.has(key)) warnings.push(`duplicate endpoint ${key}`);
      seen.add(key);
    }
  }
  if (kind === "run-config") {
    for (const [i, a] of (data.answers ?? []).entries()) {
      // The orchestrator normalizes '-'/'_' to spaces before matching (docs/conventions.md), so
      // 'sold-out' counts as two words; only genuinely single-word matchers are risky.
      const words = typeof a.match === "string" ? a.match.replace(/[-_]/g, " ").trim().split(/\s+/).filter(Boolean) : [];
      if (words.length < 2) {
        warnings.push(`answers[${i}].match '${a.match}' is a single word; substring matching may hit unrelated questions (prefer a multi-word phrase)`);
      }
    }
    if (data.authorizations?.authenticated_crawl === true && !data.authorizations?.session_state_file) {
      warnings.push("authenticated_crawl: true but session_state_file is not set; the orchestrator only forwards a session to explore-agent when BOTH are set, so the crawl will silently run unauthenticated");
    }
    if (data.authorizations?.mode === "full-run" && data.git?.auto_commit === true) {
      warnings.push("mode: full-run together with git.auto_commit: true; confirm you want live-run output auto-committed");
    }
  }
  return { warnings, errors };
}

export function validateFile(file) {
  const kind = schemaFor(file);
  const rel = path.relative(repoRoot, path.resolve(file));
  if (!kind) return { rel, kind: null, errors: [], warnings: [], skipped: true };

  let data;
  try {
    const text = readFileSync(file, "utf8");
    data = kind === "run-config" || kind === "models" ? yaml.load(text) : JSON.parse(text);
  } catch (e) {
    return { rel, kind, errors: [`cannot parse: ${e.message.split("\n")[0]}`], warnings: [] };
  }

  const validate = SCHEMAS[kind];
  const errors = validate(data) ? [] : validate.errors.map(fmt);
  if (errors.length) return { rel, kind, errors, warnings: [] };
  const sem = semanticChecks(kind, data, path.resolve(file));
  return { rel, kind, errors: sem.errors, warnings: sem.warnings };
}

function main() {
  const args = process.argv.slice(2);
  const strict = args.includes("--strict");
  const explicit = args.filter((a) => !a.startsWith("--"));
  const files = explicit.length ? explicit : walk(repoRoot).filter((f) => schemaFor(f));

  let errorCount = 0;
  let warnCount = 0;
  let checked = 0;

  for (const file of files.sort()) {
    const r = validateFile(file);
    if (r.skipped) {
      console.log(`SKIP  ${r.rel} (no schema for this file name)`);
      continue;
    }
    checked++;
    const bad = r.errors.length > 0;
    const warn = r.warnings.length > 0;
    console.log(`${bad ? "FAIL" : warn ? "WARN" : "OK  "}  ${r.rel}  [${r.kind}]`);
    for (const e of r.errors.slice(0, 20)) console.log(`        error: ${e}`);
    if (r.errors.length > 20) console.log(`        ... ${r.errors.length - 20} more errors`);
    for (const w of r.warnings.slice(0, 10)) console.log(`        warn:  ${w}`);
    if (r.warnings.length > 10) console.log(`        ... ${r.warnings.length - 10} more warnings`);
    errorCount += r.errors.length;
    warnCount += r.warnings.length;
  }

  console.log(`\n${checked} file(s) checked, ${errorCount} error(s), ${warnCount} warning(s).`);
  if (checked === 0) {
    console.error("No files matched. Is this being run from inside the repo?");
    process.exit(2);
  }
  process.exit(errorCount > 0 || (strict && warnCount > 0) ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
