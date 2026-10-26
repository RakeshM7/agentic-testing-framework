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
// A workspace's add-on fragments, atf/agents/<name>.extra.md, are appended to their agents' bodies (docs/packaging.md
// §3.5, scripts/lib/agents/source.mjs), read from the workspace also when it is the framework's own directory; every
// body check below measures the combined text, and its errors name both files.
// Nothing generated is ever edited by hand: change a source or config, then rebuild.
//
// An agent file with no source in the agent folders (.claude/agents/*.md, .github/agents/*.agent.md):
//   source checkout (this monorepo)   always an error: every file there is ours (D-018)
//   installed (a client's workspace)  the folders are shared with the client's own agents, told apart by the generated
//                                     marker (renderers/common.mjs isGenerated): a marked file is an agent the package
//                                     dropped, removed by a build and reported by --check; an unmarked one is the
//                                     client's and never touched, unless its file or its name: is a framework agent's,
//                                     an error naming it (the build would overwrite it, or the hosts confuse the two)
//
// The MCP config files are rendered whole. Installed, a server (or top-level key) already in one that the effective
// mcp.yaml doesn't produce is the client's, added by hand: an error naming it and where it belongs (lib/mcp.mjs), so a
// sync never drops it silently. In .claude/settings.json the build owns only the framework's own hook entries; the
// client's hooks and other keys are kept, in both kinds of workspace (lib/hook-registrations.mjs).
//
//   node scripts/build-agents.mjs           write every generated file that differs
//   node scripts/build-agents.mjs --check   write nothing; exit 1 on drift, a missing/stray source, or a stray output
//   node scripts/build-agents.mjs --post-hook <async|sync|off>   save that mode in the framework's config/hooks.yaml,
//                                                                then build (refused while atf/ overrides hooks.yaml)
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import yaml from "js-yaml";
import { checkHooks, configLocation, configPath, configRel, loadConfig } from "./lib/config.mjs";
import { resolvePermissions } from "./lib/permissions.mjs";
import { expandFw, frameworkRoot, frameworkRel, isInstalled, workspaceRoot } from "./lib/roots.mjs";
import { capabilitiesFor, toolNames } from "./lib/agents/capabilities.mjs";
import { checkBodyLimit, forbiddenIdentifiers, lintBody, lintFwToken } from "./lib/agents/lint.mjs";
import { loadSources, splitFrontmatter } from "./lib/agents/source.mjs";
import { foreignMcpEntries, renderMcpConfig, validateMcp } from "./lib/mcp.mjs";
import { CLAUDE_SETTINGS, HOOKS_CONFIG, postModeOf, renderHookRegistrations, setPostMode } from "./lib/hook-registrations.mjs";
import { isGenerated } from "./lib/agents/renderers/common.mjs";
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
  // a client's workspace (the framework inside node_modules) or a source checkout: decides the generated note's wording
  // and what an agent file without a source is (below)
  const installed = isInstalled(fwRoot);
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
  const { sources, errors } = loadSources(fwRoot, names, { workspace: ws });
  const label = (name) => (sources[name]?.fragment ? `agents/${name}.md + ${sources[name].fragment}` : undefined);
  errors.push(...validateMcp(mcp));
  if (post.error) errors.push(post.error);
  const forbidden = forbiddenIdentifiers(platforms);
  for (const [name, s] of Object.entries(sources)) {
    errors.push(...lintBody(name, s.body, forbidden, label(name)), ...lintFwToken(name, s.body, label(name)));
    s.body = expandFw(s.body, fw); // the one substitution: a body's framework paths, from the workspace
  }

  const outputs = new Map(); // repo-relative path -> content
  const stray = new Set(); // installed only: our marked agent files with no source, removed by a build
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
      errors.push(...checkBodyLimit(name, s.body, key, platform, label(name)));
      const caps = capabilitiesFor(perms.resolved.agents[name]);
      const rel = platform.output.replaceAll("{name}", name);
      expected.add(rel);
      outputs.set(rel, renderer.render({ name, ...s, caps, tools: toolNames(caps, platform, mcp.browser_server), model, platform, browserServer: mcp.browser_server, fw, installed }));
    }
    const abs = path.join(ws, dir);
    const entries = existsSync(abs) ? readdirSync(abs, { withFileTypes: true }) : [];
    if (!installed) {
      // a source checkout: every agent file here is ours, so one without a source is an error (D-018)
      for (const { name: f } of entries)
        if (f.startsWith(prefix) && f.endsWith(suffix) && !expected.has(`${dir}/${f}`))
          errors.push(`${dir}/${f}: not generated from agents/ (no source or no permissions row); remove it or add agents/<name>.md`);
    } else {
      // a client's workspace: these folders also hold the client's own agents, told from ours by the generated marker
      const ours = new Map(Object.keys(sources).map((name) => [platform.output.replaceAll("{name}", name).toLowerCase(), name]));
      for (const entry of entries) {
        const f = entry.name;
        if (!entry.isFile() || !f.startsWith(prefix) || !f.endsWith(suffix)) continue;
        const rel = `${dir}/${f}`;
        let text;
        try {
          text = readFileSync(path.join(abs, f), "utf8");
        } catch (e) {
          errors.push(`${rel}: ${e.message}`);
          continue;
        }
        // compared without case: on a case-insensitive disk (Windows, macOS) PW-UI-Fixer.md IS pw-ui-fixer.md
        const own = ours.get(rel.toLowerCase());
        if (isGenerated(text)) {
          if (!own) stray.add(rel); // an agent the package dropped (or renamed): sync removes it, check reports it
          continue;
        }
        if (own) {
          errors.push(`${rel}: your own agent (no GENERATED marker), but the framework's agent '${own}' is written to this file, so atf sync would overwrite it: rename your file and its name: to one the framework does not use`);
          continue;
        }
        // the hosts know an agent by its frontmatter name, and the guard keys a framework agent's ceiling on it (D-021)
        let meta;
        try {
          ({ meta } = splitFrontmatter(text, rel));
        } catch {
          continue; // not ours to judge: the host will report a file it can't load
        }
        if (typeof meta?.name === "string" && Object.hasOwn(sources, meta.name))
          errors.push(`${rel}: your own agent is named '${meta.name}', the name of a framework agent; rename it (its name: and file) to one the framework does not use`);
      }
    }
    if (platform.mcp_config) {
      const { path: rel, key } = platform.mcp_config;
      // installed: the file is rendered whole, so a server or key the client added by hand would vanish on sync; it is
      // an error naming it, with where it belongs, and nothing is written (lib/mcp.mjs foreignMcpEntries). A source
      // checkout's MCP files are all ours (D-018), rendered as they always were.
      const file = path.join(ws, rel);
      if (installed && existsSync(file)) {
        try {
          errors.push(...foreignMcpEntries(readFileSync(file, "utf8"), { rel, key, servers: mcp.servers, ejected: configLocation("mcp.yaml", opts).source === "ejected" }));
        } catch (e) {
          errors.push(`${rel}: ${e.message}`);
        }
      }
      outputs.set(rel, renderMcpConfig(mcp, key, fw));
    }
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
  // a dropped agent's files go once nothing else failed, like every write; listed as changed (check: still there)
  for (const rel of stray) {
    changed.push(rel);
    if (!check) rmSync(path.join(ws, rel), { force: true });
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
