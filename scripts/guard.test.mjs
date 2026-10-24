import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { checkTool } from "./lib/guard.mjs";
import { toolCall } from "./lib/tool-call.mjs";
import { shellAllowed } from "./lib/permissions.mjs";
import { normalize } from "./hooks/hosts/claude.mjs";
import { append } from "./lib/ledger.mjs";
import { paths } from "./lib/contract.mjs";
import { startRun, tempRoot } from "./test-helpers.mjs";

// Calls as Claude Code's hook sends them, through the Claude adapter (the guard itself only sees canonical calls).
const call = (agent, tool_name, tool_input) => normalize({ agent_type: agent, tool_name, tool_input }, { env: { CLAUDE_PROJECT_DIR: "/repo" }, host: "claude-code" });
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
  assert.equal(w("clarification-orchestrator", "artifacts/acme/modules/contacts/clarifications.csv"), false, "the CSV is script-only");
  assert.equal(w("clarification-orchestrator", "artifacts/acme/modules/contacts/clarifications-summary.md"), false, "the summary is rendered by its script");
  assert.equal(w("clarification-explorer", "artifacts/acme/modules/contacts/clarifications.csv"), false, "explorer writes evidence only");
  assert.equal(w("clarification-explorer", "artifacts/acme/modules/contacts/clarification-evidence/contacts-1/notes.md"), true);
  assert.equal(w("pw-ui-pom-writer", "playwright-tests/acme/pages/contacts/contacts.page.ts"), true);
  assert.equal(w("pw-ui-pom-writer", "playwright-tests/acme/tests/api/x.spec.ts"), false);
  assert.equal(w("pw-ui-scaffolder", "playwright-tests/acme/playwright.config.ts"), false, "shared files belong to pw-repo-owner");
  assert.equal(w("pw-repo-owner", "playwright-tests/acme/playwright.config.ts"), false, "rendered by foundation.mjs from templates/ (D-054)");
  assert.equal(w("pw-repo-owner", "artifacts/acme/foundation/repo-overlay.json"), true, "its overlay");
  assert.equal(w("pw-ui-reviewer", "artifacts/acme/results/acme-run-1/contacts/playwright-ui/review.json"), true);
  assert.equal(w("pw-ui-reviewer", "artifacts/acme/results/other-run/contacts/playwright-ui/review.json"), false, "${run_id} is the current run");
  assert.equal(w("pw-ui-reviewer", "artifacts/acme/results/acme-run-1/contacts/playwright-ui/review-findings.md"), false, "rendered by review.mjs (D-059)");
  assert.equal(w("pw-ui-tests-writer", "playwright-tests/other-product/tests/ui/a.spec.ts"), false);
  assert.equal(allowed(FULL.root, call("pw-ui-tests-writer", "Write", { file_path: path.resolve(FULL.root, "..", "outside.ts") })), false);
});

test("orchestrators may only spawn their own workers; workers cannot spawn", () => {
  const spawn = (agent, sub) => allowed(FULL.root, call(agent, "Agent", { subagent_type: sub }));
  assert.equal(spawn("playwright-ui-orchestrator", "pw-ui-fixer"), true);
  assert.equal(spawn("playwright-ui-orchestrator", "pw-repo-owner"), true);
  assert.equal(spawn("playwright-ui-orchestrator", "pw-api-fixer"), false);
  assert.equal(spawn("orchestrator-agent", "pw-ui-fixer"), false, "layer 0 talks to domain orchestrators, not their workers");
  assert.equal(spawn("k6-script-writer", "k6-reviewer"), false);
});

test("selectable steps (D-066, D-067): the orchestrator starts api-discovery, sets steps, writes the scenario answers and imports, never approves", () => {
  const spawn = (agent, sub) => allowed(FULL.root, call(agent, "Agent", { subagent_type: sub }));
  assert.equal(spawn("orchestrator-agent", "api-discoverer"), true, "the api-discovery stage is the orchestrator's");
  assert.equal(spawn("playwright-api-orchestrator", "api-discoverer"), false, "no discover step in the API domain any more");
  for (const { root } of [RO, FULL]) {
    const cmd = (agent, c) => allowed(root, sh(agent, c));
    for (const c of [
      "node scripts/run-config.mjs set config/acme.yaml --steps explore,testcases,playwright-ui",
      "node scripts/run-config.mjs set config/acme.yaml --testcases-file contacts=data/contacts.feature",
      "node scripts/run.mjs prereqs acme",
      "node scripts/run.mjs steps acme --add explore --remove k6",
      "node scripts/run.mjs scenarios acme",
      "node scripts/testcases.mjs import acme contacts",
    ])
      assert.equal(cmd("orchestrator-agent", c), true, c);
    assert.equal(cmd("orchestrator-agent", "node scripts/testcases.mjs build acme contacts"), false, "the orchestrator imports; the writer builds");
    assert.equal(cmd("orchestrator-agent", "node scripts/testcases.mjs import acme contacts --approved"), false, "human-only");
    assert.equal(cmd("testcase-writer", "node scripts/testcases.mjs import acme contacts"), false, "import mode writes cases.json only");
    const w = (agent, rel) => allowed(root, call(agent, "Write", { file_path: path.join(root, rel) }));
    assert.equal(w("orchestrator-agent", "artifacts/acme/state/scenario-answers.json"), true, "the scenario interview's answers");
    assert.equal(w("orchestrator-agent", "artifacts/acme/modules/contacts/scenarios.json"), false, "run.mjs scenarios writes it");
    assert.equal(w("orchestrator-agent", "config/acme.yaml"), false, "run-config.mjs writes the run-config");
    assert.equal(w("module-explorer", "artifacts/acme/state/scenario-answers.json"), false);
  }
});

test("shell: none / restricted / project", () => {
  assert.equal(allowed(FULL.root, sh("testcase-writer", "ls")), false);
  assert.equal(allowed(FULL.root, sh("orchestrator-agent", "node scripts/run.mjs next acme")), true);
  assert.equal(allowed(FULL.root, sh("orchestrator-agent", "npm test")), false);
  assert.equal(allowed(FULL.root, sh("pw-ui-fixer", "npx tsc --noEmit")), true, "a fixer with shell: project");
  // S7-F1 (D-4): the k6-fixer's shell is the k6-script-writer's, so no shell command writes a generated script
  for (const run of [RO, FULL]) {
    assert.equal(allowed(run.root, sh("k6-fixer", "node scripts/k6-code.mjs check acme contacts")), true);
    assert.equal(allowed(run.root, sh("k6-fixer", "node scripts/k6-code.mjs build acme contacts")), true);
    for (const cmd of [
      "npx tsc --noEmit",
      "node -e \"require('fs').writeFileSync('k6-tests/acme/scripts/contacts-smoke-1.js', 'x')\"",
      "cp /tmp/x.js k6-tests/acme/scripts/contacts-smoke-1.js",
      "echo x > k6-tests/acme/scripts/contacts-smoke-1.js",
      "sed -i s/a/b/ k6-tests/acme/scripts/contacts-smoke-1.js",
      "node scripts/k6-code.mjs check acme contacts && echo x > k6-tests/acme/scripts/contacts-smoke-1.js",
    ])
      assert.equal(allowed(run.root, sh("k6-fixer", cmd)), false, `k6-fixer: ${cmd}`);
  }
  assert.equal(allowed(FULL.root, sh("k6-script-writer", "npx tsc --noEmit")), false, "D-057: the k6 script-writer runs only k6-code.mjs");
  assert.equal(allowed(FULL.root, sh("pw-api-tests-writer", "npx tsc --noEmit")), false, "D-056: the API writers run tsc through api-code.mjs check");
  assert.equal(allowed(FULL.root, sh("pw-ui-tests-writer", "npx tsc --noEmit")), false, "D-055: the UI writers run tsc through ui-code.mjs check");
});

test("restricted shell: a leading cd into the repo root is ignored, any other prefix is not", () => {
  const ok = (cmd) => allowed(FULL.root, sh("orchestrator-agent", cmd));
  const r = FULL.root;
  const posix = r.replaceAll("\\", "/").replace(/^([a-z]):/i, (_, d) => `/${d.toLowerCase()}`);
  assert.equal(ok(`cd "${r}" && node scripts/run.mjs next acme`), true);
  assert.equal(ok(`cd '${r}/' ; node scripts/run.mjs next acme`), true);
  assert.equal(ok(`cd /d "${r}" && node scripts/run.mjs next acme`), true);
  assert.equal(ok(`Set-Location -Path "${r}"; node scripts/run.mjs next acme`), true);
  assert.equal(ok(`cd ${posix} && node scripts/run.mjs next acme`), true, "Git Bash style path");
  assert.equal(ok(`cd "${path.join(r, "artifacts")}" && node scripts/run.mjs next acme`), false, "a subfolder is not the root");
  assert.equal(ok(`cd . && node scripts/run.mjs next acme`), false, "relative paths are not stripped");
  assert.equal(ok(`cd "${r}" && npm test`), false, "the rest must still be in the allow-list");
  assert.equal(ok(`cd "${r}" && cd "${r}" && node scripts/run.mjs next acme`), false, "stripped once only");
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

test("API hosts in target.api_urls are the product too: no web-research loophole, http rules apply (D-045)", () => {
  const { root } = startRun({ mode: "full-run", apiUrls: ["https://api.acme.test/v2"] });
  const fetch = (agent, url) => allowed(root, call(agent, "WebFetch", { url }));
  assert.equal(fetch("pw-api-scaffolder", "https://api.acme.test/v2/openapi.json"), false, "web research may not reach the product's API host");
  assert.equal(fetch("pw-api-scaffolder", "https://docs.vendor.test/api"), true);
  assert.equal(fetch("api-discoverer", "https://api.acme.test/v2/openapi.json"), true, "http: read");
  assert.equal(allowed(root, sh("pw-api-fixer", "curl -s https://api.acme.test/v2/contacts")), false, "http: none covers every product host");
});

test("api-discoverer's shell is endpoints.mjs only; it writes only its overlay", () => {
  const run = (cmd) => allowed(FULL.root, sh("api-discoverer", cmd));
  assert.equal(run("node scripts/endpoints.mjs build acme contacts"), true);
  assert.equal(run("node scripts/endpoints.mjs probe acme contacts --budget 20"), true);
  assert.equal(run("node scripts/run.mjs status acme"), false);
  assert.equal(run("curl -s https://app.acme.test/api/contacts"), false);
  const w = (rel) => allowed(FULL.root, call("api-discoverer", "Write", { file_path: path.join(FULL.root, rel) }));
  assert.equal(w("artifacts/acme/modules/contacts/api/overlay.json"), true);
  assert.equal(w("artifacts/acme/modules/contacts/api/discovered-endpoints.json"), false, "the catalogue is script-only");
  assert.equal(w("artifacts/acme/modules/contacts/api/registry.json"), false);
});

test("api-test-planner's shell is api-plan.mjs only; it writes only its plan overlay (D-046)", () => {
  const run = (cmd) => allowed(FULL.root, sh("api-test-planner", cmd));
  assert.equal(run("node scripts/api-plan.mjs build acme contacts"), true);
  assert.equal(run("node scripts/api-plan.mjs check acme contacts"), true);
  assert.equal(run("node scripts/endpoints.mjs probe acme contacts"), false, "the planner never reaches the product");
  assert.equal(run("node scripts/clarifications.mjs append acme contacts q.json"), false, "questions go through api-plan.mjs only");
  assert.equal(run("curl -s https://app.acme.test/api/contacts"), false);
  const w = (rel) => allowed(FULL.root, call("api-test-planner", "Write", { file_path: path.join(FULL.root, rel) }));
  assert.equal(w("artifacts/acme/modules/contacts/api/plan-overlay.json"), true);
  for (const f of ["plan.json", "plan-coverage.json", "plan-registry.json", "api-test-plan.md"]) assert.equal(w(`artifacts/acme/modules/contacts/api/${f}`), false, `${f} is script-only`);
});

test("knowledge-generator's shell is knowledge.mjs only; it writes its markdown and captures, never the script-owned files (D-051)", () => {
  const run = (cmd) => allowed(FULL.root, sh("knowledge-generator", cmd));
  for (const cmd of ["add-source acme --title T --location https://docs.vendor.test --type vendor-doc", "input acme --module contacts --location docs/prd.md --status failed --reason x", "snapshot acme S3 --from-file captures/contacts.txt", "render acme --module contacts", "check acme --module contacts", "paths acme"])
    assert.equal(run(`node scripts/knowledge.mjs ${cmd}`), true, cmd);
  assert.equal(run("node scripts/knowledge.mjs plan acme"), false, "plan is the orchestrator's");
  assert.equal(run("curl -s https://docs.vendor.test/guide"), false);
  const w = (rel) => allowed(FULL.root, call("knowledge-generator", "Write", { file_path: path.join(FULL.root, rel) }));
  for (const f of ["overview.md", "glossary.md", "captures/contacts.txt", "modules/contacts/notes.md"]) assert.equal(w(`artifacts/acme/knowledge/${f}`), true, f);
  for (const f of ["coverage.json", "open-points.json", "sources.json", "sources/S1.txt", "sources/index.json", "modules/contacts/coverage.json", "modules/contacts/open-points.json", "modules/contacts/rule-facts.json", "modules/contacts/sources.md"])
    assert.equal(w(`artifacts/acme/knowledge/${f}`), false, `${f} is script-only`);
});

test("module-explorer runs explore.mjs and writes only its own explore files, never the script-owned model (D-052)", () => {
  const run = (cmd) => allowed(FULL.root, sh("module-explorer", cmd));
  for (const cmd of ["state acme contacts --snapshot captures/1.md", "frontier acme contacts", "ingest-network acme contacts --file captures/n.txt", "build acme contacts", "check acme contacts"])
    assert.equal(run(`node scripts/explore.mjs ${cmd}`), true, cmd);
  assert.equal(run("node scripts/clarifications.mjs append acme contacts artifacts/acme/modules/contacts/explore/new-questions.json"), true);
  assert.equal(run("node scripts/ledger.mjs owns acme --type contact --ref x"), true);
  assert.equal(run("node scripts/endpoints.mjs build acme contacts"), false);
  assert.equal(run("curl -s https://app.acme.test/api/contacts"), false);
  const w = (rel) => allowed(FULL.root, call("module-explorer", "Write", { file_path: path.join(FULL.root, "artifacts/acme/modules/contacts/explore", rel) }));
  for (const f of ["flows/create-contact.md", "module-summary.md", "new-questions.json", "overlay.json", "captures/snap-1.md", "captures/network-1.txt"]) assert.equal(w(f), true, f);
  for (const f of ["model.json", "coverage.json", "sitemap.json", "interactions.json", "network-inventory.json", "explore-model.md", "log.jsonl", "registry/states.json", "pages/contacts/states/ST-contacts-1.md", "pages/contacts/dom-snapshot.md"])
    assert.equal(w(f), false, `${f} is script-only`);
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

test("cmd.exe syntax is unvouchable outside quotes: ^ escapes (^\" hides a quote, so & runs) and %VAR% expansions", () => {
  const run = (cmd) => allowed(FULL.root, sh("testcase-writer", cmd));
  const build = "node scripts/testcases.mjs build acme contacts";
  for (const cmd of [`${build} ^"& copy x y ^"`, `${build} ^& copy x y`, `${build} %COMSPEC%`, `node scripts/testcases.mjs build acme %M%`]) assert.equal(run(cmd), false, cmd);
  assert.equal(run(`${build} '50% ^ done'`), true, "inside single quotes they are text");
});

test("testcase-reviewer runs only testcases.mjs review-check and writes only its review.json (D-053)", () => {
  const run = (cmd) => allowed(FULL.root, sh("testcase-reviewer", cmd));
  assert.equal(run("node scripts/testcases.mjs review-check acme contacts --round 2"), true);
  for (const cmd of ["node scripts/testcases.mjs build acme contacts", "node scripts/testcases.mjs check acme contacts", "npx tsc --noEmit", "node scripts/gate.mjs acme contacts testcases"]) assert.equal(run(cmd), false, cmd);
  const w = (rel) => allowed(FULL.root, call("testcase-reviewer", "Write", { file_path: path.join(FULL.root, rel) }));
  assert.equal(w("artifacts/acme/results/acme-run-1/contacts/testcases/review.json"), true);
  for (const f of ["artifacts/acme/results/acme-run-1/contacts/testcases/review-findings.md", "artifacts/acme/results/acme-run-1/contacts/testcases/gate-findings.md", "artifacts/acme/modules/contacts/testcases/cases.json", "artifacts/acme/results/other-run/contacts/testcases/review.json"])
    assert.equal(w(f), false, f);
});

test("foundation agents run foundation.mjs only (render for their own side), and write only their overlay and extension files (D-054)", () => {
  const sides = { "pw-repo-owner": "repo", "pw-ui-scaffolder": "ui", "pw-api-scaffolder": "api", "k6-lib-writer": "k6" };
  for (const [agent, side] of Object.entries(sides)) {
    const run = (cmd) => allowed(FULL.root, sh(agent, cmd));
    assert.equal(run(`node scripts/foundation.mjs render acme --side ${side}`), true, `${agent} renders its side`);
    for (const other of Object.values(sides).filter((s) => s !== side)) assert.equal(run(`node scripts/foundation.mjs render acme --side ${other}`), false, `${agent} never renders ${other}`);
    // `render * --side <own>` could match `render acme --side repo --side <own>`: the CLI refuses a second --side
    // (foundation.test.mjs), so no agent renders another side through it
    for (const cmd of ["check acme", `check acme --side ${side}`, `check acme --side ${side} --static`, "paths acme"]) assert.equal(run(`node scripts/foundation.mjs ${cmd}`), true, `${agent}: ${cmd}`);
    assert.equal(run("node scripts/foundation.mjs install acme"), agent === "pw-repo-owner", `${agent}: install`);
    for (const cmd of ["npx tsc --noEmit", "npm install", "k6 inspect lib/config.js", "node scripts/foundation.mjs render acme --side ui; node -e 1", "echo x > playwright-tests/acme/playwright.config.ts"])
      assert.equal(run(cmd), false, `${agent}: ${cmd}`);
    assert.equal(allowed(FULL.root, call(agent, "Write", { file_path: path.join(FULL.root, `artifacts/acme/foundation/${side}-overlay.json`) })), true, `${agent} writes its overlay`);
    for (const other of Object.values(sides).filter((s) => s !== side))
      assert.equal(allowed(FULL.root, call(agent, "Write", { file_path: path.join(FULL.root, `artifacts/acme/foundation/${other}-overlay.json`) })), false, `${agent} never writes the ${other} overlay`);
    assert.equal(allowed(FULL.root, call(agent, "Write", { file_path: path.join(FULL.root, `artifacts/acme/foundation/${side}-manifest.json`) })), false, "the manifest is script-owned");
  }
  const w = (agent, rel) => allowed(FULL.root, call(agent, "Write", { file_path: path.join(FULL.root, rel) }));
  assert.equal(w("pw-ui-scaffolder", "playwright-tests/acme/helpers/ui/dates.ts"), true);
  assert.equal(w("pw-ui-scaffolder", "playwright-tests/acme/fixtures/ui/index.ts"), false, "fixtures/ui/index.ts is generated (D-056)");
  assert.equal(w("pw-api-scaffolder", "playwright-tests/acme/helpers/api/pagination.ts"), true);
  assert.equal(w("pw-api-scaffolder", "playwright-tests/acme/helpers/api/schema.ts"), false, "schema.ts is managed");
  assert.equal(w("k6-lib-writer", "k6-tests/acme/lib/ext/paging.js"), true);
  assert.equal(w("k6-lib-writer", "k6-tests/acme/lib/config.js"), false);
});

test("no agent can write a managed foundation file directly, whatever its write list says (D-054)", async () => {
  const { managedTargets } = await import("./lib/foundation.mjs");
  const agents = Object.keys(JSON.parse(readFileSync(path.join(FULL.root, "artifacts/acme/state/permissions.resolved.json"), "utf8")).agents);
  const managed = [
    ...["repo", "ui", "api"].flatMap((s) => managedTargets(s)).map((f) => `playwright-tests/acme/${f}`),
    "playwright-tests/acme/package-lock.json",
    ...managedTargets("k6").map((f) => `k6-tests/acme/${f}`),
  ];
  assert.ok(managed.length >= 25);
  for (const root of [FULL.root, RO.root])
    for (const agent of agents)
      for (const f of managed) {
        const v = checkTool(call(agent, "Write", { file_path: path.join(root, f) }), root, {});
        assert.equal(v.allowed, false, `${agent} may not write ${f}`);
      }
  // the fixers and writers keep their own folders, only the managed files are carved out
  const ok = (agent, rel) => allowed(FULL.root, call(agent, "Write", { file_path: path.join(FULL.root, rel) }));
  assert.equal(ok("pw-ui-fixer", "playwright-tests/acme/helpers/ui/dates.ts"), true);
  assert.equal(ok("pw-ui-pom-writer", "playwright-tests/acme/pages/contacts/contacts.page.ts"), true);
  // fixtures/<side>/index.ts is generated on both sides (D-056): no agent writes it, whatever its write list says
  for (const agent of agents)
    for (const f of ["playwright-tests/acme/fixtures/ui/index.ts", "playwright-tests/acme/fixtures/api/index.ts", "playwright-tests/acme/fixtures/ui/pages/contacts.ts", "playwright-tests/acme/fixtures/api/clients/contacts.ts"]) {
      const v = checkTool(call(agent, "Write", { file_path: path.join(FULL.root, f) }), FULL.root, {});
      assert.equal(v.allowed, false, `${agent} may not write ${f}`);
      assert.equal(v.rule, "managed-file", f);
    }
  assert.equal(ok("pw-api-tests-writer", "playwright-tests/acme/helpers/api/contacts.payloads.ts"), true);
  assert.equal(ok("k6-fixer", "k6-tests/acme/scripts/slots/contacts.js"), true);
  assert.equal(ok("k6-fixer", "k6-tests/acme/lib/ext/dates.js"), true);
  assert.equal(checkTool(call("pw-ui-fixer", "Write", { file_path: path.join(FULL.root, "playwright-tests/acme/fixtures/ui/base.ts") }), FULL.root, {}).rule, "managed-file");
  // a host that can't name the caller gets the run's combined ceiling (D-035): still no managed file
  const copilot = { ...call("pw-ui-fixer", "Write", { file_path: path.join(FULL.root, "playwright-tests/acme/fixtures/ui/base.ts") }), agent: undefined, host: "copilot-cli" };
  assert.equal(checkTool(copilot, FULL.root, {}).allowed, false);
});

test("managed foundation files: another spelling of the same file is still managed (case, trailing dots and spaces, NTFS streams, ./.., 8.3 names)", () => {
  const w = (agent, rel) => checkTool(call(agent, "Write", { file_path: path.join(FULL.root, rel) }), FULL.root, {});
  for (const [agent, rel] of [
    ["pw-ui-fixer", "playwright-tests/acme/fixtures/ui/Base.ts"],
    ["pw-ui-fixer", "playwright-tests/acme/fixtures/ui/base.ts."],
    ["pw-ui-fixer", "playwright-tests/acme/fixtures/ui/base.ts .."],
    ["pw-ui-fixer", "playwright-tests/acme/fixtures/ui/base.ts::$DATA"],
    ["pw-ui-fixer", "playwright-tests/acme/fixtures/ui/base.ts:hidden"],
    ["pw-ui-fixer", "playwright-tests/acme/fixtures/ui/auth.setup.TS"],
    ["pw-ui-fixer", "playwright-tests/acme/FIXTURES/UI/BASE.TS"],
    ["pw-ui-fixer", "playwright-tests/acme/fixtures/ui/./base.ts"],
    ["pw-ui-fixer", "playwright-tests/acme/fixtures/ui/../ui/base.ts"],
    ["pw-ui-fixer", "playwright-tests/acme/fixtures/ui/AUTH~1.TS"],
    ["pw-ui-fixer", "playwright-tests/acme/fixtures/ui/BASE~1.TS"],
    ["k6-fixer", "k6-tests/acme/LIB/config.js"],
    ["k6-fixer", "k6-tests/acme/lib/Config.JS"],
    ["k6-fixer", "k6-tests/acme/lib/CONFIG~1.JS"],
    ["pw-api-fixer", "playwright-tests/acme/helpers/api/Schema.ts"],
  ]) {
    const v = w(agent, rel);
    assert.equal(v.allowed, false, `${agent} may not write ${rel}`);
    assert.equal(v.rule, "managed-file", rel);
  }
  // other files in the same folders stay the agents'
  assert.equal(w("pw-ui-fixer", "playwright-tests/acme/helpers/ui/dates.ts").allowed, true);
  assert.equal(w("pw-ui-fixer", "playwright-tests/acme/helpers/ui/DATES~1.TS").allowed, true, "a short name in a folder without a managed file is not managed");
  for (const rel of ["playwright-tests/acme/fixtures/ui/INDEX~1.TS", "playwright-tests/acme/fixtures/ui/Index.ts.", "playwright-tests/acme/fixtures/api/index.ts::$DATA"]) assert.equal(w("pw-ui-fixer", rel).rule, "managed-file", `${rel}: the generated index (D-056)`);
  assert.equal(w("k6-fixer", "k6-tests/acme/lib/ext/config.js").allowed, true);
});

test("managed foundation files: a junction or symlink inside a writable folder can't reach one", (t) => {

  const pw = (rel) => path.join(FULL.root, "playwright-tests/acme", rel);
  mkdirSync(pw("fixtures/ui"), { recursive: true });
  mkdirSync(pw("helpers/ui"), { recursive: true });
  try {
    symlinkSync(pw("fixtures/ui"), pw("helpers/ui/link"), "junction");
  } catch (e) {
    t.skip(`this OS can't create a junction or symlink here: ${e.code}`);
    return;
  }
  for (const agent of ["pw-ui-fixer", "pw-ui-tests-writer", "pw-ui-scaffolder", undefined]) {
    const v = checkTool({ ...call(agent, "Write", { file_path: pw("helpers/ui/link/base.ts") }), ...(agent ? {} : { agent: undefined, host: "copilot-cli" }) }, FULL.root, {});
    assert.equal(v.allowed, false, `${agent ?? "unnamed"} through the link`);
    assert.equal(v.rule, "managed-file");
  }
  assert.equal(allowed(FULL.root, call("pw-ui-tests-writer", "Write", { file_path: pw("helpers/ui/link/../contacts.data.ts") })), true, "the rest of the folder stays writable");
});

test("managed foundation files: directory short names, \\\\?\\ and \\\\.\\ prefixes and UNC paths to this machine reach no managed file", () => {
  const unnamed = (file, r = RO) => checkTool({ ...call(undefined, "Write", { file_path: file }), agent: undefined, host: "copilot-cli" }, r.root, {});
  const named = (file) => checkTool(call("pw-ui-fixer", "Write", { file_path: file }), FULL.root, {});
  for (const rel of ["PLAYWR~1/acme/fixtures/ui/base.ts", "playwright-tests/acme/FIXTUR~1/ui/base.ts", "playwright-tests/acme/fixtures/ui/BASE~1.TS", "PLAYWR~2/ACME/FIXTUR~1/UI/AUTHSE~1.TS", "K6-TES~1/acme/lib/config.js", "playwright-tests/acme/utils/SHARED~1/env.ts"]) {
    assert.equal(unnamed(path.join(RO.root, rel)).rule, "managed-file", rel);
    assert.equal(named(path.join(FULL.root, rel)).allowed, false, rel);
  }
  assert.equal(unnamed(path.join(RO.root, "PLAYWR~1/acme/helpers/ui/dates.ts")).allowed, true, "an extension file keeps the mode rules");
  if (process.platform !== "win32") return;
  const abs = path.join(RO.root, "playwright-tests", "acme", "fixtures", "ui", "base.ts");
  const [drive, rest] = [abs[0], abs.slice(3)];
  for (const p of [`\\\\?\\${abs}`, `\\\\.\\${abs}`, `//?/${abs.replaceAll("\\", "/")}`, `\\\\localhost\\${drive}$\\${rest}`, `\\\\127.0.0.1\\${drive.toLowerCase()}$\\${rest}`, `\\\\?\\UNC\\localhost\\${drive}$\\${rest}`]) {
    const v = unnamed(p);
    assert.equal(v.allowed, false, p);
    assert.equal(v.rule, "managed-file", p);
  }
  assert.equal(unnamed(`\\\\?\\${path.join(RO.root, "playwright-tests", "acme", "helpers", "ui", "dates.ts")}`).allowed, true, "a device prefix on an extension file keeps the mode rules");
});

test("managed foundation files: unnamed callers can't write them either, in every mode (D-054)", async () => {
  const file = (root) => path.join(root, "playwright-tests/acme/fixtures/ui/base.ts");
  const unnamed = (root, host) => ({ ...call(undefined, "Write", { file_path: file(root) }), agent: undefined, host });
  for (const r of [RO, FULL])
    for (const host of ["copilot-cli", "claude-code", "vscode-agent-host"]) {
      const v = checkTool(unnamed(r.root, host), r.root, {});
      assert.equal(v.allowed, false, `${host} in ${r === RO ? "readonly" : "full-run"}`);
      assert.equal(v.rule, "managed-file");
    }
  assert.equal(checkTool(unnamed(RO.root, "copilot-cli"), RO.root, {}).allowed, false);
  assert.equal(checkTool({ ...unnamed(RO.root, "copilot-cli"), paths: [path.join(RO.root, "playwright-tests/acme/helpers/ui/dates.ts")] }, RO.root, {}).allowed, true, "an extension file keeps the mode rules");
  // with two active runs, the other product's run can't let it through
  const two = startRun();
  const { initRun } = await import("./run.mjs");
  const { writeConfig } = await import("./test-helpers.mjs");
  const beta = initRun(writeConfig(two.root, { product: "beta" }), { root: two.root, runId: "beta-run-1", env: { CLAUDECODE: "1" } });
  assert.deepEqual(beta.errors ?? [], []);
  assert.equal(checkTool(unnamed(two.root, "copilot-cli"), two.root, {}).allowed, false);
});

test("k6-workload-designer runs workload.mjs build/check/paths only and writes only its workload overlay (D-057)", () => {
  const run = (cmd) => allowed(FULL.root, sh("k6-workload-designer", cmd));
  for (const cmd of ["build", "check", "paths"]) assert.equal(run(`node scripts/workload.mjs ${cmd} acme contacts --run acme-run-1`), true, cmd);
  for (const cmd of [
    "node scripts/workload.mjs build acme contacts && node scripts/k6-code.mjs build acme contacts",
    "node scripts/workload.mjs check acme contacts; k6 run k6-tests/acme/scripts/contacts-smoke-1.js",
    "node scripts/workload.mjs build acme contacts | tee artifacts/acme/modules/contacts/k6/workload.json",
    "node scripts/k6-code.mjs build acme contacts",
    "k6 inspect k6-tests/acme/scripts/contacts-smoke-1.js",
    "node scripts/run.mjs status acme",
  ])
    assert.equal(run(cmd), false, cmd);
  const w = (rel) => allowed(FULL.root, call("k6-workload-designer", "Write", { file_path: path.join(FULL.root, "artifacts/acme/modules/contacts/k6", rel) }));
  assert.equal(w("workload-overlay.json"), true);
  for (const f of ["workload.json", "workload-coverage.json", "workload-registry.json", "code-plan.json"]) assert.equal(w(f), false, `${f} is script-managed`);
});

test("k6-script-writer runs k6-code.mjs build/check/paths only and writes only its slot file (D-057)", () => {
  const run = (cmd) => allowed(FULL.root, sh("k6-script-writer", cmd));
  for (const cmd of ["build", "check", "paths"]) assert.equal(run(`node scripts/k6-code.mjs ${cmd} acme contacts`), true, cmd);
  assert.equal(run("node scripts/k6-code.mjs build acme contacts --adopt"), true);
  for (const cmd of ["k6 inspect k6-tests/acme/scripts/contacts-smoke-1.js", "k6 run k6-tests/acme/scripts/contacts-smoke-1.js", "node scripts/workload.mjs build acme contacts", "node scripts/k6-code.mjs check acme contacts && k6 run x.js"])
    assert.equal(run(cmd), false, cmd);
  const w = (rel) => allowed(FULL.root, call("k6-script-writer", "Write", { file_path: path.join(FULL.root, rel) }));
  assert.equal(w("k6-tests/acme/scripts/slots/contacts.js"), true);
  for (const f of ["k6-tests/acme/scripts/contacts-smoke-1.js", "k6-tests/acme/scripts/helper.js", "k6-tests/acme/lib/config.js", "k6-tests/acme/lib/ext/x.js",
    "artifacts/acme/modules/contacts/k6/code-plan.json", "artifacts/acme/modules/contacts/k6/parked.json", "artifacts/acme/modules/contacts/k6/workload.json"])
    assert.equal(w(f), false, f);
});

test("nobody writes the k6 workload or the generated k6 code directly, in any mode (D-057)", () => {
  const agents = Object.keys(JSON.parse(readFileSync(paths("acme", FULL.root).permissionsFile, "utf8")).agents);
  const managed = [
    "k6-tests/acme/scripts/contacts-smoke-1.js",
    "k6-tests/acme/scripts/contacts-average-load-2.js",
    ...["workload.json", "workload-coverage.json", "workload-registry.json", "code-plan.json", "parked.json", "legacy/contacts-old.js"].map((f) => `artifacts/acme/modules/contacts/k6/${f}`),
    "artifacts/acme/modules/deals/k6/code-plan.json",
  ];
  for (const { root } of [FULL, RO])
    for (const agent of [...agents, undefined])
      for (const f of managed) {
        const v = checkTool(call(agent, "Write", { file_path: path.join(root, f) }), root, {});
        assert.equal(v.allowed, false, `${agent ?? "unnamed"} may not write ${f}`);
        assert.equal(v.rule, "managed-file", `${agent}: ${f}`);
      }
  const msg = (f) => checkTool(call("k6-fixer", "Write", { file_path: path.join(FULL.root, f) }), FULL.root, {}).reason;
  assert.match(msg("k6-tests/acme/scripts/contacts-smoke-1.js"), /generated by scripts\/k6-code\.mjs/);
  assert.match(msg("artifacts/acme/modules/contacts/k6/workload.json"), /written by scripts\/workload\.mjs/);
  // the agents' own files stay writable
  const ok = (agent, rel) => allowed(FULL.root, call(agent, "Write", { file_path: path.join(FULL.root, rel) }));
  assert.equal(ok("k6-script-writer", "k6-tests/acme/scripts/slots/contacts.js"), true);
  assert.equal(ok("k6-workload-designer", "artifacts/acme/modules/contacts/k6/workload-overlay.json"), true);
  assert.equal(ok("k6-runner-triager", "k6-tests/acme/results/contacts-smoke-1.summary.json"), true);
});

test("the runner-triagers write only their triage overlay; results, triage, the BUG registry and known-issues are nobody's to write (D-058)", () => {
  const agents = Object.keys(JSON.parse(readFileSync(paths("acme", FULL.root).permissionsFile, "utf8")).agents);
  const managed = [
    ...["playwright-ui", "playwright-api", "k6"].flatMap((fw) => ["results.json", "triage.json", "triage.md"].map((f) => `artifacts/acme/results/acme-run-1/contacts/${fw}/${f}`)),
    "artifacts/acme/modules/contacts/triage/triage-registry.json",
    "artifacts/acme/known-issues.json",
  ];
  for (const { root } of [FULL, RO])
    for (const agent of [...agents, undefined])
      for (const f of managed) {
        const v = checkTool(call(agent, "Write", { file_path: path.join(root, f) }), root, {});
        assert.equal(v.allowed, false, `${agent ?? "unnamed"} may not write ${f}`);
        assert.equal(v.rule, "managed-file", `${agent}: ${f}`);
      }
  const ok = (agent, rel) => allowed(FULL.root, call(agent, "Write", { file_path: path.join(FULL.root, rel) }));
  const R = "artifacts/acme/results/acme-run-1/contacts";
  for (const [agent, fw] of [["pw-ui-test-runner-triager", "playwright-ui"], ["pw-api-test-runner-triager", "playwright-api"], ["k6-runner-triager", "k6"]]) {
    assert.equal(ok(agent, `${R}/${fw}/triage-overlay.json`), true, `${agent} writes its overlay`);
    for (const other of ["playwright-ui", "playwright-api", "k6"].filter((x) => x !== fw)) assert.equal(ok(agent, `${R}/${other}/triage-overlay.json`), false, `${agent} may not write ${other}'s overlay`);
  }
  assert.equal(ok("k6-runner-triager", "k6-tests/acme/results/contacts-smoke-1.summary.json"), true, "the k6 summaries stay the runner's");
  assert.equal(ok("pw-ui-test-runner-triager", "playwright-tests/acme/test-results/ui/contacts-report.json"), true);
  assert.equal(ok("pw-ui-test-runner-triager", "playwright-tests/acme/test-results/api/contacts-report.json"), false);
  assert.equal(ok("pw-ui-fixer", `${R}/playwright-ui/triage-overlay.json`), false, "no fixer writes a triage overlay");
  const perms = JSON.parse(readFileSync(paths("acme", FULL.root).permissionsFile, "utf8")).agents;
  for (const a of ["pw-ui-test-runner-triager", "pw-api-test-runner-triager", "k6-runner-triager"]) {
    for (const cmd of ["prepare", "build", "check", "paths"]) assert.ok(perms[a].shell_allow.includes(`node scripts/triage.mjs ${cmd} *`), `${a}: triage.mjs ${cmd}`);
    assert.ok(perms[a].filesystem.read.some((g) => g.endsWith("known-issues.json")), `${a} reads the known issues`);
    assert.ok(!perms[a].filesystem.write.some((g) => /known-issues|triage\.(json|md)|results\.json/.test(g)), `${a} writes none of them`);
  }
  // the three fixers read the script-built triage
  for (const a of ["pw-ui-fixer", "pw-api-fixer", "k6-fixer"]) assert.ok(perms[a].filesystem.read.some((g) => g.endsWith("/triage.json")), `${a} reads triage.json`);
});

test("the code reviewers run only review.mjs check and write only their review.json; the fixers write code, their fix-report.json and run fix.mjs check; the stamps, the snapshot and the findings are managed (D-059)", () => {
  const R = "artifacts/acme/results/acme-run-1/contacts";
  const w = (agent, rel, run = FULL) => allowed(run.root, call(agent, "Write", { file_path: path.join(run.root, rel) }));
  const cmdOk = (agent, cmd) => allowed(FULL.root, sh(agent, cmd));
  const domains = [["pw-ui-reviewer", "pw-ui-fixer", "playwright-ui", "playwright-ui"], ["pw-api-reviewer", "pw-api-fixer", "playwright-api", "playwright-api"], ["k6-reviewer", "k6-fixer", "k6", "k6"]];
  for (const [rev, fix, fw, dom] of domains) {
    assert.equal(cmdOk(rev, `node scripts/review.mjs check acme contacts ${dom} --round 1`), true, `${rev} runs the check`);
    for (const cmd of ["node scripts/review.mjs render acme contacts " + dom, "npx tsc --noEmit", "node scripts/gate.mjs acme contacts " + dom, "node scripts/fix.mjs check acme contacts " + dom + " --round 1",
      `node scripts/review.mjs check acme contacts ${dom} --round 1 && echo x > ${R}/${fw}/review.json`])
      assert.equal(cmdOk(rev, cmd), false, `${rev}: ${cmd}`);
    assert.equal(w(rev, `${R}/${fw}/review.json`), true, `${rev} writes its review.json`);
    for (const f of ["review-findings.md", "review-check.json", "gate-findings.md", "fix-report.json", "fix-snapshot.json"]) assert.equal(w(rev, `${R}/${fw}/${f}`), false, `${rev} may not write ${f}`);
    for (const other of ["playwright-ui", "playwright-api", "k6"].filter((x) => x !== fw)) assert.equal(w(rev, `${R}/${other}/review.json`), false, `${rev} may not write ${other}'s review`);
    assert.equal(w(rev, `${R.replace("acme-run-1", "other-run")}/${fw}/review.json`), false, `${rev}: another run`);

    assert.equal(cmdOk(fix, `node scripts/fix.mjs check acme contacts ${dom} --round 1`), true, `${fix} runs the check`);
    assert.equal(cmdOk(fix, `node scripts/fix.mjs check acme contacts ${dom} --round 1 --source triage`), true);
    // the UI and API fixers keep shell: project (tsc, playwright --list), so only the k6-fixer's shell is a closed list; the
    // snapshot a fix is checked against is taken by orchestration.mjs first and kept, so a later `snapshot` changes nothing
    if (fix === "k6-fixer")
      for (const cmd of [`node scripts/fix.mjs snapshot acme contacts ${dom} --round 1`, `node scripts/review.mjs check acme contacts ${dom} --round 1`, `node scripts/fix.mjs check acme contacts ${dom} --round 1 && echo x > ${R}/${fw}/fix-snapshot.json`])
        assert.equal(cmdOk(fix, cmd), false, `${fix}: ${cmd}`);
    assert.equal(w(fix, `${R}/${fw}/fix-report.json`), true, `${fix} writes its fix-report.json`);
    for (const f of ["review.json", "review-findings.md", "review-check.json", "fix-snapshot.json", "triage-overlay.json"]) assert.equal(w(fix, `${R}/${fw}/${f}`), false, `${fix} may not write ${f}`);
    for (const other of ["playwright-ui", "playwright-api", "k6"].filter((x) => x !== fw)) assert.equal(w(fix, `${R}/${other}/fix-report.json`), false, `${fix} may not write ${other}'s report`);
  }
  // nobody writes a stamp, the snapshot or a rendered findings file, in any mode, named or not
  const agents = Object.keys(JSON.parse(readFileSync(paths("acme", FULL.root).permissionsFile, "utf8")).agents);
  for (const run of [FULL, RO])
    for (const agent of [...agents, undefined])
      for (const dom of ["testcases", "playwright-ui", "playwright-api", "k6"])
        for (const f of ["review-check.json", "fix-snapshot.json", "review-findings.md"]) {
          const v = checkTool(call(agent, "Write", { file_path: path.join(run.root, `${R}/${dom}/${f}`) }), run.root, {});
          assert.equal(v.allowed, false, `${agent ?? "unnamed"} may not write ${dom}/${f}`);
          assert.equal(v.rule, "managed-file", `${agent}: ${dom}/${f}`);
        }
  const perms = JSON.parse(readFileSync(paths("acme", FULL.root).permissionsFile, "utf8")).agents;
  for (const [rev, fix] of domains) {
    assert.deepEqual(perms[rev].shell_allow, ["node scripts/review.mjs check *"], `${rev}: the check only`);
    assert.equal(perms[rev].shell, "restricted");
    assert.ok(perms[fix].shell_allow.includes("node scripts/fix.mjs check *") && !perms[fix].shell_allow.some((c) => c.includes("fix.mjs snapshot")), `${fix}: check, never snapshot`);
    assert.ok(perms[fix].filesystem.read.some((g) => g.endsWith("/review.json")), `${fix} reads review.json`);
  }
});

test("testcase-writer runs testcases.mjs build/check/paths only and writes only its cases overlay", () => {
  const run = (cmd) => allowed(FULL.root, sh("testcase-writer", cmd));
  for (const cmd of ["build acme contacts", "check acme contacts", "paths acme contacts"]) assert.equal(run(`node scripts/testcases.mjs ${cmd}`), true, cmd);
  assert.equal(run("node scripts/testcases.mjs items acme contacts"), false);
  assert.equal(run("node scripts/clarifications.mjs list acme contacts"), false);
  const w = (rel) => allowed(FULL.root, call("testcase-writer", "Write", { file_path: path.join(FULL.root, "artifacts/acme/modules/contacts/testcases", rel) }));
  assert.equal(w("cases.json"), true);
  for (const f of ["contacts-testcases.feature", "testcases-summary.md", "coverage.json", "registry/cases.json", "registry/items.json", "approval-findings.md", "approval.csv", "approvals.json"])
    assert.equal(w(f), false, `${f} is not the writer's`);
});

test("restricted shell: a `*` never spans an operator, a redirect, a substitution or a line break; every command of a line must be allowed", () => {
  const run = (cmd, agent = "testcase-writer") => allowed(FULL.root, sh(agent, cmd));
  const build = "node scripts/testcases.mjs build acme contacts";
  assert.equal(run(build), true);
  assert.equal(run(`${build} && node scripts/testcases.mjs check acme contacts`), true, "two allowed commands");
  assert.equal(run(`cd "${FULL.root}" && ${build}`), true, "D-041: a leading cd into the repo root");
  for (const cmd of [
    `${build} && node -e "require('fs').writeFileSync('artifacts/acme/modules/contacts/testcases/registry/cases.json','{}')"`,
    `${build}; cp x artifacts/acme/modules/contacts/testcases/coverage.json`,
    `${build} || rm artifacts/acme/modules/contacts/testcases/coverage.json`,
    `${build} | tee artifacts/acme/modules/contacts/testcases/coverage.json`,
    `${build} & node -e "1"`,
    `${build} > artifacts/acme/modules/contacts/testcases/approval-findings.md`,
    `${build} 2> artifacts/acme/modules/contacts/testcases/coverage.json`,
    `${build} < /etc/passwd`,
    `node scripts/testcases.mjs build $(node -e "require('fs').rmSync('x')") contacts`,
    "node scripts/testcases.mjs build `rm -rf artifacts` contacts",
    `node scripts/testcases.mjs build "$(rm -rf artifacts)" contacts`,
    `node scripts/testcases.mjs build acme $HOME`,
    `${build}\nnode -e "require('fs').rmSync('artifacts', { recursive: true })"`,
    `${build}\r\nrm -rf artifacts`,
    `node scripts/testcases.mjs build acme (contacts)`,
    `node scripts/testcases.mjs build acme "contacts`,
  ])
    assert.equal(run(cmd), false, cmd);
  // quoted text is an argument, never an operator
  assert.equal(run(`node scripts/knowledge.mjs input acme --module contacts --location docs/prd.md --status failed --reason "404 (gone); retry later | maybe"`, "knowledge-generator"), true);
  assert.equal(run(`node scripts/explore.mjs state acme contacts --snapshot captures/1.md --via ST-contacts-1 --action 'button "New contact"'`, "module-explorer"), true);
  assert.equal(run(`node scripts/knowledge.mjs input acme --reason 'it costs $5'`, "knowledge-generator"), true, "single quotes are literal");
  assert.equal(run(`node scripts/knowledge.mjs input acme --reason "it costs $5"`, "knowledge-generator"), false, "a $ in double quotes expands");
  // escaped quotes outside quotes would hide where a quote starts: any backslash outside quotes is unvouchable
  assert.equal(run(`${build} \\"; node -e 'require(1)'; echo \\"`), false);
  assert.equal(run(`${build} \\'; cp x artifacts/acme/modules/contacts/testcases/registry/cases.json; echo \\'`), false);
  assert.equal(run(`node scripts/explore.mjs ingest-network acme contacts --file captures\\net.json`, "module-explorer"), false, "unquoted Windows paths too");
  assert.equal(run(`node scripts/explore.mjs ingest-network acme contacts --file 'captures\\net.json'`, "module-explorer"), true);
  assert.equal(run(`node scripts/explore.mjs state acme contacts --snapshot captures/1.md --action "button \\"Save\\""`, "module-explorer"), false, "bash reads \\\" as an escape, PowerShell as the closing quote");
});

// Reference readers: does bash, or PowerShell, see a second command, a redirect or an expansion in this line?
function bashSeesMore(line) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q === "'") {
      if (c === "'") q = null;
    } else if (q === '"') {
      if (c === "\\") i++;
      else if (c === '"') q = null;
      else if (c === "$" || c === "`") return true;
    } else if (c === "\\") i++;
    else if (c === "'" || c === '"') q = c;
    else if (";&|\n\r<>()$`".includes(c)) return true;
  }
  return q !== null;
}
function powershellSeesMore(line) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q === "'") {
      if (c === "'" && line[i + 1] === "'") i++;
      else if (c === "'") q = null;
    } else if (q === '"') {
      if (c === "`") i++;
      else if (c === '"' && line[i + 1] === '"') i++;
      else if (c === '"') q = null;
      else if (c === "$") return true;
    } else if (c === "`") i++;
    else if (c === "'" || c === '"') q = c;
    else if (";&|\n\r<>()$".includes(c)) return true;
  }
  return q !== null;
}

test("fuzz: the restricted splitter never vouches for a line in which bash or PowerShell would run more than the allowed command", () => {
  const row = { shell: "restricted", shell_allow: ["node scripts/testcases.mjs build *"] };
  const ALPHA = ["\\", '"', "'", ";", "x", " ", "$", "`", "\n", "&", "|"];
  let checked = 0;
  const visit = (tail, depth) => {
    const line = `node scripts/testcases.mjs build acme ${tail}`;
    if (shellAllowed(row, line)) {
      assert.equal(bashSeesMore(line), false, JSON.stringify(line));
      assert.equal(powershellSeesMore(line), false, JSON.stringify(line));
    }
    checked++;
    if (depth) for (const c of ALPHA) visit(tail + c, depth - 1);
  };
  visit("", 5);
  assert.ok(checked > 150000);
  assert.equal(shellAllowed(row, "node scripts/testcases.mjs build acme 'a;b' \"c|d\""), true, "quoted operators are arguments");
});

test("test case approval is human-only: no agent can run approve or write approval.csv / approvals.json", () => {
  const agents = Object.keys(JSON.parse(readFileSync(paths("acme", FULL.root).permissionsFile, "utf8")).agents);
  assert.ok(agents.length >= 30);
  const sheet = "artifacts/acme/modules/contacts/testcases/approval.csv";
  const record = "artifacts/acme/modules/contacts/testcases/approvals.json";
  for (const { root } of [RO, FULL])
    for (const agent of agents) {
      assert.equal(allowed(root, sh(agent, "node scripts/testcases.mjs approve acme contacts")), false, `${agent}: approve`);
      assert.equal(allowed(root, sh(agent, `cd "${root}" && node scripts/testcases.mjs approve acme contacts`)), false, `${agent}: approve after cd`);
      for (const f of [sheet, record]) {
        assert.equal(allowed(root, call(agent, "Write", { file_path: path.join(root, f) })), false, `${agent}: write ${f}`);
        assert.equal(allowed(root, call(agent, "Edit", { file_path: path.join(root, f) })), false, `${agent}: edit ${f}`);
        assert.equal(allowed(root, sh(agent, `echo yes > ${f}`)), false, `${agent}: shell write ${f}`);
      }
    }
  // chained after an allowed command, through the lib, or by a shell: project agent
  assert.equal(allowed(FULL.root, sh("testcase-writer", "node scripts/testcases.mjs build acme contacts && node scripts/testcases.mjs approve acme contacts")), false);
  assert.equal(allowed(FULL.root, sh("pw-ui-tests-writer", "node -e \"import('./scripts/lib/testcases.mjs').then((m) => m.approve(ctx))\"")), false);
  assert.equal(allowed(FULL.root, sh("feedback-implementor-agent", "node scripts/testcases.mjs approve acme contacts")), false);
  // every tool call the hook sees: unidentified callers on every host, in a full-run or readonly run, and outside any run
  const unnamed = (host, command) => toolCall({ host, kind: "shell", tool: "bash", command });
  for (const root of [FULL.root, RO.root, tempRoot()])
    for (const host of ["copilot-cli", "vscode", "claude-code", "copilot-cloud"]) {
      assert.equal(allowed(root, unnamed(host, "node scripts/testcases.mjs approve acme contacts")), false, `${host}: approve`);
      assert.equal(allowed(root, toolCall({ host, kind: "write", tool: "create", paths: [path.join(root, sheet)] })), false, `${host}: write the sheet`);
      assert.equal(allowed(root, toolCall({ host, kind: "write", tool: "create", paths: [path.join(root, record)] })), false, `${host}: write the record`);
    }
  assert.equal(allowed(tempRoot(), sh(undefined, "node scripts/testcases.mjs approve acme contacts")), false, "a human's own session too: they run it in their own terminal");
  // names split up to dodge a pattern, short names, and folders
  for (const cmd of [
    "node -e \"require('fs').writeFileSync('artifacts/acme/modules/contacts/testcases/approv'+'als.json','{}')\"",
    "node -e \"import('./scripts/lib/test'+'cases.mjs').then((m) => m['appr'+'ove'])\"",
    "cp /tmp/a.csv artifacts/acme/modules/contacts/testcases/APPROV~1.CSV",
    "cp /tmp/a.csv artifacts/acme/modules/contacts/testcases/approval-copy.csv",
  ])
    assert.equal(allowed(FULL.root, sh("pw-ui-test-runner-triager", cmd)), false, cmd);
  // no agent's row grants it either
  for (const a of Object.values(JSON.parse(readFileSync(paths("acme", FULL.root).permissionsFile, "utf8")).agents)) {
    assert.ok(!a.shell_allow.some((p) => /approve/.test(p)), "no shell_allow names approve");
    assert.ok(!a.filesystem.write.some((g) => /approval|testcases\/\*\*|modules\}\/\*\*/.test(g)), `no write glob reaches the approval files: ${a.filesystem.write}`);
  }
});

test("import --approved is human-only like approve: denied to every agent and every unidentified call, however it is spelled", () => {
  const agents = Object.keys(JSON.parse(readFileSync(paths("acme", FULL.root).permissionsFile, "utf8")).agents);
  const cmd = "node scripts/testcases.mjs import acme contacts --file data/cases.feature --approved";
  for (const { root } of [RO, FULL])
    for (const agent of agents) {
      assert.equal(allowed(root, sh(agent, cmd)), false, `${agent}: import --approved`);
      assert.equal(allowed(root, sh(agent, `cd "${root}" && ${cmd}`)), false, `${agent}: after cd`);
    }
  const unnamed = (host, command) => toolCall({ host, kind: "shell", tool: "bash", command });
  for (const root of [FULL.root, RO.root, tempRoot()])
    for (const host of ["copilot-cli", "vscode", "claude-code", "copilot-cloud"]) assert.equal(allowed(root, unnamed(host, cmd)), false, `${host}: import --approved`);
  assert.equal(allowed(tempRoot(), sh(undefined, cmd)), false, "a human's own session too: they run it in their own terminal");
  assert.equal(allowed(tempRoot(), sh(undefined, "node scripts/testcases.mjs import acme contacts --file data/cases.feature")), true, "a plain import is not an approval");
  // spelled to dodge the match, chained, or through the lib
  for (const c of [
    "node scripts/testcases.mjs import acme contacts --approved",
    "node scripts/testcases.mjs import acme contacts --appr''oved",
    "node scripts/testcases.mjs import acme contacts --appr\"o\"ved",
    "node scripts/testcases.mjs import acme contacts '--approved'",
    "node scripts/test''cases.mjs import acme contacts --approved",
    "node scripts/testcases.mjs import acme contacts --appr^oved",
    "node scripts/testcases.mjs import acme contacts --appr\\oved",
    "node scripts/testcases.mjs build acme contacts && node scripts/testcases.mjs import acme contacts --approved",
    "node -e \"import('./scripts/lib/testcases.mjs').then((m) => m.importCases(ctx, v, { approved: true }))\"",
    "node -e \"import('./scripts/lib/test'+'cases.mjs').then((m) => m['import'+'Cases'](c, v, {appr'+'oved: true}))\"",
  ])
    for (const agent of ["orchestrator-agent", "testcase-writer", "feedback-implementor-agent"]) assert.equal(allowed(FULL.root, sh(agent, c)), false, `${agent}: ${c}`);
});

test("approve and import --approved through make, shell globs, expansions, printf or base64 are denied to every caller (V-3)", () => {
  const T = "node scripts/testcases.mjs import acme contacts";
  const bypasses = [
    "make approve PRODUCT=acme MODULE=contacts",
    "make import PRODUCT=acme MODULE=contacts APPROVED=yes",
    "APPROVED=yes make import PRODUCT=acme MODULE=contacts",
    "mingw32-make.exe import PRODUCT=acme MODULE=contacts APPROVED=yes",
    "npx make approve PRODUCT=acme MODULE=contacts",
    `${T} --appro\${x}ved`,
    `${T} --appro$()ved`,
    `${T} --appro$''ved`,
    `${T} --appro\`echo\`ved`,
    `${T} $(printf -- '--appr%sved' o)`,
    `printf -- '--appr%sved' o | xargs ${T}`,
    `${T} $(printf '\\x2d-approved')`,
    `${T} --$(echo YXBwcm92ZWQ= | base64 -d)`,
    "echo bm9kZSBzY3JpcHRzL3Rlc3RjYXNlcy5tanMgYXBwcm92ZSBhY21lIGNvbnRhY3Rz | base64 -d | sh",
    "node scripts/testc?ses.mjs import acme contacts --approved",
    "node scripts/test[c]ases.mjs import acme contacts --approved",
    "node scripts/test${x}cases.mjs import acme contacts --approved",
    "node scripts/test*.mjs approve acme contacts",
    "node scripts/testc?ses.mjs approve acme contacts",
    "node scripts/testcases.mjs appro${x}ve acme contacts",
    "node scripts/testcases.mjs appr?ve acme contacts",
    "node $S approve acme contacts",
    `X=--appro; ${T} \${X}ved`,
  ];
  const unnamed = (host, command) => toolCall({ host, kind: "shell", tool: "bash", command });
  for (const c of bypasses) {
    for (const { root } of [RO, FULL])
      for (const agent of ["orchestrator-agent", "testcase-writer", "feedback-implementor-agent", undefined]) assert.equal(allowed(root, sh(agent, c)), false, `${agent ?? "(no agent)"}: ${c}`);
    for (const host of ["copilot-cli", "vscode", "copilot-cloud"]) assert.equal(allowed(FULL.root, unnamed(host, c)), false, `${host}: ${c}`);
  }
  // the legitimate, non-approving commands stay allowed
  for (const [agent, c] of [
    ["orchestrator-agent", `${T}`],
    ["orchestrator-agent", `${T} --file data/cases.feature`],
    ["testcase-writer", "node scripts/testcases.mjs build acme contacts"],
    ["testcase-writer", "node scripts/testcases.mjs check acme contacts"],
    ["testcase-writer", "node scripts/testcases.mjs paths acme contacts"],
    ["testcase-reviewer", "node scripts/testcases.mjs review-check acme contacts --round 1"],
    [undefined, "ls artifacts/acme/modules/*/testcases"],
    [undefined, "make status PRODUCT=acme"],
    // the bare word `approved` in a file name or prose, "make" in prose, and a glob no runner starts are not approvals
    ["orchestrator-agent", "node scripts/run-config.mjs set config/acme.yaml --testcases-file contacts=data/approved-cases.feature"],
    ["orchestrator-agent", `${T} --file data/approved-cases.feature`],
    [undefined, "node scripts/run-config.mjs set config/acme.yaml --testcases-file contacts=data/approved-cases.feature"],
    [undefined, `${T} --file data/approved-cases.feature`],
    [undefined, "node scripts/run.mjs stage acme playwright-ui fail --module contacts --error \"case not approved\""],
    [undefined, "node scripts/run.mjs stage acme k6 fail --module contacts --error \"make sure a human approved the @performance cases\""],
    [undefined, "git commit -m \"docs: only a human runs make approve, in their own terminal\""],
    [undefined, "grep -n approved scripts/*.mjs"],
  ])
    assert.equal(allowed(FULL.root, sh(agent, c)), true, `${agent ?? "(no agent)"}: ${c}`);
});

test("make approve: a separator inside quotes is text, not a new command; an unquoted chain or a substitution in quotes is denied", () => {
  const unnamed = (host, command) => toolCall({ host, kind: "shell", tool: "bash", command });
  const callers = (c) => [
    ...[RO, FULL].flatMap(({ root }) => ["orchestrator-agent", "feedback-implementor-agent", undefined].map((agent) => [`${agent ?? "(no agent)"}`, root, sh(agent, c)])),
    ...["copilot-cli", "vscode", "copilot-cloud"].map((host) => [host, FULL.root, unnamed(host, c)]),
  ];
  for (const c of [
    "true | make approve PRODUCT=acme MODULE=contacts",
    "ls; make approve PRODUCT=acme MODULE=contacts",
    "ls && make approve",
    "ls || make approve",
    "ls\nmake approve",
    "ls & make import PRODUCT=acme MODULE=contacts APPROVED=yes",
    "echo \"$(make approve)\"",
    "echo \"`make approve`\"",
    "echo \"x $(true; make approve)\"",
    "echo \\\"; make approve \\\"",
    "echo \"a\\\"; make approve\"",
    "echo 'x' | make approve",
    "bash -c \"ls; make approve\"",
    "echo \"ls; make approve\" | sh",
    "ba''sh -c 'ls; make approve'",
    "/bin/s? -c 'ls; make approve'",
    "cmd /c echo 'x & make approve'",
    "node -e \"require('child_process').execSync('ls; make approve')\"",
    "git rebase --exec \"ls; make approve\" HEAD~1",
    // the quoted string itself is the command a runner starts, with no separator before make
    "bash -c \"make approve PRODUCT=acme MODULE=contacts\"",
    "sh -c 'make import PRODUCT=acme MODULE=contacts APPROVED=yes'",
    "eval \"make approve PRODUCT=acme\"",
  ])
    for (const [who, root, tc] of callers(c)) assert.equal(allowed(root, tc), false, `${who}: ${c}`);
  for (const c of [
    "grep -n \"a\\|make approve\" scripts/guard.test.mjs",
    "grep -n 'a\\|make approve' scripts/guard.test.mjs",
    "echo \"x; make approve\"",
    "echo 'x; make approve'",
    "echo \"(make approve)\"",
    "echo '$(make approve)'",
    "git commit -m 'docs: a && make approve explained'",
    "git commit -m \"docs: a || make approve explained\"",
  ])
    for (const agent of [undefined, "feedback-implementor-agent"]) assert.equal(allowed(FULL.root, sh(agent, c)), true, `${agent ?? "(no agent)"}: ${c}`);
});

test("worker requests (G10, D-060): only the askers run requests.mjs add; nobody writes requests.json; the repo owner reads every module's", () => {
  const cmdOk = (agent, cmd) => allowed(FULL.root, sh(agent, cmd));
  const R = "artifacts/acme/results/acme-run-1/contacts";
  const w = (agent, rel, run = FULL) => allowed(run.root, call(agent, "Write", { file_path: path.join(run.root, rel) }));
  const perms = JSON.parse(readFileSync(paths("acme", FULL.root).permissionsFile, "utf8")).agents;
  const askers = [["pw-ui-tests-writer", "playwright-ui"], ["pw-ui-pom-writer", "playwright-ui"], ["pw-ui-scaffolder", "playwright-ui"], ["pw-api-tests-writer", "playwright-api"], ["pw-api-client-writer", "playwright-api"], ["pw-api-scaffolder", "playwright-api"], ["k6-script-writer", "k6"]];
  for (const [agent, dom] of askers) {
    assert.equal(cmdOk(agent, `node scripts/requests.mjs add acme ${dom} contacts --from ${agent} --kind missing-method --target 'x' --summary 'y'`), true, `${agent} adds a request`);
    assert.equal(cmdOk(agent, `node scripts/requests.mjs list acme ${dom} contacts`), false, `${agent} only adds`);
    assert.equal(w(agent, `${R}/${dom}/requests.json`), false, `${agent} never writes requests.json itself`);
  }
  for (const agent of ["pw-ui-reviewer", "k6-fixer", "k6-lib-writer", "pw-repo-owner", "testcase-writer", "report-generator", "playwright-ui-orchestrator"])
    assert.equal(cmdOk(agent, "node scripts/requests.mjs add acme playwright-ui contacts --from x --kind repo-change --target 't' --summary 's'"), false, `${agent} may not add requests`);
  // the domain orchestrators may list them; the main orchestrator reaches the script through run.mjs only
  for (const agent of ["playwright-ui-orchestrator", "playwright-api-orchestrator", "k6-orchestrator"]) assert.equal(cmdOk(agent, "node scripts/requests.mjs list acme playwright-ui contacts"), true, `${agent} lists requests`);
  // nobody, named or not, writes the file: the scripts do
  for (const agent of [...Object.keys(perms), undefined])
    for (const dom of ["playwright-ui", "playwright-api", "k6"]) {
      const v = checkTool(call(agent, "Write", { file_path: path.join(FULL.root, `${R}/${dom}/requests.json`) }), FULL.root, {});
      assert.equal(v.allowed, false, `${agent ?? "unnamed"} may not write ${dom}/requests.json`);
      assert.equal(v.rule, "managed-file");
    }
  assert.ok(perms["pw-repo-owner"].filesystem.read.some((g) => g.endsWith("/*/*/requests.json")), "the repo owner reads the requests of any module");
});

test("report-generator writes only report/narrative.json and runs only report-data.mjs and report.mjs render|check|paths; report.json, index.html and the stamp are managed (D-061)", () => {
  const D = "artifacts/acme/results/acme-run-1/report";
  const w = (rel, run = FULL) => allowed(run.root, call("report-generator", "Write", { file_path: path.join(run.root, rel) }));
  const cmdOk = (cmd) => allowed(FULL.root, sh("report-generator", cmd));
  assert.equal(w(`${D}/narrative.json`), true, "the narrative overlay");
  for (const f of ["report.json", "index.html", "report-check.json", "notes.md"]) assert.equal(w(`${D}/${f}`), false, `report-generator may not write ${f}`);
  assert.equal(w("artifacts/acme/results/other-run/report/narrative.json"), false, "another run");
  assert.equal(w("artifacts/acme/results/acme-run-1/contacts/k6/review.json"), false, "no other write");
  for (const cmd of ["node scripts/report-data.mjs acme", "node scripts/report.mjs render acme", "node scripts/report.mjs check acme", "node scripts/report.mjs paths acme"])
    assert.equal(cmdOk(cmd), true, cmd);
  for (const cmd of ["node scripts/run.mjs status acme", "node scripts/report.mjs render acme && echo x > " + D + "/report.json", "node scripts/results.mjs acme", "echo x > " + D + "/index.html", "npm test"])
    assert.equal(cmdOk(cmd), false, cmd);
  // nobody, named or not, writes report.json, index.html or the stamp
  const perms = JSON.parse(readFileSync(paths("acme", FULL.root).permissionsFile, "utf8")).agents;
  for (const run of [FULL, RO])
    for (const agent of [...Object.keys(perms), undefined])
      for (const f of ["report.json", "index.html", "report-check.json"]) {
        const v = checkTool(call(agent, "Write", { file_path: path.join(run.root, `${D}/${f}`) }), run.root, {});
        assert.equal(v.allowed, false, `${agent ?? "unnamed"} may not write ${f}`);
        assert.equal(v.rule, "managed-file", `${agent}: ${f}`);
      }
  assert.deepEqual(perms["report-generator"].filesystem.write, ["${results}/report/narrative.json"]);
});

test("feedback-implementor-agent writes the G0-G11 framework files and never a safety file or its own checker (D-062)", () => {
  const w = (rel) => allowed(FULL.root, call("feedback-implementor-agent", "Write", { file_path: path.join(FULL.root, rel) }));
  const e = (rel) => allowed(FULL.root, call("feedback-implementor-agent", "Edit", { file_path: path.join(FULL.root, rel) }));
  for (const rel of [
    "scripts/lib/gate/common.mjs", "scripts/lib/endpoints.mjs", "scripts/lib/api-plan.mjs", "scripts/lib/domain-flows.mjs", "scripts/lib/report.mjs",
    "scripts/fixtures/explore/contacts-list.md", "schemas/report.schema.json", "templates/report/deck.html", "templates/k6/lib/x.js",
    "scripts/report.mjs", "scripts/report.test.mjs", "scripts/review.test.mjs", "agents/_shared/fixer.md", "agents/pw-ui-fixer.md", "docs/decisions.md",
  ]) {
    assert.equal(w(rel), true, `write ${rel}`);
    assert.equal(e(rel), true, `edit ${rel}`);
  }
  const safety = [
    "scripts/lib/guard.mjs", "scripts/lib/permissions.mjs", "scripts/lib/ledger.mjs", "scripts/lib/hosts.mjs", "scripts/lib/tool-call.mjs",
    "scripts/lib/browser-tools.mjs", "scripts/lib/decisions.mjs", "scripts/lib/guard-check.mjs", "scripts/lib/hook-registrations.mjs", "scripts/lib/agent-scope.mjs",
    "scripts/hooks/pretooluse.mjs", "scripts/hooks/hosts/claude.mjs", "scripts/lib/agents/capabilities.mjs", "scripts/lib/agents/renderers/claude.mjs",
    "scripts/ledger.mjs", "scripts/guard.test.mjs", "scripts/hooks.test.mjs", "scripts/roster.test.mjs",
    "config/permissions.yaml", "config/models.yaml", "config/platforms.yaml", "config/mcp.yaml",
    ".claude/settings.json", ".claude/agents/pw-ui-fixer.md", ".github/hooks/x.json", ".github/agents/pw-ui-fixer.agent.md", ".vscode/mcp.json", ".mcp.json",
    "playwright-tests/acme/tests/ui/x.spec.ts", "k6-tests/acme/scripts/x.js",
    // the checker of its own resolutions is not editable by the agent it checks
    "scripts/feedback.mjs", "scripts/lib/feedback.mjs", "scripts/feedback.test.mjs",
  ];
  for (const rel of safety) {
    assert.equal(w(rel), false, `write ${rel}`);
    assert.equal(e(rel), false, `edit ${rel}`);
  }
});

test("every framework script is writable by feedback-implementor-agent or deliberately carved out, so a new file forces a decision (D-062)", () => {
  const carved = new Set([
    "scripts/feedback.mjs", "scripts/ledger.mjs", "scripts/feedback.test.mjs", "scripts/guard.test.mjs", "scripts/hooks.test.mjs", "scripts/roster.test.mjs", "scripts/ledger.test.mjs",
    ...["guard", "permissions", "ledger", "hosts", "tool-call", "browser-tools", "decisions", "guard-check", "hook-registrations", "hook-log", "agent-scope", "feedback", "sweep", "telemetry"].map((n) => `scripts/lib/${n}.mjs`),
  ]);
  const files = [];
  // node_modules is git-ignored and never the framework's own code, wherever an install put it
  const walk = (dir) => {
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      const rel = `${dir}/${d.name}`;
      if (d.isDirectory()) { if (!["hooks", "agents", "fixtures", "node_modules"].includes(d.name)) walk(rel); } else if (rel.endsWith(".mjs")) files.push(rel);
    }
  };
  walk("scripts");
  const w = (rel) => allowed(FULL.root, call("feedback-implementor-agent", "Write", { file_path: path.join(FULL.root, rel) }));
  for (const rel of files) assert.equal(w(rel), !carved.has(rel), `${rel}: ${carved.has(rel) ? "carved out" : "writable"}`);
});

test("the ledger sweep is human-only: denied to every agent and every unidentified call, in or out of a run (D-075)", () => {
  const agents = Object.keys(JSON.parse(readFileSync(paths("acme", FULL.root).permissionsFile, "utf8")).agents);
  const cmds = ["node scripts/ledger.mjs sweep acme", "node scripts/ledger.mjs sweep acme --dry-run", "make sweep PRODUCT=acme", "cd x && node scripts/led''ger.mjs swe''ep acme"];
  for (const { root } of [RO, FULL])
    for (const agent of agents) for (const c of cmds) assert.equal(allowed(root, sh(agent, c)), false, `${agent}: ${c}`);
  const unnamed = (host, command) => toolCall({ host, kind: "shell", tool: "bash", command });
  for (const root of [FULL.root, RO.root, tempRoot()])
    for (const host of ["copilot-cli", "vscode", "claude-code", "copilot-cloud"]) for (const c of cmds) assert.equal(allowed(root, unnamed(host, c)), false, `${host}: ${c}`);
  assert.equal(allowed(tempRoot(), sh(undefined, cmds[0])), false, "a human's own session too: they run it in their own terminal");
  // the rest of the ledger stays as it was, and prose about sweeping is not a sweep
  assert.equal(allowed(FULL.root, sh("pw-ui-test-runner-triager", "node scripts/ledger.mjs list acme --live")), true);
  assert.equal(allowed(tempRoot(), sh(undefined, "echo make sure the floor gets a sweep")), true);
});

test("readonly input (D-076): typing, selecting and key presses pass only while the browser server runs the framework's network guard", () => {
  const ro = startRun({ mode: "readonly" });
  const b = (agent, tool) => allowed(ro.root, call(agent, `mcp__playwright__browser_${tool}`, {}));
  assert.equal(b("module-explorer", "type"), false, "no init page in config/mcp.yaml: input is mutating, as before");
  assert.match(checkTool(call("module-explorer", "mcp__playwright__browser_type", {}), ro.root).reason, /does not run the framework's network guard/);
  writeFileSync(path.join(ro.root, "config", "mcp.yaml"), `browser_server: playwright\nservers:\n  playwright:\n    command: npx\n    args:\n      - "--isolated"\n      - "--init-page"\n      - "scripts/browser/init-page.cjs"\n`);
  for (const t of ["type", "fill_form", "select_option", "press_key", "click", "hover"]) assert.equal(b("module-explorer", t), true, `readonly ${t}`);
  for (const t of ["file_upload", "drag", "drop", "handle_dialog", "evaluate", "run_code_unsafe"]) assert.equal(b("module-explorer", t), false, `readonly ${t} stays blocked`);
  assert.equal(b("api-discoverer", "type"), false, "browser: none stays none");
  writeFileSync(path.join(ro.root, "config", "mcp.yaml"), `servers:\n  playwright:\n    args:\n      # - "--init-page"\n      # - "scripts/browser/init-page.cjs"\n`);
  assert.equal(b("module-explorer", "type"), false, "a commented-out init page is no init page");
});

test("the browser init page: readonly runs' product hosts take no write, no run means no write anywhere, full-run hosts and others pass; the run's session is loaded once (D-076)", async () => {
  const { refusal, loadSession, default: initPage } = createRequire(import.meta.url)("./browser/init-page.cjs");
  const run = (mode, extra = {}) => ({ product: "acme", mode, targetHosts: ["app.acme.test", "api.acme.test"], ...extra });
  assert.equal(refusal("GET", "https://app.acme.test/x", []), null);
  assert.match(refusal("POST", "https://elsewhere.test/x", []), /no product run is active/);
  assert.match(refusal("DELETE", "https://eu.api.acme.test/contacts/1", [run("readonly")]), /belongs to acme, whose run is readonly/, "a subdomain is the product's");
  assert.equal(refusal("POST", "https://analytics.example/collect", [run("readonly")]), null, "a third-party host is outside the guard");
  assert.equal(refusal("POST", "https://app.acme.test/contacts", [run("full-run")]), null);
  assert.match(refusal("PATCH", "https://app.acme.test/x", [run("full-run"), { product: "x", broken: true, targetHosts: [] }]), /cannot be read/, "a broken run state fails closed");
  assert.equal(refusal("POST", "data:text/plain,x", [run("readonly")]), null);

  // the session of the active run, from the config it started with
  const { root } = startRun({ mode: "readonly" });
  const state = path.join(paths("acme", root).state, "config.resolved.json");
  const cfg = JSON.parse(readFileSync(state, "utf8"));
  writeFileSync(state, JSON.stringify({ ...cfg, authorizations: { ...cfg.authorizations, authenticated_crawl: true, session_state_file: "playwright-tests/acme/.auth/state.json" } }));
  mkdirSync(path.join(root, "playwright-tests", "acme", ".auth"), { recursive: true });
  writeFileSync(path.join(root, "playwright-tests", "acme", ".auth", "state.json"), JSON.stringify({ cookies: [{ name: "sid", value: "v", domain: "app.acme.test", path: "/" }], origins: [{ origin: "https://app.acme.test", localStorage: [{ name: "t", value: "1" }] }] }));
  const seen = { cookies: [], scripts: [], routes: 0 };
  const context = { addCookies: async (c) => seen.cookies.push(...c), addInitScript: async (_fn, arg) => seen.scripts.push(arg), route: async () => seen.routes++ };
  const page = { context: () => context };
  await initPage({ page }, root);
  await initPage({ page }, root);
  assert.deepEqual([seen.cookies.map((c) => c.name), seen.scripts, seen.routes], [["sid"], [{ origin: "https://app.acme.test", items: [{ name: "t", value: "1" }] }], 1], "once per context");
  assert.equal(await loadSession(context, { product: "acme" }, tempRoot()), false, "no run config, no session");
});
