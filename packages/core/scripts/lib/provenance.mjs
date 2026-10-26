// What a run was made with (D-077), recorded once by `run.mjs init` into run.json `provenance` and carried into the
// report, so two runs' results can be told apart by more than their date: the framework's commit (and whether the
// working tree had changes), the browser server's package, the models each platform's agents are configured with, a
// digest of the templates the generated code is rendered from, the Node.js version, and where each framework config file
// came from (overridden by the workspace or not, docs/packaging.md §3.4). Nothing here is a secret.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { CONFIG_FILES, configLocation, configSource, loadConfig } from "./config.mjs";
import { isInstalled, sameDir, workspaceRoot } from "./roots.mjs";

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
// workspace whose atf/ may override that config.
// -> {framework: {commit, dirty} | null, browserServer, models, templates, node, config: [configSource]}
export function collectProvenance(framework, workspace = workspaceRoot) {
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
