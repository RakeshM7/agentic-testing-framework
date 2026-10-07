// Shared fixtures for the node:test suites: a throwaway repo root with the real config/permissions.yaml.
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { paths, repoRoot } from "./lib/contract.mjs";
import { addSource, knowledgePaths, mergeGlossary, render } from "./lib/knowledge.mjs";
import { initRun } from "./run.mjs";

export function tempRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "atf-"));
  mkdirSync(path.join(root, "config"));
  copyFileSync(path.join(repoRoot, "config", "permissions.yaml"), path.join(root, "config", "permissions.yaml"));
  return root;
}

export function writeConfig(root, { mode = "readonly", policy, product = "acme" } = {}) {
  const file = path.join(root, "config", `${product}.yaml`);
  writeFileSync(
    file,
    [
      `product: ${product}`,
      "target: {url: 'https://app.acme.test'}",
      "modules:",
      "  - {slug: contacts, name: Contacts, entry_url: 'https://app.acme.test/contacts'}",
      "  - {slug: deals, name: Deals, nav_path: [Deals]}",
      `authorizations: {mode: ${mode}}`,
      ...(policy ? [`clarifications: {unresolved_policy: ${policy}}`] : []),
    ].join("\n")
  );
  return file;
}

export function startRun(opts = {}) {
  const root = tempRoot();
  const r = initRun(writeConfig(root, opts), { root, runId: opts.runId ?? "acme-run-1" });
  if (r.errors) throw new Error(r.errors.join("\n"));
  return { root, run: r.run, product: r.product };
}

export function put(root, rel, content) {
  const p = path.join(root, rel);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, content);
}

// A valid product-level knowledge pass, the way the knowledge-generator produces it (via the scripts).
export function writeProductKnowledge(root, product = "acme") {
  const kp = knowledgePaths(paths(product, root).productDir);
  const s = addSource(kp, { title: "Acme help center", location: "https://help.acme.test", type: "vendor-doc", scope: "_product", runId: "acme-run-1" });
  put(root, `artifacts/${product}/knowledge/overview.md`, `# Acme CRM\n\nAcme is a CRM for small sales teams [${s.id}].\n`);
  put(root, `artifacts/${product}/knowledge/glossary.md`, `# Glossary\n\n| Term | Definition | Scope | Sources |\n|---|---|---|---|\n| Lead | A prospective customer [${s.id}] | product | [${s.id}] |\n`);
  render(kp);
  return { kp, sourceId: s.id };
}

export function writeModuleKnowledge(root, module, product = "acme") {
  const kp = knowledgePaths(paths(product, root).productDir);
  const s = addSource(kp, { title: `${module} guide`, location: `https://help.acme.test/${module}`, type: "vendor-doc", scope: module, runId: "acme-run-1" });
  const dir = `artifacts/${product}/knowledge/modules/${module}`;
  put(root, `${dir}/overview.md`, `# ${module}\n\nThe ${module} module stores records [${s.id}].\n`);
  put(root, `${dir}/glossary.md`, `| Term | Definition | Sources |\n|---|---|---|\n| Owner | User responsible for the record | [${s.id}] |\n`);
  put(root, `${dir}/notes.md`, `## How it works\n\n- Records can be bulk-updated [${s.id}].\n\n## Open points\n\n- Whether merge keeps both owners is not documented.\n`);
  mergeGlossary(kp, module);
  render(kp, module);
  return { kp, sourceId: s.id };
}
