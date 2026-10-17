// Shared fixtures for the node:test suites: a throwaway repo root with the real config/permissions.yaml.
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { HEADERS } from "./lib/clarifications.mjs";
import { paths, repoRoot } from "./lib/contract.mjs";
import { parseCsv, serializeCsv } from "./lib/csv.mjs";
import { knowledgePaths, mergeGlossary, registerSource, render, runCheck, storeSnapshot } from "./lib/knowledge.mjs";
import { recordCanary } from "./lib/guard-check.mjs";
import { initRun } from "./run.mjs";

export function tempRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "atf-"));
  mkdirSync(path.join(root, "config"));
  copyFileSync(path.join(repoRoot, "config", "permissions.yaml"), path.join(root, "config", "permissions.yaml"));
  return root;
}

export function writeConfig(root, { mode = "readonly", policy, product = "acme", apiUrls, extra = [] } = {}) {
  const file = path.join(root, "config", `${product}.yaml`);
  writeFileSync(
    file,
    [
      `product: ${product}`,
      apiUrls ? `target: {url: 'https://app.acme.test', api_urls: [${apiUrls.map((u) => `'${u}'`).join(", ")}]}` : "target: {url: 'https://app.acme.test'}",
      ...extra,
      "modules:",
      "  - {slug: contacts, name: Contacts, entry_url: 'https://app.acme.test/contacts'}",
      "  - {slug: deals, name: Deals, nav_path: [Deals]}",
      `authorizations: {mode: ${mode}}`,
      ...(policy ? [`clarifications: {unresolved_policy: ${policy}}`] : []),
    ].join("\n")
  );
  return file;
}

// A started run whose session has passed the guard liveness check (as on Claude Code), unless `verified: false`.
export function startRun(opts = {}) {
  const root = tempRoot();
  const r = initRun(writeConfig(root, opts), { root, runId: opts.runId ?? "acme-run-1", env: { CLAUDECODE: "1" } });
  if (r.errors) throw new Error(r.errors.join("\n"));
  if (opts.verified !== false) recordCanary(r.product, root, { host: "claude-code", agent: "orchestrator-agent" });
  return { root, run: r.run, product: r.product };
}

export function put(root, rel, content) {
  const p = path.join(root, rel);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, content);
}

// A valid product-level knowledge pass, the way the knowledge-generator produces it (via the scripts): every heading,
// one Main areas bullet per module, a tagged open point, rendered, checked and stamped (D-051).
export function writeProductKnowledge(root, product = "acme") {
  const p = paths(product, root);
  const kp = knowledgePaths(p.productDir);
  const cfg = JSON.parse(readFileSync(p.configFile, "utf8"));
  const s = registerSource(kp, cfg, { title: "Acme help center", location: "https://help.acme.test", type: "vendor-doc", runId: "acme-run-1" });
  const cite = `[${s.id}]`;
  put(root, `artifacts/${product}/knowledge/overview.md`, [
    "# Acme CRM", "",
    "## What it is", "", `Acme is a CRM for small sales teams ${cite}.`, "",
    "## Users and roles", "", `- Sales reps and their managers ${cite}.`, "",
    "## Main areas", "", ...cfg.modules.map((m) => `- **${m.name}**: the ${m.name.toLowerCase()} area ${cite}.`), "",
    "## Key concepts", "", `- Leads become contacts ${cite}.`, "",
    "## Integrations", "", `- Email sync ${cite}.`, "",
    "## Constraints and limits", "", `- Plans limit the number of seats ${cite}.`, "",
    "## Open points", "", "- (limits) The seat limit per plan is not documented.", "",
  ].join("\n"));
  put(root, `artifacts/${product}/knowledge/glossary.md`, `# Glossary

| Term | Definition | Scope | Sources |
|---|---|---|---|
| Lead | A prospective customer ${cite} | product | ${cite} |
`);
  render(kp, undefined, { runId: "acme-run-1" });
  const r = runCheck(kp, cfg, { runId: "acme-run-1" });
  if (!r.valid) throw new Error(`writeProductKnowledge: ${r.problems.join("\n")}`);
  return { kp, sourceId: s.id, cfg };
}

// A valid module pass: every notes heading, a quoted rule fact verified against the cached source text, the other
// categories cited or named by a tagged open point; merged, rendered, checked and stamped.
export function writeModuleKnowledge(root, module, product = "acme") {
  const p = paths(product, root);
  const kp = knowledgePaths(p.productDir);
  const cfg = JSON.parse(readFileSync(p.configFile, "utf8"));
  const s = registerSource(kp, cfg, { title: `${module} guide`, location: `https://help.acme.test/${module}`, type: "vendor-doc", module, runId: "acme-run-1" });
  storeSnapshot(kp, s.id, `<h1>${module}</h1>
Records can be bulk-updated.
A record name must be unique within the account.
Only admins can delete records.`, { captured_by: "script", runId: "acme-run-1" });
  const c = `[${s.id}]`;
  const dir = `artifacts/${product}/knowledge/modules/${module}`;
  put(root, `${dir}/overview.md`, `# ${module}

## Purpose

The ${module} module stores records ${c}.

## Who uses it

- Sales reps ${c}.

## Where it is

- The main menu ${c}.

## Open points

- (flows) The import flow is not documented.
`);
  put(root, `${dir}/glossary.md`, `| Term | Definition | Sources |
|---|---|---|
| Owner | User responsible for the record | ${c} |
`);
  put(root, `${dir}/notes.md`, [
    "## How it works", "", `- Records can be bulk-updated ${c}.`, "",
    "## Key entities and fields", "", `- A record has a name [${s.id} "a record name must be unique"].`, "",
    "## Key actions and flows", "", "## Business rules and validations", "", `- Record names are unique per account [${s.id} "must be unique within the account"].`, "",
    "## Roles and permissions", "", `- Admins delete records [${s.id} "Only admins can delete records"].`, "",
    "## Limits and constraints", "", "## Dependencies on other modules", "",
    "## Open points", "", "- (limits) Whether there is a maximum number of records is not documented.", "- (dependencies) Whether deals reference records is not documented.", "",
  ].join("\n"));
  mergeGlossary(kp, module);
  render(kp, module, { runId: "acme-run-1" });
  const r = runCheck(kp, cfg, { module, runId: "acme-run-1" });
  if (!r.valid) throw new Error(`writeModuleKnowledge(${module}): ${r.problems.join("\n")}`);
  return { kp, sourceId: s.id, cfg };
}

// A human editing clarifications.csv in Excel: set one row's Answer status (and optionally its Answer) directly.
export function humanEdit(file, id, { status, answer }) {
  const rows = parseCsv(readFileSync(file, "utf8"));
  const row = rows.find((r) => r[0] === id);
  if (!row) throw new Error(`${id}: no such row`);
  if (answer !== undefined) row[HEADERS.indexOf("Answer")] = answer;
  if (status !== undefined) row[HEADERS.indexOf("Answer status")] = status;
  writeFileSync(file, serializeCsv(rows));
}
