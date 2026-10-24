// What a run was made with (D-077), recorded once by `run.mjs init` into run.json `provenance` and carried into the
// report, so two runs' results can be told apart by more than their date: the framework's commit (and whether the
// working tree had changes), the browser server's package, the models each platform's agents are configured with, a
// digest of the templates the generated code is rendered from, and the Node.js version. Nothing here is a secret.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

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

const readYaml = (f) => {
  try {
    return yaml.load(readFileSync(f, "utf8")) ?? {};
  } catch {
    return {};
  }
};

// -> {framework: {commit, dirty} | null, browserServer, models, templates, node}
export function collectProvenance(root) {
  const commit = git(root, ["rev-parse", "HEAD"]);
  const status = commit ? git(root, ["status", "--porcelain", "--untracked-files=no"]) : null;
  const mcp = readYaml(path.join(root, "config", "mcp.yaml"));
  const server = mcp.servers?.[mcp.browser_server];
  const models = readYaml(path.join(root, "config", "models.yaml"));
  const templates = path.join(root, "templates");
  return {
    framework: commit ? { commit, dirty: !!status } : null,
    browserServer: (server?.args ?? []).map(String).find((a) => /^@playwright\/mcp(@|$)/.test(a)) ?? null,
    models: { default: models.default ?? {}, agents: models.agents ?? {} },
    // LF-normalized, so a checkout on any OS gives the same digest
    templates: sha(walk(templates).map((f) => `${f}\n${readFileSync(path.join(templates, f), "utf8").replace(/\r\n/g, "\n")}`).join("\n\0")),
    node: process.version,
  };
}
