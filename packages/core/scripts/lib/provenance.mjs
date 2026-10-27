// What a run was made with (D-077), recorded once by `run.mjs init` into run.json `provenance` and carried into the
// report, so two runs' results can be told apart by more than their date: the framework's commit (and whether the
// working tree had changes), the browser server's package, the models each platform's agents are configured with, a
// digest of the templates the generated code is rendered from, the Node.js version, and where each framework config file
// came from (overridden by the workspace or not, docs/packaging.md §3.4), and the package's own name and version
// (docs/packaging.md §3.10: semver; the commit is null once installed, so the version is what tells two releases apart).
// Nothing here is a secret.
//
// It also holds the Claude Code plugin's side of a workspace (docs/packaging.md §3.12, draft P-11), since the plugin's
// version is part of what a run is made with: the opt-in, the mode rule that decides who supplies the Claude Code agents,
// the version record the plugin writes, and the version lock that the doctor and run.mjs init enforce. Kept here, free
// of the build, so run.mjs and the doctor read it without loading the agent build (sync.mjs and build-agents.mjs use it
// to decide what they render).
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { CONFIG_FILES, configLocation, configSource, loadConfig } from "./config.mjs";
import { FRAGMENT_DIR, FRAGMENT_SUFFIX } from "./agents/source.mjs";
import { WORKSPACE_MARKER, frameworkRoot, isInstalled, readMarker, sameDir, workspaceRoot } from "./roots.mjs";

// The framework's package as its own package.json names it, read at run time (never a constant: the release sets the
// version). -> { name, version } | null when it can't be read or lacks either, recorded as unknown, never guessed.
export function packageOf(framework) {
  try {
    const raw = readFileSync(path.join(framework, "package.json"), "utf8");
    const { name, version } = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
    return typeof name === "string" && name && typeof version === "string" && version ? { name, version } : null;
  } catch {
    return null;
  }
}

// The breaking line a semver version belongs to (user, 2026-10-26): its first non-zero component and what comes before
// it. Pre-1.0, a minor bump is breaking (semver's convention), so 0.1.x and 0.2.x are different lines; from 1.0 the
// major is the line; 0.0.x makes every patch its own line. A pre-release or build suffix doesn't change the line.
// "1.4.2" -> "1", "0.3.7" -> "0.3", "0.0.4" -> "0.0.4"; null when the text isn't semver.
export function releaseLine(version) {
  const m = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:[-+][0-9A-Za-z.+-]*)?$/.exec(String(version ?? ""));
  if (!m) return null;
  const [major, minor, patch] = m.slice(1, 4);
  return major !== "0" ? major : minor !== "0" ? `0.${minor}` : `0.0.${patch}`;
}

const sha = (s) => createHash("sha256").update(s).digest("hex");

function git(root, args) {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8", timeout: 10_000 });
  return r.status === 0 ? r.stdout.trim() : null;
}

function walk(dir, base = dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).sort().flatMap((n) => {
    const f = path.join(dir, n);
    return statSync(f).isDirectory() ? walk(f, base) : [path.relative(base, f).replaceAll("\\", "/")];
  });
}

// the effective config the workspace builds its agents from (scripts/lib/config.mjs: the framework's, or overridden
// under the workspace's atf/)
const readConfig = (name, framework, workspace) => {
  try {
    return loadConfig(name, { framework, workspace }) ?? {};
  } catch {
    return {};
  }
};

// Every config file, in CONFIG_FILES order, as scripts/lib/config.mjs configSource gives it: {name, source: framework |
// overlay | ejected, files (base first), digest (sha256 of the effective text)}. Untouched files are listed too, so a
// reader sees `framework` rather than guessing from an absence. A file that cannot be read (missing, or an overlay that
// is not a YAML mapping) keeps its location with digest null: recorded as unknown, never guessed, and init is not the
// place that rejects it (the build and resolvePermissions are).
function configProvenance(framework, workspace) {
  const opts = { framework, workspace };
  return CONFIG_FILES.map((name) => {
    try {
      return configSource(name, opts);
    } catch {
      return { ...configLocation(name, opts), digest: null };
    }
  });
}

// framework: the framework root the run is made with (D-085: its commit, config and templates); workspace: the
// workspace whose atf/ may override that config. pkg: the package's {name, version}, read from the framework's
// package.json unless given (tests fake a version through it).
// -> {framework: {commit, dirty} | null, package: {name, version} | null, plugin: {name, version} | null, browserServer, models,
//     templates, node, config: [configSource]}
export function collectProvenance(framework, workspace = workspaceRoot, { pkg = packageOf(framework) } = {}) {
  // only a checkout of the framework itself (its own repository, or a source folder in one, as the monorepo's
  // packages/core): an installed framework inside a workspace's repository has no commit of its own. Its changes are
  // the ones under the framework's folder.
  const top = git(framework, ["rev-parse", "--show-toplevel"]);
  const commit = top && (sameDir(top, framework) || !isInstalled(framework)) ? git(framework, ["rev-parse", "HEAD"]) : null;
  const status = commit ? git(framework, ["status", "--porcelain", "--untracked-files=no", "--", "."]) : null;
  const mcp = readConfig("mcp.yaml", framework, workspace);
  const server = mcp.servers?.[mcp.browser_server];
  const models = readConfig("models.yaml", framework, workspace);
  const templates = path.join(framework, "templates");
  return {
    framework: commit ? { commit, dirty: !!status } : null,
    // the release the run was made with; run.mjs init --resume compares its line (releaseLine) with the running one
    package: pkg,
    // the Claude Code plugin the run's session used, version-locked to the package (packaging §3.12): its recorded
    // version in plugin mode, else null (no plugin in use, or none recorded yet)
    plugin: pluginProvenance(workspace, framework),
    browserServer: (server?.args ?? []).map(String).find((a) => /^@playwright\/mcp(@|$)/.test(a)) ?? null,
    models: { default: models.default ?? {}, agents: models.agents ?? {} },
    // LF-normalized, so a checkout on any OS gives the same digest
    templates: sha(walk(templates).map((f) => `${f}\n${readFileSync(path.join(templates, f), "utf8").replace(/\r\n/g, "\n")}`).join("\n\0")),
    node: process.version,
    // which config files this workspace overlaid or ejected, with digests: the report flags a permissions.yaml that is not
    // the framework's own copy as a custom safety ceiling (scripts/report-data.mjs customConfig)
    config: configProvenance(framework, workspace),
  };
}

// ---- the Claude Code plugin (docs/packaging.md §3.12, draft P-11) --------------------------------------------------
//
// The plugin `atf`, from the private marketplace `testagentic`, carries the Claude Code agents (addressed atf:<name>)
// and the MCP servers, at the package's own version. Never the guard: its PreToolUse and PostToolUse registrations stay
// in .claude/settings.json in every mode (D-020, D-092; user, 2026-10-27). Its script calls still run the workspace's
// npm package, since a prompt body can't resolve the plugin's own folder.
//
// The opt-in, in atf/atf.json (read through roots.mjs readMarker, like "cloud_agent"):
//   "claude_plugin": true        a boolean; anything else is an error naming the file. Honoured only with the framework
//                                installed: a source checkout's Claude Code agents are its committed files (D-018), so
//                                true there is an error too
//   "plugin_marketplace": "…"    required with it: the marketplace's git repository the client was given access to, a
//                                git URL or GitHub's owner/repo; sync writes it into .claude/settings.json for the team
//
// The mode rule (user, 2026-10-27: "plugin agents + sync overrides"). The plugin's agents are the package's, rendered
// from the framework's own config, and a plugin can't carry a client's changes. So a workspace that changes what a
// Claude Code agent is keeps the project's agents:
//   an add-on fragment, atf/agents/<name>.extra.md (D-090)
//   permissions.yaml, models.yaml, platforms.yaml or mcp.yaml that is not the framework's: an overlay or an ejected
//   copy (D-088). hooks.yaml is not one: the hook registrations are the project's in every mode
// -> agents "plugin":  sync renders neither .claude/agents/ nor .mcp.json; the session opens atf:orchestrator-agent
//    agents "project": sync renders both as it does without the plugin (bare names); the plugin's atf: agents stay
//                      installed but unused
//
// The version lock (P-11). The plugin's SessionStart hook writes PLUGIN_RECORD, { plugin, version, at }, whenever a
// Claude Code session starts with it enabled. In plugin mode that version must be the installed package's: the doctor's
// base group fails on another (a missing record only warns: no session has started yet), and run.mjs init refuses a new
// run or a resume. A record older than the install is fine as long as the versions match.
export const PLUGIN = { name: "atf", marketplace: "testagentic" };
export const PLUGIN_ID = `${PLUGIN.name}@${PLUGIN.marketplace}`;
export const PLUGIN_RECORD = "artifacts/.atf-plugin.json";
export const CLAUDE_PLUGIN_KEY = "claude_plugin";
export const MARKETPLACE_KEY = "plugin_marketplace";
// the config files whose override changes a Claude Code agent's file or its MCP servers
export const CLAUDE_CONFIG = ["permissions.yaml", "models.yaml", "platforms.yaml", "mcp.yaml"];

// GitHub's owner/repo, or a git URL (https, ssh or git scheme, or scp-like git@host:path), as git clone takes it.
const GITHUB_REPO = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/;
const GIT_URL = /^(?:(?:https?|ssh|git):\/\/[^\s/]+\/\S+|[\w.-]+@[\w.-]+:\S+)$/;

// atf.json's "plugin_marketplace" -> Claude Code's marketplace source object (settings extraKnownMarketplaces.<name>
// .source: {source: "github", repo} or {source: "git", url}), or null for anything else.
export function marketplaceSource(value) {
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (GITHUB_REPO.test(s)) return { source: "github", repo: s };
  if (GIT_URL.test(s)) return { source: "git", url: s };
  return null;
}

// atf.json's object (null without one) -> { on: false } | { on: true, marketplace: <source object> } | { error }.
// installed: whether the framework is installed (roots.mjs isInstalled). The marketplace is read only with the opt-in.
export function claudePluginOf(cfg, { installed = true } = {}) {
  const key = `${WORKSPACE_MARKER} "${CLAUDE_PLUGIN_KEY}"`;
  const v = cfg?.[CLAUDE_PLUGIN_KEY];
  if (v === undefined || v === false) return { on: false };
  if (v !== true) return { error: `${key} must be true or false, not ${JSON.stringify(v)}` };
  if (!installed) return { error: `${key}: the Claude Code plugin serves a workspace with @testagentic/atf installed, while this is the framework's source checkout, whose Claude Code agents are its committed files (D-018); remove the key` };
  const mkey = `${WORKSPACE_MARKER} "${MARKETPLACE_KEY}"`;
  const raw = cfg[MARKETPLACE_KEY];
  if (raw === undefined) return { error: `${mkey} is required with "${CLAUDE_PLUGIN_KEY}": true: the plugin marketplace's repository you were given access to, as a git URL or GitHub's owner/repo` };
  const marketplace = marketplaceSource(raw);
  if (!marketplace) return { error: `${mkey} must be a git URL (https://…, ssh://…, git@host:path) or GitHub's owner/repo, not ${JSON.stringify(raw)}` };
  return { on: true, marketplace };
}

// The workspace's opt-in -> as claudePluginOf
export function claudePlugin(workspace = workspaceRoot, framework = frameworkRoot) {
  const m = readMarker(workspace);
  return m.error ? { error: m.error } : claudePluginOf(m.cfg, { installed: isInstalled(framework) });
}

// What the workspace changes in a Claude Code agent: each one as a person finds it, workspace-relative with what it is,
// config files first (CLAUDE_CONFIG order), then the fragments (sorted, the same on every OS). Reads only file names.
export function claudeCustomizations({ workspace = workspaceRoot, framework = frameworkRoot } = {}) {
  const out = [];
  for (const name of CLAUDE_CONFIG) {
    const { source, files } = configLocation(name, { framework, workspace });
    if (source !== "framework") out.push(`${files.at(-1)} (${source === "ejected" ? "ejected" : "an overlay"})`);
  }
  let entries = [];
  try {
    entries = readdirSync(path.join(workspace, ...FRAGMENT_DIR.split("/")), { withFileTypes: true });
  } catch {}
  const fragments = entries.filter((e) => e.isFile() && !e.name.startsWith(".") && e.name.endsWith(FRAGMENT_SUFFIX) && e.name !== FRAGMENT_SUFFIX).map((e) => e.name).sort();
  return [...out, ...fragments.map((f) => `${FRAGMENT_DIR}/${f} (an add-on fragment)`)];
}

// The mode rule (see above) -> { on: false } | { on: true, agents: "plugin" | "project", customizations, marketplace }
// | { error } (the opt-in's)
export function claudeMode({ workspace = workspaceRoot, framework = frameworkRoot } = {}) {
  const opt = claudePlugin(workspace, framework);
  if (!opt.on) return opt;
  const customizations = claudeCustomizations({ workspace, framework });
  return { on: true, agents: customizations.length ? "project" : "plugin", customizations, marketplace: opt.marketplace };
}

// The name Claude Code knows a framework agent by: the plugin's scoped atf:<name> when the plugin supplies the agents,
// else the bare name of the project's agent file.
export const claudeAgentName = (name, mode) => (mode?.on && mode.agents === "plugin" ? `${PLUGIN.name}:${name}` : name);

// The plugin's version record -> { record: { version, at } | null (none yet) } | { error }
export function pluginRecord(workspace = workspaceRoot) {
  const file = path.join(workspace, ...PLUGIN_RECORD.split("/"));
  if (!existsSync(file)) return { record: null };
  let rec;
  try {
    const raw = readFileSync(file, "utf8");
    rec = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
  } catch (e) {
    return { error: `${PLUGIN_RECORD} could not be read as JSON (${e.message})` };
  }
  if (!rec || typeof rec !== "object" || Array.isArray(rec) || rec.plugin !== PLUGIN.name || typeof rec.version !== "string" || !rec.version)
    return { error: `${PLUGIN_RECORD} must hold { "plugin": "${PLUGIN.name}", "version": "<version>", "at": "<time>" }, as the plugin writes it` };
  return { record: { version: rec.version, at: typeof rec.at === "string" ? rec.at : null } };
}

// run.json provenance.plugin: { name, version } in plugin mode with a version recorded, else null (no plugin in use,
// whatever an earlier session left behind, or none recorded yet). Never throws: provenance records, init refuses.
export function pluginProvenance(workspace = workspaceRoot, framework = frameworkRoot) {
  try {
    if (!claudeMode({ workspace, framework }).on) return null;
    const { record } = pluginRecord(workspace);
    return record ? { name: PLUGIN.name, version: record.version } : null;
  } catch {
    return null;
  }
}

// The version lock, as a doctor check without its id -> null outside plugin mode (or with an opt-in error, which sync
// and the doctor's host-files check report) | { ok, level?, detail, fix? }. run.mjs init refuses on a failing one.
// pkg: the installed package's {name, version} (tests fake a release through it).
export function pluginVersionCheck({ workspace = workspaceRoot, framework = frameworkRoot, pkg = packageOf(framework) } = {}) {
  if (!claudeMode({ workspace, framework }).on) return null;
  const session = "start a Claude Code session in the workspace (claude, accepting its trust dialog): the plugin records its version when a session starts";
  const r = pluginRecord(workspace);
  if (r.error) return { ok: false, level: "fail", detail: r.error, fix: `delete it, then ${session}` };
  if (!r.record)
    return { ok: true, level: "warn", detail: `the ${PLUGIN_ID} plugin has recorded no version in this workspace yet (${PLUGIN_RECORD}): no Claude Code session has started here with it enabled`, fix: `${session}; if Claude Code says the plugin is not installed, claude plugin install ${PLUGIN_ID} --scope project` };
  const { version, at } = r.record;
  if (!pkg) return { ok: false, level: "fail", detail: `the ${PLUGIN_ID} plugin is ${version}, and the installed framework's own version can't be read from its package.json, so the two can't be compared`, fix: "reinstall the package (npm install in the workspace)" };
  if (version === pkg.version) return { ok: true, detail: `the ${PLUGIN_ID} plugin is ${version}, the installed ${pkg.name}'s version` };
  return {
    ok: false,
    level: "fail",
    detail: `the ${PLUGIN_ID} plugin is ${version} (${PLUGIN_RECORD}${at ? `, recorded ${at}` : ""}) and the installed ${pkg.name} is ${pkg.version}: the two are released together and must be the same version`,
    fix: `update whichever is behind: claude plugin update ${PLUGIN_ID}, then start a new Claude Code session (it records the plugin's version); or npm install --save-dev ${pkg.name}@${version} (in the workspace)`,
  };
}
