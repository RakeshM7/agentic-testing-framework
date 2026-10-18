import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, symlinkSync } from "node:fs";
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
  assert.equal(w("pw-ui-pom-writer", "playwright-tests/acme/pages/contacts.page.ts"), true);
  assert.equal(w("pw-ui-pom-writer", "playwright-tests/acme/tests/api/x.spec.ts"), false);
  assert.equal(w("pw-ui-scaffolder", "playwright-tests/acme/playwright.config.ts"), false, "shared files belong to pw-repo-owner");
  assert.equal(w("pw-repo-owner", "playwright-tests/acme/playwright.config.ts"), false, "rendered by foundation.mjs from templates/ (D-054)");
  assert.equal(w("pw-repo-owner", "artifacts/acme/foundation/repo-overlay.json"), true, "its overlay");
  assert.equal(w("pw-ui-reviewer", "artifacts/acme/results/acme-run-1/contacts/playwright-ui/review-findings.md"), true);
  assert.equal(w("pw-ui-reviewer", "artifacts/acme/results/other-run/contacts/playwright-ui/review-findings.md"), false, "${run_id} is the current run");
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

test("shell: none / restricted / project", () => {
  assert.equal(allowed(FULL.root, sh("testcase-writer", "ls")), false);
  assert.equal(allowed(FULL.root, sh("orchestrator-agent", "node scripts/run.mjs next acme")), true);
  assert.equal(allowed(FULL.root, sh("orchestrator-agent", "npm test")), false);
  assert.equal(allowed(FULL.root, sh("pw-ui-tests-writer", "npx tsc --noEmit")), true);
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
  assert.equal(w("pw-ui-scaffolder", "playwright-tests/acme/fixtures/ui/index.ts"), true, "the extension file the guard fixture is imported into");
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
  assert.equal(ok("pw-ui-fixer", "playwright-tests/acme/fixtures/ui/index.ts"), true);
  assert.equal(ok("pw-ui-pom-writer", "playwright-tests/acme/fixtures/ui/index.ts"), true);
  assert.equal(ok("pw-api-tests-writer", "playwright-tests/acme/helpers/api/contacts.payloads.ts"), true);
  assert.equal(ok("k6-fixer", "k6-tests/acme/scripts/contacts-smoke.js"), true);
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
  assert.equal(w("pw-ui-fixer", "playwright-tests/acme/fixtures/ui/index.ts").allowed, true);
  assert.equal(w("pw-ui-fixer", "playwright-tests/acme/fixtures/ui/INDEX~1.TS").allowed, true, "a short name of index.ts is not a managed file");
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
  assert.equal(allowed(FULL.root, call("pw-ui-tests-writer", "Write", { file_path: pw("helpers/ui/link/../dates.ts") })), true, "the rest of the folder stays writable");
});

test("managed foundation files: directory short names, \\\\?\\ and \\\\.\\ prefixes and UNC paths to this machine reach no managed file", () => {
  const unnamed = (file, r = RO) => checkTool({ ...call(undefined, "Write", { file_path: file }), agent: undefined, host: "copilot-cli" }, r.root, {});
  const named = (file) => checkTool(call("pw-ui-fixer", "Write", { file_path: file }), FULL.root, {});
  for (const rel of ["PLAYWR~1/acme/fixtures/ui/base.ts", "playwright-tests/acme/FIXTUR~1/ui/base.ts", "playwright-tests/acme/fixtures/ui/BASE~1.TS", "PLAYWR~2/ACME/FIXTUR~1/UI/AUTHSE~1.TS", "K6-TES~1/acme/lib/config.js", "playwright-tests/acme/utils/SHARED~1/env.ts"]) {
    assert.equal(unnamed(path.join(RO.root, rel)).rule, "managed-file", rel);
    assert.equal(named(path.join(FULL.root, rel)).allowed, false, rel);
  }
  assert.equal(unnamed(path.join(RO.root, "PLAYWR~1/acme/fixtures/ui/index.ts")).allowed, true, "an extension file keeps the mode rules");
  if (process.platform !== "win32") return;
  const abs = path.join(RO.root, "playwright-tests", "acme", "fixtures", "ui", "base.ts");
  const [drive, rest] = [abs[0], abs.slice(3)];
  for (const p of [`\\\\?\\${abs}`, `\\\\.\\${abs}`, `//?/${abs.replaceAll("\\", "/")}`, `\\\\localhost\\${drive}$\\${rest}`, `\\\\127.0.0.1\\${drive.toLowerCase()}$\\${rest}`, `\\\\?\\UNC\\localhost\\${drive}$\\${rest}`]) {
    const v = unnamed(p);
    assert.equal(v.allowed, false, p);
    assert.equal(v.rule, "managed-file", p);
  }
  assert.equal(unnamed(`\\\\?\\${path.join(RO.root, "playwright-tests", "acme", "fixtures", "ui", "index.ts")}`).allowed, true, "a device prefix on an extension file keeps the mode rules");
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
  assert.equal(checkTool({ ...unnamed(RO.root, "copilot-cli"), paths: [path.join(RO.root, "playwright-tests/acme/fixtures/ui/index.ts")] }, RO.root, {}).allowed, true, "an extension file keeps the mode rules");
  // with two active runs, the other product's run can't let it through
  const two = startRun();
  const { initRun } = await import("./run.mjs");
  const { writeConfig } = await import("./test-helpers.mjs");
  const beta = initRun(writeConfig(two.root, { product: "beta" }), { root: two.root, runId: "beta-run-1", env: { CLAUDECODE: "1" } });
  assert.deepEqual(beta.errors ?? [], []);
  assert.equal(checkTool(unnamed(two.root, "copilot-cli"), two.root, {}).allowed, false);
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
