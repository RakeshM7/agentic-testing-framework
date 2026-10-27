#!/usr/bin/env node
// Builds the Claude Code plugin `atf` (docs/packaging.md §3.12, draft P-11, packaging phase 6) into
// packages/claude-plugin/dist, and optionally lays it out as the private marketplace `testagentic`.
//   build-plugin.mjs [--out <dir>]                      build the plugin (default packages/claude-plugin/dist)
//   build-plugin.mjs [--out <dir>] --marketplace <dir>  also write <dir>/.claude-plugin/marketplace.json and copy the
//                                                       plugin to <dir>/plugins/atf/ (the marketplace repo's content)
// Exit 1 with one line per problem; nothing is written when anything fails.
//
// What the plugin holds, all of it rendered from this framework's sources and DEFAULT config, never a workspace's (the
// plugin is one per release, shared by every client):
//   .claude-plugin/plugin.json  name atf, version = @testagentic/atf's (the version lock: run.mjs and the doctor refuse
//                               a session whose plugin differs from the installed package)
//   agents/<name>.md            every framework agent, through the same Claude renderer as atf sync
//                               (lib/agents/renderers/claude.mjs) with `{fw}` expanded as in an installed workspace
//                               (node_modules/@testagentic/atf), so a plugin agent calls the workspace's npm package
//                               exactly as a synced one does. Differences, all forced by how Claude Code loads plugins:
//                                 - its spawn allow-list names the other agents as the plugin addresses them (the
//                                   switch below);
//                                 - browser tools are the plugin server's, mcp__plugin_atf_<server>__browser_<tool>;
//                                 - no mcpServers frontmatter (ignored in a plugin agent; .mcp.json below starts it);
//                                 - its own generated note: neither atf sync nor a workspace's fragments or atf/
//                                   overlays reach it.
//   .mcp.json                   config/mcp.yaml's servers, `{fw}` expanded to ${CLAUDE_PROJECT_DIR}/node_modules/
//                               @testagentic/atf (lib/mcp.mjs renderMcpConfig)
//   hooks/hooks.json            ONLY the SessionStart hook scripts/hooks/plugin-session.mjs, which records the plugin's
//                               version in the workspace. The guard is never in the plugin: PreToolUse and PostToolUse
//                               stay in the project's .claude/settings.json, rendered by atf sync (D-020, D-092), so
//                               disabling or removing the plugin can never switch the guard off
//   README.md                   for clients (packages/claude-plugin/README.client.md, {{version}} filled in)
//
// No plugin file reaches the framework through ${CLAUDE_PLUGIN_ROOT}: the plugin lives in a per-version cache and holds
// no scripts; every framework path goes through the workspace's installed package (${CLAUDE_PROJECT_DIR} in hooks and
// MCP config, the installed `{fw}` in agent bodies, which run from the project directory).
//
// Maintainer-only, like build-package.mjs: never shipped in @testagentic/atf (package-files.txt). The release workflow
// runs it after npm publish and pushes the marketplace folder to the marketplace repository.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { loadConfig } from "./lib/config.mjs";
import { resolvePermissions } from "./lib/permissions.mjs";
import { expandFw, frameworkRoot, isWithin } from "./lib/roots.mjs";
import { capabilitiesFor, toolNames } from "./lib/agents/capabilities.mjs";
import { checkBodyLimit, forbiddenIdentifiers, lintBody, lintFwToken } from "./lib/agents/lint.mjs";
import { loadSources } from "./lib/agents/source.mjs";
import { renderMcpConfig, validateMcp } from "./lib/mcp.mjs";
import { PACKAGE_NAME } from "./lib/agents/renderers/common.mjs";
import { PLUGIN, PLUGIN_RECORD } from "./lib/provenance.mjs";
import * as claude from "./lib/agents/renderers/claude.mjs";
import { modelFor } from "./build-agents.mjs";

// the plugin's and the marketplace's names, and the version record, are the workspace side's (lib/provenance.mjs: the
// opt-in, the mode rule and the version lock), so the two can't disagree
export const PLUGIN_NAME = PLUGIN.name;
export const MARKETPLACE_NAME = PLUGIN.marketplace;
export const PLUGIN_PACKAGE = "@testagentic/atf-claude-plugin";
export const OWNER = { name: "testagentic" };
// the Claude platform of config/platforms.yaml: its renderer, tool names and MCP key are the plugin's too
const PLATFORM = "claude";
// `{fw}` as an installed workspace has it (atf sync's frameworkRel), and the same from the project directory for the
// places Claude Code substitutes ${CLAUDE_PROJECT_DIR} in (hook commands, MCP server arguments)
export const INSTALLED_FW = `node_modules/${PACKAGE_NAME}`;
export const PROJECT_FW = `\${CLAUDE_PROJECT_DIR}/${INSTALLED_FW}`;
export const SESSION_HOOK = "scripts/hooks/plugin-session.mjs";

// ==== THE SUBAGENT-NAME SWITCH ======================================================================================
// How a plugin agent's spawn allow-list (the `Agent(...)` entry of its tools:) names the other plugin agents. Claude
// Code addresses a plugin agent as `<plugin>:<name>` (atf:module-explorer), but its docs (2026-10-27) don't say whether
// a subagent's allow-list must use that form or the bare name. Settle it in a live session
// (docs/claude-plugin-verification.md, check 2); if only bare names work, set this to false, rebuild, and update the
// pinning test in build-plugin.test.mjs. Nothing else depends on it: each agent file keeps its bare `name:` either way.
export const NAMESPACED_SUBAGENTS = true;
// ====================================================================================================================
export const subagentName = (name) => (NAMESPACED_SUBAGENTS ? `${PLUGIN_NAME}:${name}` : name);

const CORE = frameworkRoot;
export const pluginPackageDir = (core = CORE) => path.join(core, "..", "claude-plugin");
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

// Claude Code names a plugin's MCP tools mcp__plugin_<plugin>_<server>__<tool>; the platform's own template
// (mcp__{server}__browser_{tool}) gets the plugin's prefix. Any other shape is an error, so a changed platforms.yaml
// can't silently give the plugin's agents tools that don't exist.
export function pluginBrowserTemplate(template) {
  const from = "mcp__{server}__";
  if (typeof template !== "string" || !template.startsWith(from)) return { error: `config/platforms.yaml: ${PLATFORM}.tools.browser must start with '${from}' for the plugin to rename it (got ${JSON.stringify(template)})` };
  return { template: `mcp__plugin_${PLUGIN_NAME}_{server}__${template.slice(from.length)}` };
}

export const pluginNote = (name, version) =>
  `# GENERATED for the ${PLUGIN_NAME} Claude Code plugin from ${PACKAGE_NAME} ${version} (agents/${name}.md) -- do not edit: it is rebuilt with every release; workspace fragments and atf/ overlays do not reach it.`;

export const sessionHookCommand = (version) => `node "${expandFw(`{fw}/${SESSION_HOOK}`, PROJECT_FW)}" --plugin-version ${version}`;

export const hooksJson = (version) => ({
  description: `Records the ${PLUGIN_NAME} plugin's version in the workspace (${PLUGIN_RECORD}) for the version lock with ${PACKAGE_NAME}. The safety guard is not here: it stays in the project's .claude/settings.json.`,
  hooks: { SessionStart: [{ hooks: [{ type: "command", command: sessionHookCommand(version) }] }] },
});

export const pluginJson = (pkg) => ({
  name: PLUGIN_NAME,
  version: pkg.version,
  description: `The agentic testing framework's agents and browser MCP server for Claude Code. Needs ${PACKAGE_NAME} ${pkg.version} installed in the workspace (npx atf init), which runs every script and the safety guard.`,
  author: OWNER,
  license: pkg.license,
  keywords: ["testing", "playwright", "k6", "agents"],
});

// No version in the marketplace entry: plugin.json's wins anyway, with a warning, so it is set there only.
export const marketplaceJson = () => ({
  name: MARKETPLACE_NAME,
  owner: OWNER,
  metadata: { description: `The private Claude Code marketplace of ${PACKAGE_NAME}'s clients.` },
  plugins: [{ name: PLUGIN_NAME, source: `./plugins/${PLUGIN_NAME}`, description: `The agentic testing framework for Claude Code (version-locked to ${PACKAGE_NAME}).` }],
});

// -> { files: Map<plugin-relative path, content>, errors }. Reads only the framework (`core`): its sources and its
// default config, as the framework's own directory is its workspace (no overlay, ejected file, fragment or dev agent).
export function renderPlugin({ core = CORE } = {}) {
  const errors = [];
  const files = new Map();
  let pkg, config;
  try {
    pkg = JSON.parse(readFileSync(path.join(core, "package.json"), "utf8"));
    const opts = { framework: core, workspace: core };
    config = { permissions: loadConfig("permissions.yaml", opts), models: loadConfig("models.yaml", opts), platforms: loadConfig("platforms.yaml", opts), mcp: loadConfig("mcp.yaml", opts) };
  } catch (e) {
    return { files, errors: [e.message] };
  }
  // the plugin's package.json is version-tied to core's, so a release bumps both or the build says so
  const pluginPkgFile = path.join(pluginPackageDir(core), "package.json");
  if (existsSync(pluginPkgFile)) {
    try {
      const own = JSON.parse(readFileSync(pluginPkgFile, "utf8"));
      if (own.version !== pkg.version) errors.push(`packages/claude-plugin/package.json: version ${own.version} must equal ${PACKAGE_NAME}'s ${pkg.version} (packages/core/package.json)`);
    } catch (e) {
      errors.push(`packages/claude-plugin/package.json: ${e.message}`);
    }
  }
  const perms = resolvePermissions(config.permissions, { fw: INSTALLED_FW });
  if (perms.errors.length) return { files, errors: perms.errors.map((e) => `config/permissions.yaml: ${e}`) };
  const { models, mcp } = config;
  const platform = config.platforms?.platforms?.[PLATFORM];
  if (!platform) return { files, errors: [`config/platforms.yaml: no '${PLATFORM}' platform`] };
  errors.push(...validateMcp(mcp));
  const browser = pluginBrowserTemplate(platform.tools?.browser);
  if (browser.error) errors.push(browser.error);
  const pluginPlatform = { ...platform, tools: { ...platform.tools, browser: browser.template } };
  const forbidden = forbiddenIdentifiers(config.platforms.platforms);

  const names = Object.keys(perms.resolved.agents);
  const loaded = loadSources(core, names);
  errors.push(...loaded.errors);
  for (const [name, s] of Object.entries(loaded.sources)) {
    errors.push(...lintBody(name, s.body, forbidden), ...lintFwToken(name, s.body), ...checkBodyLimit(name, s.body, PLATFORM, platform));
    const model = modelFor(models, name, PLATFORM);
    if (!model) {
      errors.push(`config/models.yaml: no ${PLATFORM} model for ${name}`);
      continue;
    }
    const caps = capabilitiesFor(perms.resolved.agents[name]);
    if (browser.error) continue;
    const tools = toolNames({ ...caps, spawn: caps.spawn.map(subagentName) }, pluginPlatform, mcp.browser_server);
    const body = expandFw(s.body, INSTALLED_FW);
    files.set(`agents/${name}.md`, claude.render({ name, ...s, body, caps, tools, model, browserServer: mcp.browser_server, fw: INSTALLED_FW, installed: true, note: pluginNote(name, pkg.version), mcpServers: false }));
  }
  files.set(".claude-plugin/plugin.json", json(pluginJson(pkg)));
  files.set(".mcp.json", renderMcpConfig(mcp, platform.mcp_config?.key ?? "mcpServers", PROJECT_FW));
  files.set("hooks/hooks.json", json(hooksJson(pkg.version)));
  const readme = path.join(pluginPackageDir(core), "README.client.md");
  if (existsSync(readme)) files.set("README.md", readFileSync(readme, "utf8").replaceAll("{{version}}", pkg.version));
  else errors.push(`packages/claude-plugin/README.client.md: missing (the plugin's README for clients)`);
  return { files, errors };
}

// `out` is emptied before every build, so it must be the plugin's own folder: missing, empty, or a plugin built here.
function outError(out) {
  if (!existsSync(out)) return null;
  const entries = readdirSync(out);
  if (!entries.length || existsSync(path.join(out, ".claude-plugin", "plugin.json"))) return null;
  return `${out} is not empty and holds no built plugin (.claude-plugin/plugin.json); refusing to replace it`;
}

// The marketplace folder (the marketplace repository's working tree): only its .claude-plugin/marketplace.json and
// plugins/atf/ are written; everything else in it (.git, other files) is left alone.
// Compared both ways, as written and with symlinks resolved: a folder that doesn't exist yet resolves as written, while
// its existing parent may not (macOS's /tmp is /private/tmp), so either form alone can miss the overlap.
const overlaps = (a, b) => {
  const plain = (x, d) => x === d || x.startsWith(d.endsWith(path.sep) ? d : d + path.sep);
  return isWithin(a, b) || isWithin(b, a) || plain(a, b) || plain(b, a);
};
function marketplaceError(dir, out) {
  if (overlaps(dir, out)) return `--marketplace ${dir} must be outside the plugin's build folder ${out}, and not contain it`;
  return null;
}

// -> { errors, out, files: [plugin-relative paths written], marketplace?: dir }
export function buildPlugin({ core = CORE, out = path.join(pluginPackageDir(core), "dist"), marketplace } = {}) {
  out = path.resolve(out);
  const { files, errors } = renderPlugin({ core });
  const guard = outError(out);
  if (guard) errors.push(guard);
  if (marketplace !== undefined) {
    marketplace = path.resolve(marketplace);
    const m = marketplaceError(marketplace, out);
    if (m) errors.push(m);
  }
  if (errors.length) return { errors, out, files: [] };
  rmSync(out, { recursive: true, force: true });
  for (const [rel, content] of files) {
    const file = path.join(out, ...rel.split("/"));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content, "utf8");
  }
  if (marketplace !== undefined) {
    const target = path.join(marketplace, "plugins", PLUGIN_NAME);
    rmSync(target, { recursive: true, force: true });
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(out, target, { recursive: true });
    mkdirSync(path.join(marketplace, ".claude-plugin"), { recursive: true });
    writeFileSync(path.join(marketplace, ".claude-plugin", "marketplace.json"), json(marketplaceJson()), "utf8");
  }
  return { errors, out, files: [...files.keys()].sort(), ...(marketplace !== undefined ? { marketplace } : {}) };
}

export function main(argv) {
  const { values } = parseArgs({ args: argv, options: { out: { type: "string" }, marketplace: { type: "string" } }, strict: true });
  const r = buildPlugin({ ...(values.out !== undefined ? { out: values.out } : {}), marketplace: values.marketplace });
  for (const e of r.errors) console.error(`build-plugin: ${e}`);
  if (r.errors.length) return 1;
  console.log(`build-plugin: ${r.files.length} file(s) written to ${r.out}${r.marketplace ? `; marketplace ${MARKETPLACE_NAME} in ${r.marketplace}` : ""}`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
