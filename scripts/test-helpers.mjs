// Shared fixtures for the node:test suites: a throwaway repo root with the real config/permissions.yaml.
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { repoRoot } from "./lib/contract.mjs";
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
