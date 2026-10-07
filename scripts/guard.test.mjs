import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { checkTool } from "./lib/guard.mjs";
import { append } from "./lib/ledger.mjs";
import { paths } from "./lib/contract.mjs";
import { startRun, tempRoot } from "./test-helpers.mjs";

const call = (agent, tool_name, tool_input) => ({ agent_type: agent, tool_name, tool_input });
const sh = (agent, command) => call(agent, "Bash", { command });
const allowed = (root, input, env = {}) => checkTool(input, root, env).allowed;

const RO = startRun({ mode: "readonly" });
const FULL = startRun({ mode: "full-run" });

test("no active run: readonly shell rules for everyone, other tools untouched", () => {
  const root = tempRoot();
  assert.equal(allowed(root, sh(undefined, "curl -X POST https://x/api")), false);
  assert.equal(allowed(root, sh(undefined, "k6 run s.js")), false);
  assert.equal(allowed(root, sh(undefined, "curl -s https://x/api")), true);
  assert.equal(allowed(root, call("pw-ui-reviewer", "Write", { file_path: path.join(root, "anything.md") })), true);
});

test("readonly caps mutate permissions to read; full-run applies them as written", () => {
  const type = (r) => allowed(r.root, call("clarification-explorer", "mcp__playwright__browser_type", { text: "x" }));
  assert.equal(type(RO), false);
  assert.equal(type(FULL), true);
  assert.equal(allowed(RO.root, call("clarification-explorer", "mcp__playwright__browser_click", {})), true, "navigation clicks stay allowed");
  assert.equal(allowed(FULL.root, call("pw-ui-reviewer", "mcp__playwright__browser_navigate", {})), false, "browser: none");
  assert.equal(allowed(FULL.root, call("knowledge-generator", "mcp__playwright__browser_fill_form", {})), true, "browser: read becomes full in full-run");
  assert.equal(allowed(RO.root, call("knowledge-generator", "mcp__playwright__browser_fill_form", {})), false, "browser: read stays read in readonly");
});

test("filesystem writes are limited to the agent's allow-list, with ${product}/${module} expanded", () => {
  const w = (agent, rel) => allowed(FULL.root, call(agent, "Write", { file_path: path.join(FULL.root, rel) }));
  assert.equal(w("clarification-writer", "artifacts/acme/modules/contacts/clarifications.csv"), false, "the CSV is script-only");
  assert.equal(w("clarification-writer", "artifacts/acme/modules/contacts/clarifications-summary.md"), true);
  assert.equal(w("clarification-explorer", "artifacts/acme/modules/contacts/clarifications.csv"), false, "explorer writes evidence only");
  assert.equal(w("clarification-explorer", "artifacts/acme/modules/contacts/clarification-evidence/contacts-1/notes.md"), true);
  assert.equal(w("pw-ui-pom-writer", "playwright-tests/acme/pages/contacts.page.ts"), true);
  assert.equal(w("pw-ui-pom-writer", "playwright-tests/acme/tests/api/x.spec.ts"), false);
  assert.equal(w("pw-ui-scaffolder", "playwright-tests/acme/playwright.config.ts"), false, "shared files belong to pw-repo-owner");
  assert.equal(w("pw-repo-owner", "playwright-tests/acme/playwright.config.ts"), true);
  assert.equal(w("pw-ui-reviewer", "artifacts/acme/results/acme-run-1/contacts/playwright-ui/review-findings.md"), true);
  assert.equal(w("pw-ui-reviewer", "artifacts/acme/results/other-run/contacts/playwright-ui/review-findings.md"), false, "${run_id} is the current run");
  assert.equal(w("pw-ui-tests-writer", "playwright-tests/other-product/tests/ui/a.spec.ts"), false);
  assert.equal(allowed(FULL.root, call("pw-ui-tests-writer", "Write", { file_path: path.resolve(FULL.root, "..", "outside.ts") })), false);
});

test("orchestrators may only spawn their own workers; workers cannot spawn", () => {
  const spawn = (agent, sub) => allowed(FULL.root, call(agent, "Agent", { subagent_type: sub }));
  assert.equal(spawn("playwright-ui-orchestrator", "pw-ui-healer"), true);
  assert.equal(spawn("playwright-ui-orchestrator", "pw-repo-owner"), true);
  assert.equal(spawn("playwright-ui-orchestrator", "pw-api-healer"), false);
  assert.equal(spawn("orchestrator-agent", "pw-ui-healer"), false, "layer 0 talks to domain orchestrators, not their workers");
  assert.equal(spawn("k6-script-writer", "k6-reviewer"), false);
});

test("shell: none / restricted / project", () => {
  assert.equal(allowed(FULL.root, sh("testcase-writer", "ls")), false);
  assert.equal(allowed(FULL.root, sh("orchestrator-agent", "node scripts/run.mjs next acme")), true);
  assert.equal(allowed(FULL.root, sh("orchestrator-agent", "npm test")), false);
  assert.equal(allowed(FULL.root, sh("pw-ui-tests-writer", "npx tsc --noEmit")), true);
});

test("HTTP and load follow the agent's effective permission", () => {
  const post = "curl -X POST https://app.acme.test/api/contacts -d '{}'";
  assert.equal(allowed(FULL.root, sh("pw-api-test-runner-triager", post)), true);
  assert.equal(allowed(RO.root, sh("pw-api-test-runner-triager", post)), false, "readonly cap");
  assert.equal(allowed(FULL.root, sh("pw-api-tests-writer", post)), false, "writers have no product access");
  assert.equal(allowed(FULL.root, sh("pw-api-tests-writer", "curl -s https://app.acme.test/api/contacts")), false, "http: none");
  assert.equal(allowed(FULL.root, sh("k6-runner-triager", "k6 run scripts/contacts.js")), true);
  assert.equal(allowed(RO.root, sh("k6-runner-triager", "k6 run scripts/contacts.js")), false);
  assert.equal(allowed(FULL.root, sh("k6-script-writer", "k6 run scripts/contacts.js")), false);
});

test("deletes only for entities the CURRENT run created", () => {
  const { root } = startRun({ mode: "full-run" });
  const ledger = paths("acme", root).ledgerFile;
  const del = (id) => allowed(root, sh("pw-api-test-runner-triager", `curl -X DELETE https://app.acme.test/api/contacts/${id}`));
  append(ledger, { runId: "older-run", event: "created", type: "contact", ref: "41", module: "contacts", stage: "api", agent: "t" });
  append(ledger, { runId: "acme-run-1", event: "created", type: "contact", ref: "42", module: "contacts", stage: "api", agent: "t" });
  assert.equal(del("41"), false, "created by another run");
  assert.equal(del("42"), true);
  assert.equal(del("421"), false);
  append(ledger, { runId: "acme-run-1", event: "deleted", type: "contact", ref: "42", module: "contacts", stage: "api", agent: "t" });
  assert.equal(del("42"), false, "already deleted");
});

test("web research vs. reading the product under test", () => {
  const fetch = (agent, url) => allowed(FULL.root, call(agent, "WebFetch", { url }));
  assert.equal(fetch("knowledge-generator", "https://docs.vendor.test/guide"), true);
  assert.equal(fetch("pw-ui-reviewer", "https://docs.vendor.test/guide"), false);
  assert.equal(fetch("api-discoverer", "https://app.acme.test/openapi.json"), true, "http: read on the target");
  assert.equal(fetch("testcase-writer", "https://app.acme.test/openapi.json"), false);
});

test("unmanaged sessions get mode rules only; env can downgrade but never upgrade", () => {
  assert.equal(allowed(FULL.root, sh(undefined, "curl -X POST https://x/api")), true);
  assert.equal(allowed(FULL.root, sh(undefined, "curl -X POST https://x/api"), { AUTHORIZATIONS_MODE: "readonly" }), false);
  assert.equal(allowed(RO.root, sh(undefined, "curl -X POST https://x/api"), { AUTHORIZATIONS_MODE: "full-run" }), false);
  assert.equal(allowed(RO.root, call(undefined, "mcp__playwright__browser_type", {})), false);
});

test("command detection covers curl, wget, PowerShell and inline scripts", () => {
  for (const cmd of [
    "curl --request=DELETE https://x/1",
    "curl.exe --json '{}' https://x",
    "wget --post-data=a=b https://x",
    "Invoke-RestMethod -Uri https://x -Method Post -Body $b",
    "node -e \"fetch(u,{method:'POST'})\"",
    "python -c \"import requests; requests.post(u)\"",
  ])
    assert.equal(allowed(RO.root, sh(undefined, cmd)), false, cmd);
  assert.equal(allowed(RO.root, sh(undefined, "curl -X GET https://x")), true);
});
