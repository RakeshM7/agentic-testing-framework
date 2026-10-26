// What a run was made with (D-077), recorded once by `run.mjs init` into run.json `provenance` and carried into the
// report, so two runs' results can be told apart by more than their date: the framework's commit (and whether the
// working tree had changes), the browser server's package, the models each platform's agents are configured with, a
// digest of the templates the generated code is rendered from, the Node.js version, and where each framework config file
// came from (overridden by the workspace or not, docs/packaging.md §3.4), and the package's own name and version
// (docs/packaging.md §3.10: semver; the commit is null once installed, so the version is what tells two releases apart).
// Nothing here is a secret.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { CONFIG_FILES, configLocation, configSource, loadConfig } from "./config.mjs";
import { isInstalled, sameDir, workspaceRoot } from "./roots.mjs";

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
// -> {framework: {commit, dirty} | null, package: {name, version} | null, plugin: null, browserServer, models,
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
    // the Claude Code plugin's version, version-locked to the package (packaging §3.12): filled in phase 6
    plugin: null,
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
