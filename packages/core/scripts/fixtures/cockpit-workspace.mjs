// A Cockpit test workspace (D-111): a copy of the contract-2 fixture, and a run with UI results, a triaged failure and a
// coverage ledger. Shared by scripts/cockpit.test.mjs and the VS Code extension's end-to-end Cockpit test. Test-only:
// scripts/fixtures/ never ships (build-package.mjs entryPoints).
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "workspaces", "contract-2");

export const writeJson = (f, o) => (mkdirSync(path.dirname(f), { recursive: true }), writeFileSync(f, JSON.stringify(o, null, 2)));
export const readJson = (f) => JSON.parse(readFileSync(f, "utf8"));

export function workspace() {
  const root = mkdtempSync(path.join(tmpdir(), "atf-cockpit-"));
  cpSync(FIXTURE, root, { recursive: true });
  return root;
}

// A run that chose the UI tests, with TC-contacts-1 (approved) automated in a spec, failed once, and triaged.
export function withResults(root, { env } = {}) {
  const state = env ? path.join(root, "artifacts", "acme", "envs", env, "state") : path.join(root, "artifacts", "acme", "state");
  const run = readJson(path.join(state, "run.json"));
  run.steps = ["explore", "testcases", "playwright-ui", "k6"];
  run.caseTypes = ["ui", "performance"];
  writeJson(path.join(state, "run.json"), run);
  const product = path.join(root, "artifacts", "acme");
  const module = path.join(product, "modules", "contacts");
  const resDir = path.join(product, "results", run.runId, "contacts", "playwright-ui");
  writeJson(path.join(resDir, "results.json"), {
    framework: "playwright-ui", module: "contacts", runId: run.runId, mode: "readonly", status: "ran",
    totals: { total: 2, passed: 1, failed: 1, flaky: 0, skipped: 0 }, durationMs: 1200,
    items: [
      { title: "TC-contacts-1 opens the New contact dialog", file: "tests/ui/contacts/cases.spec.ts", status: "failed", attempts: 2, passedOnRetry: false, tcId: "TC-contacts-1", error: "locator.click: Timeout 5000ms exceeded waiting for getByRole('button', { name: 'New contact' })" },
      { title: "TC-contacts-2 closes the dialog", file: "tests/ui/contacts/cases.spec.ts", status: "passed", attempts: 1, passedOnRetry: false, tcId: "TC-contacts-2" },
    ],
  });
  writeJson(path.join(resDir, "triage.json"), {
    summary: { rows: 1, open: 0, byClass: { "locator-drift": 1 }, clusters: 1 },
    rows: [{ key: "ui:TC-contacts-1", title: "TC-contacts-1 opens the New contact dialog", tcId: "TC-contacts-1", status: "failed", class: "locator-drift", healable: true, fixHint: "re-ground the locator", evidence: ["artifacts/acme/modules/contacts/explore/sitemap.json"], error: "Timeout 5000ms exceeded", cluster: "BUG-contacts-1", signature: "TimeoutError | x" }],
    clusters: [{ id: "BUG-contacts-1", signature: "TimeoutError | x", rows: ["ui:TC-contacts-1"], ids: ["TC-contacts-1"] }],
  });
  writeJson(path.join(resDir, "triage-overlay.json"), { bugs: [{ cluster: "BUG-contacts-1", title: "New contact button missing", severity: "major" }] });
  writeJson(path.join(module, "ui-code", "coverage.json"), { items: [{ id: "TC-contacts-1", status: "mapped", refs: ["playwright-tests/acme/tests/ui/contacts/cases.spec.ts"] }, { id: "TC-contacts-2", status: "excluded", reason: "visual" }] });
  return { run, product };
}
