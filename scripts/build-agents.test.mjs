// The single-source agent build: one neutral source per agent -> one generated file per platform, tools derived from
// config/permissions.yaml only, platform syntax only from config/platforms.yaml.
import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { build } from "./build-agents.mjs";
import { capabilitiesFor, toolNames } from "./lib/agents/capabilities.mjs";
import { splitFrontmatter } from "./lib/agents/source.mjs";
import { frameworkRoot } from "./lib/contract.mjs";
import { resolvePermissions } from "./lib/permissions.mjs";
import { expandFw, frameworkRel, workspaceRoot } from "./lib/roots.mjs";

// Sources and config are the framework's; the generated files are the workspace's (the same directory, or the
// monorepo's root with the framework in packages/core), rendered with `{fw}/` as the framework's path from there.
const load = (rel) => yaml.load(readFileSync(path.join(frameworkRoot, rel), "utf8"));
const FW = frameworkRel(workspaceRoot, frameworkRoot);
const perms = resolvePermissions(load("config/permissions.yaml")).resolved;
const { platforms } = load("config/platforms.yaml");
const { browser_server: server } = load("config/mcp.yaml");
const tools = (agent, platform) => toolNames(capabilitiesFor(perms.agents[agent]), platforms[platform], server);
// A script-only agent (restricted shell, no file writes), independent of the roster.
const scriptOnly = resolvePermissions({
  agents: { probe: { layer: 2, shell: "restricted", shell_allow: ["node scripts/clarifications.mjs list *"], filesystem: { read: ["x/**"], write: [] } } },
}).resolved.agents.probe;
const probeTools = (platform) => toolNames(capabilitiesFor(scriptOnly), platforms[platform], server);
const generated = (rel) => splitFrontmatter(readFileSync(path.join(workspaceRoot, rel), "utf8"), rel).meta;

// A throwaway repo root with the real config/ and agents/, so tests can break things safely.
function scratch() {
  const root = mkdtempSync(path.join(tmpdir(), "atf-build-"));
  for (const d of ["config", "agents"]) cpSync(path.join(frameworkRoot, d), path.join(root, d), { recursive: true });
  return root;
}

test("every generated agent and MCP file matches its sources (build-agents --check)", () => {
  const { errors, changed } = build({ check: true });
  assert.deepEqual(errors, []);
  assert.deepEqual(changed, []);
});

test("Claude tools follow permissions: workers cannot spawn, read-only browser gets no typing tools, CSV is script-only", () => {
  assert.ok(!tools("pw-ui-tests-writer", "claude").some((t) => t.startsWith("Agent") || t.startsWith("mcp__")));
  assert.ok(tools("knowledge-generator", "claude").includes("mcp__playwright__browser_snapshot"));
  assert.ok(!tools("knowledge-generator", "claude").includes("mcp__playwright__browser_type"));
  assert.ok(tools("clarification-explorer", "claude").includes("mcp__playwright__browser_fill_form"));
  assert.ok(tools("orchestrator-agent", "claude").includes("AskUserQuestion"));
  assert.ok(!probeTools("claude").includes("Write"));
});

test("browser_session: fresh grants only closing the agent's own session, and only to the clarification-explorer (D-047)", () => {
  assert.ok(tools("clarification-explorer", "claude").includes("mcp__playwright__browser_close"));
  assert.ok(tools("clarification-explorer", "copilot").includes("playwright/browser_close"));
  for (const agent of ["module-explorer", "knowledge-generator", "pw-ui-test-runner-triager"]) assert.ok(!tools(agent, "claude").includes("mcp__playwright__browser_close"), agent);
  const bad = resolvePermissions({ agents: { x: { layer: 2, browser_session: "fresh" }, y: { layer: 2, browser_session: "sometimes", live_target: { browser: "read" } } } });
  assert.deepEqual(bad.errors, ["x: browser_session: fresh needs browser access", "y: browser_session 'sometimes' not in [shared,fresh]"]);
});

test("Copilot tools are the same capabilities in Copilot's names", () => {
  assert.deepEqual(probeTools("copilot"), ["read", "search", "execute"]);
  assert.deepEqual(tools("pw-ui-tests-writer", "copilot"), ["read", "search", "edit", "execute"]);
  assert.ok(tools("knowledge-generator", "copilot").includes("playwright/browser_snapshot"));
  assert.ok(!tools("knowledge-generator", "copilot").includes("playwright/browser_type"));
  assert.equal(tools("knowledge-generator", "copilot").filter((t) => t === "web").length, 1, "web is emitted once");
  assert.ok(tools("orchestrator-agent", "copilot").includes("agent"));
  assert.ok(!tools("pw-ui-reviewer", "copilot").includes("agent"));
});

test("Copilot frontmatter: subagent allow-list, entry agents only, identity hook per agent", () => {
  const orch = generated(".github/agents/orchestrator-agent.agent.md");
  assert.deepEqual(orch.agents, perms.agents["orchestrator-agent"].spawns);
  assert.equal(orch["user-invocable"], true);
  assert.equal(orch["disable-model-invocation"], true);
  const worker = generated(".github/agents/pw-ui-fixer.agent.md");
  assert.equal(worker["user-invocable"], false);
  assert.equal(worker.agents, undefined);
  assert.equal(worker.hooks.PreToolUse[0].command, expandFw("node {fw}/scripts/hooks/pretooluse.mjs --host vscode --agent pw-ui-fixer", FW));
  assert.equal(worker.color, undefined, "color is Claude-only");
  const claude = generated(".claude/agents/pw-ui-fixer.md");
  assert.equal(claude.hooks, undefined, "Claude Code identifies agents from its own hook payload");
  for (const name of Object.keys(perms.agents)) assert.equal(generated(`.github/agents/${name}.agent.md`).name, name);
});

test("a source may not carry platform syntax: generated keys and platform tool names are rejected", () => {
  const root = scratch();
  const file = path.join(root, "agents", "testcase-writer.md");
  const text = readFileSync(file, "utf8").replaceAll("\r\n", "\n"); // core.autocrlf checkouts on Windows
  writeFileSync(file, text.replace("---\n\n", "---\n\nUse AskUserQuestion when unsure.\n"));
  assert.ok(build({ check: true, root }).errors.some((e) => /testcase-writer\.md: body names platform-specific 'AskUserQuestion'/.test(e)));
  writeFileSync(file, text.replace("name: testcase-writer\n", "name: testcase-writer\ntools: Read, Bash\n"));
  assert.ok(build({ check: true, root }).errors.some((e) => /'tools' does not belong in a source/.test(e)));
});

test("missing and stray sources and stray generated files are errors, and nothing is written on error", () => {
  const root = scratch();
  writeFileSync(path.join(root, "agents", "rogue.md"), "---\nname: rogue\ndescription: x\n---\n");
  rmSync(path.join(root, "agents", "testcase-writer.md"));
  const { errors, changed } = build({ root });
  assert.ok(errors.some((e) => /agents\/rogue\.md: not in config\/permissions\.yaml/.test(e)));
  assert.ok(errors.some((e) => /agents\/testcase-writer\.md: missing/.test(e)));
  assert.deepEqual(changed, []);

  const clean = scratch();
  assert.deepEqual(build({ root: clean }).errors, []);
  writeFileSync(path.join(clean, ".github", "agents", "hand-made.agent.md"), "---\nname: hand-made\n---\n");
  assert.ok(build({ check: true, root: clean }).errors.some((e) => /hand-made\.agent\.md: not generated from agents\//.test(e)));
});

test("a hand edit of a generated file is drift", () => {
  const root = scratch();
  build({ root });
  const rel = ".claude/agents/pw-ui-fixer.md";
  writeFileSync(path.join(root, rel), readFileSync(path.join(root, rel), "utf8").replace("tools: ", "tools: WebSearch, "));
  assert.deepEqual(build({ check: true, root }).changed, [rel]);
});

test("a body over the Copilot prompt limit fails the build", () => {
  const root = scratch();
  const file = path.join(root, "agents", "testcase-writer.md");
  writeFileSync(file, readFileSync(file, "utf8") + "x".repeat(platforms.copilot.body_limit));
  assert.ok(build({ check: true, root }).errors.some((e) => /over the copilot limit/.test(e)));
});

test("MCP servers are defined once and rendered for each platform", () => {
  const claude = JSON.parse(readFileSync(path.join(workspaceRoot, ".mcp.json"), "utf8"));
  const vscode = JSON.parse(readFileSync(path.join(workspaceRoot, ".vscode", "mcp.json"), "utf8"));
  assert.deepEqual(claude.mcpServers, vscode.servers);
  // as config/mcp.yaml defines them, with its `{fw}/` expanded to the framework's path from the workspace
  assert.deepEqual(claude.mcpServers, JSON.parse(expandFw(JSON.stringify(load("config/mcp.yaml").servers), FW)));
  assert.ok(JSON.stringify(load("config/mcp.yaml").servers).includes('"{fw}/scripts/browser/init-page.cjs"'), "the source names the init page by its framework path");
});

test("hook registrations: --post-hook sets the PostToolUse mode for every host; the guard is always registered (D-042)", () => {
  const root = scratch();
  mkdirSync(path.join(root, ".claude"));
  writeFileSync(path.join(root, ".claude", "settings.json"), JSON.stringify({ permissions: { allow: ["Bash(ls:*)"] } }));
  const json = (rel) => JSON.parse(readFileSync(path.join(root, rel), "utf8"));
  const hosts = () => {
    const claude = json(".claude/settings.json");
    return { claude, claudeHooks: claude.hooks, copilot: json(".github/hooks/framework-guard.json").hooks, vscode: json(".vscode/hooks/framework-guard.json").hooks };
  };

  assert.deepEqual(build({ root, postHook: "async" }).errors, []);
  let h = hosts();
  assert.deepEqual(h.claude.permissions, { allow: ["Bash(ls:*)"] }, "other settings keys are kept");
  assert.equal(h.claudeHooks.PostToolUse[0].hooks[0].async, true);
  for (const x of [h.copilot, h.vscode]) assert.equal(x.PostToolUse[0].async, undefined, "Copilot and VS Code have no background hooks");
  assert.match(readFileSync(path.join(root, "config", "hooks.yaml"), "utf8"), /^post_tool_use: async$/m);

  assert.deepEqual(build({ root, postHook: "sync" }).errors, []);
  h = hosts();
  assert.equal(h.claudeHooks.PostToolUse[0].hooks[0].async, undefined);
  assert.deepEqual(build({ check: true, root }).changed, [], "the saved mode is what --check builds");

  assert.deepEqual(build({ root, postHook: "off" }).errors, []);
  h = hosts();
  for (const x of [h.claudeHooks, h.copilot, h.vscode]) {
    assert.equal(x.PostToolUse, undefined);
    assert.ok(x.PreToolUse.length, "the guard is never configurable away");
  }
});

test("hook registrations: a bad mode, or --post-hook with --check, writes nothing", () => {
  const root = scratch();
  const config = path.join(root, "config", "hooks.yaml");
  const before = readFileSync(config, "utf8");
  assert.ok(build({ root, postHook: "later" }).errors.some((e) => /not in \[async,sync,off\]/.test(e)));
  assert.ok(build({ root, check: true, postHook: "off" }).errors.some((e) => /cannot be combined with --check/.test(e)));
  assert.equal(readFileSync(config, "utf8"), before);
  writeFileSync(config, "post_tool_use: maybe\n");
  assert.ok(build({ check: true, root }).errors.some((e) => /post_tool_use 'maybe'/.test(e)));
});

// agents/_shared/<file>.md fragments, included with `<!-- include: _shared/<file>.md -->` (G9)
function withInclude(root, fragment = "Shared fixer rule: report, do not guess.") {
  mkdirSync(path.join(root, "agents", "_shared"), { recursive: true });
  writeFileSync(path.join(root, "agents", "_shared", "probe.md"), fragment + "\n");
  const file = path.join(root, "agents", "pw-ui-fixer.md");
  writeFileSync(file, readFileSync(file, "utf8").replace(/\r?\n$/, "") + "\n\n<!-- include: _shared/probe.md -->\n");
}

test("an include expands into every platform's generated file, and a changed fragment is drift", () => {
  const root = scratch();
  withInclude(root);
  const first = build({ root });
  assert.deepEqual(first.errors, []);
  for (const rel of [".claude/agents/pw-ui-fixer.md", ".github/agents/pw-ui-fixer.agent.md"]) {
    const text = readFileSync(path.join(root, rel), "utf8");
    assert.match(text, /Shared fixer rule: report, do not guess\./);
    assert.ok(!text.includes("<!-- include"), "the marker is replaced by the fragment");
  }
  assert.deepEqual(build({ check: true, root }).changed, []);
  writeFileSync(path.join(root, "agents", "_shared", "probe.md"), "Changed rule.\n");
  assert.deepEqual(build({ check: true, root }).changed.sort(), [".claude/agents/pw-ui-fixer.md", ".github/agents/pw-ui-fixer.agent.md"]);
});

test("a missing, malformed or nested include is a build error; the expanded body gets the platform-neutral lint", () => {
  const root = scratch();
  withInclude(root);
  const file = path.join(root, "agents", "pw-ui-fixer.md");
  const original = readFileSync(file, "utf8");
  writeFileSync(file, original.replace("_shared/probe.md", "_shared/nope.md"));
  assert.ok(build({ check: true, root }).errors.some((e) => /pw-ui-fixer\.md: include '_shared\/nope\.md' names no file/.test(e)));
  writeFileSync(file, original.replace("_shared/probe.md", "../config/mcp.yaml"));
  assert.ok(build({ check: true, root }).errors.some((e) => /must be _shared\/<file>\.md/.test(e)));
  writeFileSync(file, original);
  writeFileSync(path.join(root, "agents", "_shared", "probe.md"), "<!-- include: _shared/probe.md -->\n");
  assert.ok(build({ check: true, root }).errors.some((e) => /cannot include another fragment/.test(e)));
  writeFileSync(path.join(root, "agents", "_shared", "probe.md"), "Use AskUserQuestion when unsure.\n");
  assert.ok(build({ check: true, root }).errors.some((e) => /pw-ui-fixer\.md: body names platform-specific 'AskUserQuestion'/.test(e)));
});

test("the fragment directory is not an agent: no stray-source error, no generated file", () => {
  const root = scratch();
  withInclude(root);
  writeFileSync(path.join(root, "agents", "_shared", "other.md"), "No frontmatter here.\n");
  const { errors } = build({ root });
  assert.deepEqual(errors, []);
  for (const rel of [".claude/agents", ".github/agents"]) assert.ok(!readdirSync(path.join(root, rel)).some((f) => /probe|other|_shared/.test(f)));
});

// ---- G10 (D-060): orchestrators are pure loops over script decisions; workers record requests through the script ----
const body = (rel) => splitFrontmatter(readFileSync(path.join(workspaceRoot, rel), "utf8"), rel).body;
const DOMAIN_ORCHESTRATORS = { "playwright-ui-orchestrator": "playwright-ui", "playwright-api-orchestrator": "playwright-api", "k6-orchestrator": "k6", "testcase-orchestrator": "testcases", "clarification-orchestrator": "clarifications" };

test("the five domain orchestrators are the shared loop body plus a short domain section, in every platform's file", () => {
  // as rendered here: `{fw}/` (D-085) is the framework's path from the workspace, empty when they are one directory
  const shared = expandFw(readFileSync(path.join(frameworkRoot, "agents", "_shared", "domain-loop.md"), "utf8"), FW).replace(/\r\n/g, "\n").replace(/\n+$/, "");
  for (const [name, domain] of Object.entries(DOMAIN_ORCHESTRATORS)) {
    const src = readFileSync(path.join(frameworkRoot, "agents", `${name}.md`), "utf8");
    assert.match(src, /<!-- include: _shared\/domain-loop.md -->/, `${name} includes the shared body`);
    assert.ok(src.split("\n").length < 24, `${name}: a short domain section`);
    assert.ok(src.includes(`\`<domain>\` is \`${domain}\``), `${name} names its domain`);
    for (const rel of [`.claude/agents/${name}.md`, `.github/agents/${name}.agent.md`]) {
      const text = body(rel).replace(/\r\n/g, "\n");
      assert.ok(text.includes(shared), `${rel} holds the expanded shared body`);
      assert.ok(!text.includes("<!-- include"), `${rel}: no include marker left`);
    }
  }
  // the loop is the script's: next, step start/done/fail, waiting, done; nothing a script decides is decided in the prompt
  for (const needle of ["orchestration.mjs next <p> <domain> <m>", "step <p> <domain> <m> <step> start", "`waiting`", "`done`", "exactly as given", "`req-<n>`", "`redo-<step>`", "`reviewFailure`"]) assert.ok(shared.includes(needle), `shared body mentions ${needle}`);
  assert.ok(!/relay/i.test(shared.replace(/you never relay one by hand/, "")), "the orchestrator relays nothing by hand");
});

test("orchestrator-agent is a loop over run.mjs next: exact prompts, one retry on a refused done, report-and-end when awaiting approval", () => {
  const text = readFileSync(path.join(frameworkRoot, "agents", "orchestrator-agent.md"), "utf8");
  for (const needle of ["run.mjs next <p>", "{actions, concurrency, end?}", "retry: {agent, prompt}", "`failed: true`", "`end.outcome`", "`awaiting-approval`", "`end.sheets`", "`incomplete`", "carriedFrom", "reviewFailed", "exactly as given"])
    assert.ok(text.includes(needle), `orchestrator-agent mentions ${needle}`);
  assert.ok(!/knowledge\.mjs plan/.test(text), "knowledge reuse is decided in code");
  assert.ok(!/\| `playwright-ui` \|/.test(text), "the stage -> agent -> prompt table moved into run.mjs");
});

test("every worker that can ask records its request through requests.mjs add, and the agents that handle it read requests=<path> ids=<ids>", () => {
  const ASKERS = { "pw-ui-tests-writer": "playwright-ui", "pw-ui-pom-writer": "playwright-ui", "pw-ui-scaffolder": "playwright-ui", "pw-api-tests-writer": "playwright-api", "pw-api-client-writer": "playwright-api", "pw-api-scaffolder": "playwright-api", "k6-script-writer": "k6" };
  for (const [name, domain] of Object.entries(ASKERS)) {
    assert.ok(perms.agents[name].shell_allow.includes("node scripts/requests.mjs add *"), `${name}: may run requests.mjs add`);
    const text = readFileSync(path.join(frameworkRoot, "agents", `${name}.md`), "utf8");
    assert.ok(text.includes(`requests.mjs add <p> ${domain} <m> --from ${name}`), `${name} records with the right domain and --from`);
  }
  for (const [name, a] of Object.entries(perms.agents)) if (!(name in ASKERS)) assert.ok(!a.shell_allow?.includes("node scripts/requests.mjs add *"), `${name} may not add requests`);
  for (const name of ["pw-repo-owner", "pw-ui-pom-writer", "pw-api-client-writer", "pw-ui-scaffolder", "pw-api-scaffolder", "k6-lib-writer"]) {
    const text = readFileSync(path.join(frameworkRoot, "agents", `${name}.md`), "utf8");
    assert.match(text, /requests=<path> ids=<ids>/, `${name} takes requests=<path> ids=<ids>`);
    assert.ok(!/missing="|gap="|request="/.test(text), `${name}: the old free-text parameters are gone`);
  }
});
