#!/usr/bin/env node
// Renders every generated platform file from the single sources:
//   agents/<name>.md          identity + neutral prompt body          (scripts/lib/agents/source.mjs)
//   config/permissions.yaml   capabilities -> tools, spawn allow-list (scripts/lib/agents/capabilities.mjs)
//   config/models.yaml        model per platform
//   config/platforms.yaml     each platform's tool names, output path, MCP config file, limits
//   config/mcp.yaml           MCP servers
//   config/hooks.yaml         whether/how the PostToolUse hook is registered
// into, per platform, one agent file per agent (renderers/<renderer>.mjs) and its MCP config file (scripts/lib/mcp.mjs),
// and every host's hook registrations (scripts/lib/hook-registrations.mjs).
// The sources are the framework's; the config is the framework's as the workspace has it (read through
// scripts/lib/config.mjs: an ejected atf/config/<file>, else the framework's copy with an atf/<file> overlay merged over
// it, docs/packaging.md §3.4) and checked here as the framework's own copy always was. The generated files are the
// workspace's, and every `{fw}` in them becomes the framework's path from the workspace (D-085: nothing, in this repo).
// Nothing generated is ever edited by hand: change a source or config, then rebuild.
//
//   node scripts/build-agents.mjs           write every generated file that differs
//   node scripts/build-agents.mjs --check   write nothing; exit 1 on drift, a missing/stray source, or a stray output
//   node scripts/build-agents.mjs --post-hook <async|sync|off>   save that mode in the framework's config/hooks.yaml,
//                                                                then build (refused while atf/ overrides hooks.yaml)
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import yaml from "js-yaml";
import { checkHooks, configLocation, configPath, configRel, loadConfig } from "./lib/config.mjs";
import { resolvePermissions } from "./lib/permissions.mjs";
import { expandFw, frameworkRoot, frameworkRel, workspaceRoot } from "./lib/roots.mjs";
import { capabilitiesFor, toolNames } from "./lib/agents/capabilities.mjs";
import { checkBodyLimit, forbiddenIdentifiers, lintBody, lintFwToken } from "./lib/agents/lint.mjs";
import { loadSources } from "./lib/agents/source.mjs";
import { renderMcpConfig, validateMcp } from "./lib/mcp.mjs";
import { CLAUDE_SETTINGS, HOOKS_CONFIG, postModeOf, renderHookRegistrations, setPostMode } from "./lib/hook-registrations.mjs";
import * as claude from "./lib/agents/renderers/claude.mjs";
import * as copilot from "./lib/agents/renderers/copilot.mjs";

const RENDERERS = { claude, copilot };

export function modelFor(models, name, platformKey) {
  return models?.agents?.[name]?.[platformKey] ?? models?.default?.[platformKey];
}

// ".github/agents/{name}.agent.md" -> { dir: ".github/agents", prefix: "", suffix: ".agent.md" }
function outputPattern(template) {
  const [before, suffix] = template.split("{name}");
  return { dir: path.posix.dirname(before + "x"), prefix: path.posix.basename(before + "x").slice(0, -1), suffix };
}

// root: the workspace the generated files go to; framework: where the sources and config come from. A root given alone
// is its own framework (a scratch copy of this repo).
// -> { errors, changed: [workspace-relative paths that differ (or would, with --check)] }
export function build({ check = false, postHook, root, framework } = {}) {
  const ws = root ?? workspaceRoot;
  const fwRoot = framework ?? root ?? frameworkRoot;
  const opts = { framework: fwRoot, workspace: ws };
  const fw = frameworkRel(ws, fwRoot);
  if (check && postHook) return { errors: ["--post-hook changes config/hooks.yaml; it cannot be combined with --check"], changed: [] };
  let config;
  try {
    config = { permissions: loadConfig("permissions.yaml", opts), models: loadConfig("models.yaml", opts), platforms: loadConfig("platforms.yaml", opts), mcp: loadConfig("mcp.yaml", opts) };
  } catch (e) {
    return { errors: [e.message], changed: [] };
  }
  const perms = resolvePermissions(config.permissions, { fw });
  if (perms.errors.length) return { errors: perms.errors.map((e) => `${configRel("permissions.yaml")}: ${e}`), changed: [] };
  // --post-hook rewrites the framework's own hooks.yaml (phase 3b moves it to the workspace); while the workspace
  // overrides that file, the override decides the mode, so the command would change nothing that is built
  let hooksText, post;
  if (postHook) {
    const { source, files } = configLocation("hooks.yaml", opts);
    if (source !== "framework") return { errors: [`--post-hook writes the framework's ${configRel("hooks.yaml")}, but ${files.at(-1)} decides the PostToolUse mode here: set post_tool_use there instead`], changed: [] };
    try {
      hooksText = setPostMode(readFileSync(configPath("hooks.yaml", opts), "utf8"), postHook);
    } catch (e) {
      return { errors: [e.message], changed: [] };
    }
  }
  try {
    // the loader's rule (only post_tool_use) holds for the rewritten text too
    post = postModeOf(postHook ? checkHooks(yaml.load(hooksText)) : loadConfig("hooks.yaml", opts));
  } catch (e) {
    post = { error: e.message };
  }
  const { models, mcp } = config;
  const { platforms } = config.platforms;
  const names = Object.keys(perms.resolved.agents);
  const { sources, errors } = loadSources(fwRoot, names);
  errors.push(...validateMcp(mcp));
  if (post.error) errors.push(post.error);
  const forbidden = forbiddenIdentifiers(platforms);
  for (const [name, s] of Object.entries(sources)) {
    errors.push(...lintBody(name, s.body, forbidden), ...lintFwToken(name, s.body));
    s.body = expandFw(s.body, fw); // the one substitution: a body's framework paths, from the workspace
  }

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
      outputs.set(rel, renderer.render({ name, ...s, caps, tools: toolNames(caps, platform, mcp.browser_server), model, platform, browserServer: mcp.browser_server, fw }));
    }
    const abs = path.join(ws, dir);
    for (const f of existsSync(abs) ? readdirSync(abs) : [])
      if (f.startsWith(prefix) && f.endsWith(suffix) && !expected.has(`${dir}/${f}`))
        errors.push(`${dir}/${f}: not generated from agents/ (no source or no permissions row); remove it or add agents/<name>.md`);
    if (platform.mcp_config) outputs.set(platform.mcp_config.path, renderMcpConfig(mcp, platform.mcp_config.key, fw));
  }

  if (!post.error) {
    const settingsFile = path.join(ws, CLAUDE_SETTINGS);
    try {
      for (const [rel, content] of renderHookRegistrations(post.mode, existsSync(settingsFile) ? readFileSync(settingsFile, "utf8") : undefined, fw)) outputs.set(rel, content);
    } catch (e) {
      errors.push(`${CLAUDE_SETTINGS}: ${e.message}`);
    }
  }

  const changed = [];
  if (errors.length) return { errors, changed };
  // --post-hook saves the mode in the framework's config/hooks.yaml (a human's command), the rest into the workspace
  const files = new Map([...outputs].map(([rel, content]) => [rel, { file: path.join(ws, rel), content }]));
  if (postHook && !post.error) files.set(HOOKS_CONFIG, { file: configPath("hooks.yaml", opts), content: hooksText });
  for (const [rel, { file, content }] of files) {
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
  const { values } = parseArgs({ options: { check: { type: "boolean" }, "post-hook": { type: "string" } } });
  const check = Boolean(values.check);
  const { errors, changed } = build({ check, postHook: values["post-hook"] });
  for (const e of errors) console.error(`error: ${e}`);
  for (const f of changed) console.log(`${check ? "drift" : "built"}: ${f}`);
  console.log(`${changed.length} generated file(s) ${check ? "out of date" : "written"}, ${errors.length} error(s).`);
  if (errors.length || (check && changed.length)) process.exit(1);
}
