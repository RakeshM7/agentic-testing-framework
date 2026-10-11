#!/usr/bin/env node
// Renders every generated platform file from the single sources:
//   agents/<name>.md          identity + neutral prompt body          (scripts/lib/agents/source.mjs)
//   config/permissions.yaml   capabilities -> tools, spawn allow-list (scripts/lib/agents/capabilities.mjs)
//   config/models.yaml        model per platform
//   config/platforms.yaml     each platform's tool names, output path, MCP config file, limits
//   config/mcp.yaml           MCP servers
// into, per platform, one agent file per agent (renderers/<renderer>.mjs) and its MCP config file (scripts/lib/mcp.mjs).
// Nothing generated is ever edited by hand: change a source or config, then rebuild.
//
//   node scripts/build-agents.mjs           write every generated file that differs
//   node scripts/build-agents.mjs --check   write nothing; exit 1 on drift, a missing/stray source, or a stray output
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { resolvePermissions } from "./lib/permissions.mjs";
import { capabilitiesFor, toolNames } from "./lib/agents/capabilities.mjs";
import { checkBodyLimit, forbiddenIdentifiers, lintBody } from "./lib/agents/lint.mjs";
import { loadSources } from "./lib/agents/source.mjs";
import { renderMcpConfig, validateMcp } from "./lib/mcp.mjs";
import * as claude from "./lib/agents/renderers/claude.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RENDERERS = { claude };
const loadYaml = (root, rel) => yaml.load(readFileSync(path.join(root, rel), "utf8"));

export function modelFor(models, name, platformKey) {
  return models?.agents?.[name]?.[platformKey] ?? models?.default?.[platformKey];
}

// ".github/agents/{name}.agent.md" -> { dir: ".github/agents", prefix: "", suffix: ".agent.md" }
function outputPattern(template) {
  const [before, suffix] = template.split("{name}");
  return { dir: path.posix.dirname(before + "x"), prefix: path.posix.basename(before + "x").slice(0, -1), suffix };
}

// -> { errors, changed: [repo-relative paths that differ (or would, with --check)] }
export function build({ check = false, root = repoRoot } = {}) {
  const perms = resolvePermissions(loadYaml(root, "config/permissions.yaml"));
  if (perms.errors.length) return { errors: perms.errors.map((e) => `config/permissions.yaml: ${e}`), changed: [] };
  const models = loadYaml(root, "config/models.yaml");
  const { platforms } = loadYaml(root, "config/platforms.yaml");
  const mcp = loadYaml(root, "config/mcp.yaml");
  const names = Object.keys(perms.resolved.agents);
  const { sources, errors } = loadSources(root, names);
  errors.push(...validateMcp(mcp));
  const forbidden = forbiddenIdentifiers(platforms);
  for (const [name, s] of Object.entries(sources)) errors.push(...lintBody(name, s.body, forbidden));

  const outputs = new Map(); // repo-relative path -> content
  for (const [key, platform] of Object.entries(platforms)) {
    const renderer = RENDERERS[platform.renderer];
    if (!renderer) {
      errors.push(`config/platforms.yaml: ${key}: unknown renderer '${platform.renderer}' (have: ${Object.keys(RENDERERS).join(", ")})`);
      continue;
    }
    const { dir, prefix, suffix } = outputPattern(platform.output);
    const expected = new Set();
    for (const [name, s] of Object.entries(sources)) {
      const model = modelFor(models, name, key);
      if (!model) {
        errors.push(`config/models.yaml: no ${key} model for ${name} (agents.${name}.${key} or default.${key})`);
        continue;
      }
      errors.push(...checkBodyLimit(name, s.body, key, platform));
      const caps = capabilitiesFor(perms.resolved.agents[name]);
      const rel = platform.output.replaceAll("{name}", name);
      expected.add(rel);
      outputs.set(rel, renderer.render({ name, ...s, caps, tools: toolNames(caps, platform, mcp.browser_server), model, platform, browserServer: mcp.browser_server }));
    }
    const abs = path.join(root, dir);
    for (const f of existsSync(abs) ? readdirSync(abs) : [])
      if (f.startsWith(prefix) && f.endsWith(suffix) && !expected.has(`${dir}/${f}`))
        errors.push(`${dir}/${f}: not generated from agents/ (no source or no permissions row); remove it or add agents/<name>.md`);
    if (platform.mcp_config) outputs.set(platform.mcp_config.path, renderMcpConfig(mcp, platform.mcp_config.key));
  }

  const changed = [];
  if (errors.length) return { errors, changed };
  for (const [rel, content] of outputs) {
    const file = path.join(root, rel);
    if (existsSync(file) && readFileSync(file, "utf8") === content) continue;
    changed.push(rel);
    if (!check) {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, content, "utf8");
    }
  }
  return { errors, changed };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  const { errors, changed } = build({ check });
  for (const e of errors) console.error(`error: ${e}`);
  for (const f of changed) console.log(`${check ? "drift" : "built"}: ${f}`);
  console.log(`${changed.length} generated file(s) ${check ? "out of date" : "written"}, ${errors.length} error(s).`);
  if (errors.length || (check && changed.length)) process.exit(1);
}
