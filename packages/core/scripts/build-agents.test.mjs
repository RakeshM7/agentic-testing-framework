// The single-source agent build: one neutral source per agent -> one generated file per platform, tools derived from
// config/permissions.yaml only, platform syntax only from config/platforms.yaml.
import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { build, tomlName } from "./build-agents.mjs";
import { renderHookRegistrations } from "./lib/hook-registrations.mjs";
import { capabilitiesFor, toolNames } from "./lib/agents/capabilities.mjs";
import { forbiddenIdentifiers, lintBody } from "./lib/agents/lint.mjs";
import { splitFrontmatter } from "./lib/agents/source.mjs";
import { generatedNote, isGenerated } from "./lib/agents/renderers/common.mjs";
import { frameworkRoot } from "./lib/contract.mjs";
import { resolvePermissions } from "./lib/permissions.mjs";
import { devAgentsDir, expandFw, frameworkRel, isInstalled, workspaceRoot } from "./lib/roots.mjs";
import { installedWorkspace } from "./test-helpers.mjs";

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
// An agent's generated file on every platform (config/platforms.yaml `output`).
// the markdown agent files (frontmatter + body), and every agent file, Codex's TOML one included
const MD_OUTS = (name) => [`.claude/agents/${name}.md`, `.github/agents/${name}.agent.md`, `.agents/agents/${name}.md`];
const OUTS = (name) => [...MD_OUTS(name), `.codex/agents/${name}.toml`];

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

// ---- Antigravity (App, agy CLI, IDE): rendered in a scratch build, so these hold before the committed files exist
test("Antigravity tools are the same capabilities in Antigravity's names; only the Playwright server's browser tools", () => {
  assert.deepEqual(probeTools("antigravity"), ["view_file", "list_dir", "grep_search", "find_by_name", "run_command"]);
  assert.deepEqual(tools("pw-ui-tests-writer", "antigravity"), ["view_file", "list_dir", "grep_search", "find_by_name", "write_to_file", "replace_file_content", "multi_replace_file_content", "run_command"]);
  const kg = tools("knowledge-generator", "antigravity");
  assert.ok(kg.includes("read_url_content") && kg.includes("search_web"));
  assert.ok(kg.includes("mcp_playwright_browser_snapshot"));
  assert.ok(!kg.includes("mcp_playwright_browser_type"), "read-only browser gets no typing tools");
  assert.ok(tools("clarification-explorer", "antigravity").includes("mcp_playwright_browser_close"));
  assert.ok(tools("orchestrator-agent", "antigravity").includes("invoke_subagent"));
  assert.ok(tools("orchestrator-agent", "antigravity").includes("ask_question"));
  assert.ok(!tools("pw-ui-reviewer", "antigravity").includes("invoke_subagent"));
  // deliberately unmapped: Antigravity's own browser and subagent-management tools are never granted (D-070)
  for (const name of Object.keys(perms.agents))
    for (const t of tools(name, "antigravity")) assert.ok(!/^(browser_|define_subagent|send_message|manage_subagents|schedule|generate_image)/.test(t), `${name}: ${t}`);
});

test("Antigravity frontmatter: entry agents are the main agent, the rest subagents; model, execution policy, no MCP or hook keys", () => {
  const root = scratch();
  assert.deepEqual(build({ root }).errors, []);
  const meta = (name) => splitFrontmatter(readFileSync(path.join(root, ".agents", "agents", `${name}.md`), "utf8"), name).meta;
  const model = load("config/models.yaml").default.antigravity;
  assert.equal(model, "inherit", "the human picks the model in Antigravity (D-100)");
  const orch = meta("orchestrator-agent");
  assert.equal(orch.mainAgent, true);
  assert.equal(orch.subagent, false);
  assert.deepEqual(orch.tools, tools("orchestrator-agent", "antigravity"));
  const worker = meta("pw-ui-fixer");
  assert.equal(worker.mainAgent, false);
  assert.equal(worker.subagent, true);
  assert.equal(worker.commandExecutionPolicy, "sandbox");
  // any live target (browser, HTTP, load), or a shell allow-list running npm/npx/playwright/k6 or foundation.mjs install,
  // runs unsandboxed; every other agent stays in the sandbox (AG.md decision 6, provisional until the spike)
  const auto = ["knowledge-generator", "module-explorer", "api-discoverer", "clarification-explorer", "pw-repo-owner", "pw-ui-test-runner-triager", "pw-api-test-runner-triager", "k6-runner-triager"];
  assert.deepEqual(Object.keys(perms.agents).filter((name) => meta(name).commandExecutionPolicy === "auto").sort(), [...auto].sort());
  const network = (row) => row.shell !== "none" && row.shell_allow.some((c) => /^\s*(?:\S*[/\\])?(?:npm|npx|playwright|k6)(?:\.cmd|\.exe)?(?:\s|$)|\bfoundation\.mjs install\b/i.test(c));
  for (const [name, row] of Object.entries(perms.agents)) {
    const m = meta(name);
    const entry = splitFrontmatter(readFileSync(path.join(frameworkRoot, "agents", `${name}.md`), "utf8"), name).meta.user_invocable === true;
    assert.equal(m.name, name);
    assert.equal(m.mainAgent, entry, name);
    assert.equal(m.subagent, !entry, name);
    assert.equal(m.model, model, name);
    assert.equal(m.commandExecutionPolicy, Object.values(row.live_target).some((level) => level !== "none") || network(row) ? "auto" : "sandbox", name);
    assert.deepEqual(m.tools, tools(name, "antigravity"), name);
    for (const key of ["mcpServers", "hooks", "agents", "color", "user-invocable"]) assert.equal(m[key], undefined, `${name}: no ${key}`);
  }
  assert.deepEqual(build({ check: true, root }), { errors: [], changed: [] });
});

test("Antigravity's MCP config is .agents/mcp_config.json under mcpServers, the same servers as every platform's", () => {
  assert.deepEqual(platforms.antigravity.mcp_config, { path: ".agents/mcp_config.json", key: "mcpServers" });
  const root = scratch();
  assert.deepEqual(build({ root }).errors, []);
  const ag = JSON.parse(readFileSync(path.join(root, ".agents", "mcp_config.json"), "utf8"));
  assert.deepEqual(Object.keys(ag), ["mcpServers"]);
  assert.deepEqual(ag.mcpServers, JSON.parse(readFileSync(path.join(root, ".mcp.json"), "utf8")).mcpServers);
});

test("a body may not name an Antigravity tool: every built-in name in its tools map is forbidden, and the build rejects one", () => {
  const forbidden = forbiddenIdentifiers(platforms);
  const { tools: map } = platforms.antigravity;
  for (const name of [...Object.values(map).filter(Array.isArray).flat(), map.spawn, "mcp_playwright_browser_click"])
    assert.equal(lintBody("probe", `Call ${name} now.`, forbidden).length > 0, true, name);
  const root = scratch();
  const file = path.join(root, "agents", "testcase-writer.md");
  writeFileSync(file, readFileSync(file, "utf8").replaceAll("\r\n", "\n").replace("---\n\n", "---\n\nUse invoke_subagent to delegate.\n"));
  const { errors, changed } = build({ root });
  assert.ok(errors.some((e) => /testcase-writer\.md: body names platform-specific 'invoke_subagent'/.test(e)), errors.join("\n"));
  assert.deepEqual(changed, []);
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
  for (const rel of OUTS("pw-ui-fixer")) {
    const text = readFileSync(path.join(root, rel), "utf8");
    assert.match(text, /Shared fixer rule: report, do not guess\./);
    assert.ok(!text.includes("<!-- include"), "the marker is replaced by the fragment");
  }
  assert.deepEqual(build({ check: true, root }).changed, []);
  writeFileSync(path.join(root, "agents", "_shared", "probe.md"), "Changed rule.\n");
  assert.deepEqual(build({ check: true, root }).changed.sort(), OUTS("pw-ui-fixer").sort());
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
  for (const rel of [".claude/agents", ".github/agents", ".agents/agents", ".codex/agents"]) assert.ok(!readdirSync(path.join(root, rel)).some((f) => /probe|other|_shared/.test(f)));
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
    for (const rel of MD_OUTS(name)) {
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

// ---- add-on fragments (docs/packaging.md §3.5): a workspace's atf/agents/<name>.extra.md, appended under a fixed heading
// A framework copy and a client workspace apart from it (D-085), so fragments are read from the workspace, not the sources.
function splitPair() {
  const framework = scratch();
  const ws = mkdtempSync(path.join(tmpdir(), "atf-ws-"));
  mkdirSync(path.join(ws, "atf", "agents"), { recursive: true });
  writeFileSync(path.join(ws, "atf", "atf.json"), "{}\n");
  return { framework, ws, run: (opts = {}) => build({ root: ws, framework, ...opts }) };
}
const fragmentFile = (ws, name) => path.join(ws, "atf", "agents", `${name}.extra.md`);
const HEADING = "## Project additions (from atf/agents/pw-ui-fixer.extra.md)";

test("a fragment is appended under the fixed heading in every platform's file; no fragment changes nothing", () => {
  const { framework, ws, run } = splitPair();
  assert.deepEqual(run().errors, []);
  const read = (rel) => readFileSync(path.join(ws, rel), "utf8");
  const before = Object.fromEntries([...OUTS("pw-ui-fixer"), ...OUTS("testcase-writer")].map((rel) => [rel, read(rel)]));
  // an empty atf/agents/ (and a dot-file in it) is no fragment: byte for byte the same files
  writeFileSync(path.join(ws, "atf", "agents", ".DS_Store"), "x");
  assert.deepEqual(run({ check: true }), { errors: [], changed: [] });

  writeFileSync(fragmentFile(ws, "pw-ui-fixer"), "\n\nHouse rule: run `npm run lint` before reporting.\n- second line\n\n\n");
  assert.deepEqual(run().errors, []);
  const eol = readFileSync(path.join(framework, "agents", "pw-ui-fixer.md"), "utf8").includes("\r\n") ? "\r\n" : "\n";
  for (const rel of MD_OUTS("pw-ui-fixer")) {
    const expected = before[rel].replace(/(\r?\n)+$/, "") + [eol, HEADING, "", "House rule: run `npm run lint` before reporting.", "- second line"].join(eol) + eol;
    assert.equal(read(rel), expected, `${rel}: one blank line, the heading, one blank line, the trimmed fragment`);
  }
  // Codex: the same text at the end of developer_instructions
  const toml = read(".codex/agents/pw-ui-fixer.toml");
  assert.ok(toml.includes([HEADING, "", "House rule: run `npm run lint` before reporting.", "- second line", "'''"].join(eol)), ".codex/agents/pw-ui-fixer.toml: the fragment ends the instructions");
  for (const rel of OUTS("testcase-writer")) assert.equal(read(rel), before[rel], `${rel}: another agent is untouched`);
  // identity is the framework's and config's only: the frontmatter is unchanged
  for (const rel of MD_OUTS("pw-ui-fixer")) assert.deepEqual(splitFrontmatter(read(rel), rel).meta, splitFrontmatter(before[rel], rel).meta);
  const tomlHead = (text) => text.split("developer_instructions")[0];
  assert.equal(tomlHead(read(".codex/agents/pw-ui-fixer.toml")), tomlHead(before[".codex/agents/pw-ui-fixer.toml"]));
  // removing it puts the files back
  rmSync(fragmentFile(ws, "pw-ui-fixer"));
  assert.deepEqual(run({ check: true }).changed.sort(), OUTS("pw-ui-fixer").sort());
});

test("a fragment is linted and limited as part of the combined body, with errors naming it; nothing is written", () => {
  const { framework, ws, run } = splitPair();
  const lint = (text) => {
    writeFileSync(fragmentFile(ws, "pw-ui-fixer"), text);
    return run();
  };
  for (const tool of ["AskUserQuestion", "runSubagent"]) {
    const r = lint(`Ask with ${tool} when unsure.\n`);
    assert.ok(r.errors.some((e) => e.startsWith(`agents/pw-ui-fixer.md + atf/agents/pw-ui-fixer.extra.md: body names platform-specific '${tool}'`)), r.errors.join("\n"));
    assert.deepEqual(r.changed, []);
  }
  assert.ok(lint("Run node {fw}scripts/x.mjs\n").errors.some((e) => /pw-ui-fixer\.extra\.md: '\{fw\}s' -- the only template token/.test(e)));
  assert.ok(lint("{{ product }}\n").errors.some((e) => /pw-ui-fixer\.extra\.md: template syntax/.test(e)));
  // under the Copilot limit alone, over it once appended to the source's body
  const limit = platforms.copilot.body_limit;
  const r = lint("x".repeat(limit - 100) + "\n");
  assert.ok(r.errors.some((e) => /^agents\/pw-ui-fixer\.md \+ atf\/agents\/pw-ui-fixer\.extra\.md: body is \d+ characters, over the copilot limit/.test(e)), r.errors.join("\n"));
  assert.ok(!existsSync(path.join(ws, ".claude")), "an error writes nothing");
  // `{fw}/` is the one token, and a fragment gets it expanded like a source
  assert.deepEqual(lint("Read `{fw}/docs/conventions.md` first.\n").errors, []);
  assert.ok(readFileSync(path.join(ws, ".claude", "agents", "pw-ui-fixer.md"), "utf8").includes(`Read \`${frameworkRel(ws, framework)}/docs/conventions.md\` first.`));
});

test("a fragment can't carry frontmatter or an include; an unknown agent's fragment or a stray entry fails, named", () => {
  const { ws, run } = splitPair();
  const errs = () => run({ check: true }).errors;
  writeFileSync(fragmentFile(ws, "pw-ui-fixer"), "---\nname: pw-ui-fixer\ntools: Read, Bash, WebSearch\nmodel: opus\n---\nMore rules.\n");
  assert.ok(errs().some((e) => /^atf\/agents\/pw-ui-fixer\.extra\.md: an add-on fragment has no frontmatter/.test(e)));
  writeFileSync(fragmentFile(ws, "pw-ui-fixer"), "\r\n---\r\nmodel: opus\r\n---\r\n"); // after the trim, CRLF too
  assert.ok(errs().some((e) => /pw-ui-fixer\.extra\.md: an add-on fragment has no frontmatter/.test(e)));
  writeFileSync(fragmentFile(ws, "pw-ui-fixer"), "<!-- include: _shared/fixer.md -->\n");
  assert.ok(errs().some((e) => /pw-ui-fixer\.extra\.md: an add-on fragment cannot include _shared\//.test(e)));
  writeFileSync(fragmentFile(ws, "pw-ui-fixer"), " \n\n");
  assert.ok(errs().some((e) => /pw-ui-fixer\.extra\.md: empty/.test(e)));
  rmSync(fragmentFile(ws, "pw-ui-fixer"));

  writeFileSync(fragmentFile(ws, "pw-ui-fxer"), "Typo in the name.\n");
  assert.deepEqual(errs(), ["atf/agents/pw-ui-fxer.extra.md: the framework has no agent 'pw-ui-fxer' to add to"]);
  rmSync(fragmentFile(ws, "pw-ui-fxer"));
  for (const stray of ["pw-ui-fixer.md", "notes.txt", "pw-ui-fixer.EXTRA.MD", "sub/pw-ui-fixer.extra.md"]) {
    mkdirSync(path.dirname(path.join(ws, "atf", "agents", stray)), { recursive: true });
    writeFileSync(path.join(ws, "atf", "agents", stray), "text\n");
    const top = stray.split("/")[0];
    assert.deepEqual(errs(), [`atf/agents/${top}: only <agent>.extra.md add-on fragments belong in atf/agents/`], stray);
    rmSync(path.join(ws, "atf", "agents", top), { recursive: true });
  }
  assert.deepEqual(errs(), []);
});

test("check mode flags a changed fragment as drift in that agent's files only", () => {
  const { ws, run } = splitPair();
  writeFileSync(fragmentFile(ws, "pw-ui-fixer"), "Rule one.\n");
  assert.deepEqual(run().errors, []);
  assert.deepEqual(run({ check: true }), { errors: [], changed: [] });
  writeFileSync(fragmentFile(ws, "pw-ui-fixer"), "Rule one.\nRule two.\n");
  assert.deepEqual(run({ check: true }).changed.sort(), OUTS("pw-ui-fixer").sort());
});

test("a CRLF source keeps CRLF through its fragment; a workspace that is its own framework reads atf/agents/ too", () => {
  const root = scratch();
  const src = path.join(root, "agents", "pw-ui-fixer.md");
  writeFileSync(src, readFileSync(src, "utf8").replace(/\r?\n/g, "\r\n"));
  mkdirSync(path.join(root, "atf", "agents"), { recursive: true });
  writeFileSync(path.join(root, "atf", "agents", "pw-ui-fixer.extra.md"), "Line one.\nLine two.\n"); // LF, as a client may save it
  assert.deepEqual(build({ root }).errors, []);
  for (const rel of OUTS("pw-ui-fixer")) {
    const text = readFileSync(path.join(root, rel), "utf8");
    // the fragment's lines, and the line its `<!-- include: _shared/fixer.md -->` stood on, as a Windows checkout has them
    assert.ok(!/(^|[^\r])\n/.test(text), `${rel}: CRLF throughout`);
    const tail = `\r\n\r\n${HEADING}\r\n\r\nLine one.\r\nLine two.\r\n`;
    assert.ok(rel.endsWith(".toml") ? text.includes(`${tail}'''`) : text.endsWith(tail), rel);
  }
});

// ---- a client's workspace (docs/packaging.md §3.5–3.6): the framework installed in node_modules, its sources not the
// client's to edit, and the agent folders shared with the client's own agents
// the generated note: the line after `---` in a markdown agent file, the first line of a Codex TOML one
const noteOf = (root, rel) => readFileSync(path.join(root, rel), "utf8").split(/\r?\n/)[rel.endsWith(".toml") ? 0 : 1];
const put = (root, rel, text) => {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), text);
};
const CLIENT_AGENT = (name) => `---\nname: ${name}\ndescription: Our own reviewer.\n---\nReview against our style guide.\n`;

test("the generated note in a source checkout is word for word what the committed files have (no drift from the installed wording)", () => {
  for (const rel of OUTS("pw-ui-fixer"))
    assert.equal(noteOf(workspaceRoot, rel), expandFw("# GENERATED from {fw}/agents/pw-ui-fixer.md by {fw}/scripts/build-agents.mjs -- edit the source, then run npm run build-agents.", FW), rel);
  const root = scratch();
  assert.ok(!isInstalled(root));
  assert.deepEqual(build({ root }).errors, []);
  for (const rel of OUTS("pw-ui-fixer")) assert.equal(noteOf(root, rel), "# GENERATED from agents/pw-ui-fixer.md by scripts/build-agents.mjs -- edit the source, then run npm run build-agents.");
  assert.equal(generatedNote("pw-ui-fixer", FW), expandFw("# GENERATED from {fw}/agents/pw-ui-fixer.md by {fw}/scripts/build-agents.mjs -- edit the source, then run npm run build-agents.", FW));
});

test("installed: the generated note names atf sync, the agent's fragment and atf/ config, never npm run build-agents", () => {
  const { root, framework } = installedWorkspace();
  assert.ok(isInstalled(framework));
  assert.deepEqual(build({ root, framework }).errors, []);
  const note = "# GENERATED by atf sync from @testagentic/atf (agents/pw-ui-fixer.md) -- do not edit: add instructions in atf/agents/pw-ui-fixer.extra.md, or config in atf/ (overlays, or npx atf eject config), then run npx atf sync.";
  for (const rel of OUTS("pw-ui-fixer")) {
    const text = readFileSync(path.join(root, rel), "utf8");
    assert.equal(noteOf(root, rel), note, rel);
    assert.ok(isGenerated(text), `${rel}: still carries the generated marker`);
    assert.ok(!text.includes("npm run build-agents"), rel);
  }
  // it is still a YAML comment: the frontmatter's keys are the same as a source checkout renders them
  const scratchRoot = scratch();
  build({ root: scratchRoot });
  const meta = (r) => splitFrontmatter(readFileSync(path.join(r, ".claude/agents/pw-ui-fixer.md"), "utf8"), "x").meta;
  assert.deepEqual(Object.keys(meta(root)), Object.keys(meta(scratchRoot)));
});

test("installed: a client's own agent (no generated marker) survives build and check, untouched and unreported", () => {
  const { root, framework } = installedWorkspace();
  const own = {
    ".claude/agents/house-style.md": CLIENT_AGENT("house-style"),
    ".github/agents/house-style.agent.md": CLIENT_AGENT("house-style"),
    // a comment of their own tool's, or our wording anywhere but the frontmatter's first line, is not our marker
    ".claude/agents/tooled.md": "---\n# GENERATED by our own scaffolder\nname: tooled\ndescription: x\n---\n",
    ".github/agents/notes.agent.md": "Body only, no frontmatter.\n# GENERATED from agents/notes.md by scripts/build-agents.mjs\n",
    ".claude/agents/README.txt": "not an agent file\n",
  };
  for (const [rel, text] of Object.entries(own)) put(root, rel, text);
  const first = build({ root, framework });
  assert.deepEqual(first.errors, []);
  assert.ok(!first.changed.some((rel) => rel in own), first.changed.join("\n"));
  assert.deepEqual(build({ root, framework, check: true }), { errors: [], changed: [] });
  assert.deepEqual(build({ root, framework }), { errors: [], changed: [] });
  for (const [rel, text] of Object.entries(own)) assert.equal(readFileSync(path.join(root, rel), "utf8"), text, rel);
});

test("installed: a framework-marked agent file with no source (a dropped agent) is reported by check and removed by build", () => {
  const { root, framework } = installedWorkspace();
  assert.deepEqual(build({ root, framework }).errors, []);
  const generatedText = (rel) => readFileSync(path.join(root, rel), "utf8");
  const orphans = {
    ".claude/agents/retired-one.md": generatedText(".claude/agents/pw-ui-fixer.md"),
    ".github/agents/retired-one.agent.md": generatedText(".github/agents/pw-ui-fixer.agent.md"),
    // as an older package (or a source checkout's build) wrote it: the marker is either wording
    ".claude/agents/older-one.md": "---\n# GENERATED from node_modules/@testagentic/atf/agents/older-one.md by node_modules/@testagentic/atf/scripts/build-agents.mjs -- edit the source, then run npm run build-agents.\nname: older-one\n---\n",
  };
  for (const [rel, text] of Object.entries(orphans)) put(root, rel, text);
  put(root, ".claude/agents/house-style.md", CLIENT_AGENT("house-style"));
  const wanted = Object.keys(orphans).sort();
  assert.deepEqual(build({ root, framework, check: true }), { errors: [], changed: wanted }, "check flags them as out of date");
  for (const rel of wanted) assert.ok(existsSync(path.join(root, rel)), `check removes nothing: ${rel}`);
  const r = build({ root, framework });
  assert.deepEqual(r.errors, []);
  assert.deepEqual([...r.changed].sort(), wanted);
  for (const rel of wanted) assert.ok(!existsSync(path.join(root, rel)), `${rel} removed`);
  assert.ok(existsSync(path.join(root, ".claude/agents/house-style.md")), "the client's own agent stays");
  assert.deepEqual(build({ root, framework, check: true }), { errors: [], changed: [] });
});

test("installed: a client agent whose file or name: is a framework agent's is an error naming it; nothing is written", () => {
  const { root, framework } = installedWorkspace();
  const clash = {
    ".claude/agents/pw-ui-fixer.md": CLIENT_AGENT("pw-ui-fixer"),
    // on a case-insensitive disk this IS the generated file's path
    ".github/agents/Testcase-Writer.agent.md": CLIENT_AGENT("my-scribe"),
    // another file name, but the hosts (and the guard, D-021) know an agent by its name:
    ".claude/agents/my-conductor.md": CLIENT_AGENT("orchestrator-agent"),
  };
  for (const [rel, text] of Object.entries(clash)) put(root, rel, text);
  for (const check of [true, false]) {
    const { errors, changed } = build({ root, framework, check });
    assert.deepEqual(changed, []);
    assert.equal(errors.length, 3, errors.join("\n"));
    assert.ok(errors.some((e) => e.startsWith(".claude/agents/pw-ui-fixer.md: your own agent (no GENERATED marker), but the framework's agent 'pw-ui-fixer' is written to this file, so atf sync would overwrite it: rename")), errors.join("\n"));
    assert.ok(errors.some((e) => e.startsWith(".github/agents/Testcase-Writer.agent.md: your own agent (no GENERATED marker), but the framework's agent 'testcase-writer'")), errors.join("\n"));
    assert.ok(errors.some((e) => e.startsWith(".claude/agents/my-conductor.md: your own agent is named 'orchestrator-agent', the name of a framework agent; rename it")), errors.join("\n"));
  }
  for (const [rel, text] of Object.entries(clash)) assert.equal(readFileSync(path.join(root, rel), "utf8"), text, rel);
  assert.ok(!existsSync(path.join(root, ".claude/agents/testcase-writer.md")), "an error writes nothing");
  assert.ok(!existsSync(path.join(root, ".mcp.json")));
  // renamed, it syncs
  rmSync(path.join(root, ".claude/agents/pw-ui-fixer.md"));
  rmSync(path.join(root, ".github/agents/Testcase-Writer.agent.md"));
  put(root, ".claude/agents/my-conductor.md", CLIENT_AGENT("house-conductor"));
  assert.deepEqual(build({ root, framework }).errors, []);
});

test("a source checkout stays as strict as before: any agent file without a source is an error, marked or not, and stays", () => {
  for (const pair of [false, true]) {
    // the framework as its own workspace, and a source checkout apart from the workspace (neither is installed)
    const framework = scratch();
    const root = pair ? mkdtempSync(path.join(tmpdir(), "atf-ws-")) : framework;
    assert.ok(!isInstalled(framework));
    assert.deepEqual(build({ root, framework }).errors, []);
    put(root, ".claude/agents/retired-one.md", readFileSync(path.join(root, ".claude/agents/pw-ui-fixer.md"), "utf8"));
    put(root, ".github/agents/house-style.agent.md", CLIENT_AGENT("house-style"));
    for (const check of [true, false]) {
      const { errors, changed } = build({ root, framework, check });
      assert.deepEqual(changed, []);
      assert.deepEqual(errors.sort(), [
        ".claude/agents/retired-one.md: not generated from agents/ (no source or no permissions row); remove it or add agents/<name>.md",
        ".github/agents/house-style.agent.md: not generated from agents/ (no source or no permissions row); remove it or add agents/<name>.md",
      ]);
    }
    assert.ok(existsSync(path.join(root, ".claude/agents/retired-one.md")), "never removed there");
    // a hand-made file at a generated path is drift there, as before, not a clash
    rmSync(path.join(root, ".claude/agents/retired-one.md"));
    rmSync(path.join(root, ".github/agents/house-style.agent.md"));
    put(root, ".claude/agents/pw-ui-fixer.md", CLIENT_AGENT("pw-ui-fixer"));
    assert.deepEqual(build({ root, framework, check: true }), { errors: [], changed: [".claude/agents/pw-ui-fixer.md"] });
  }
});

// ---- the MCP config files in a client's workspace: rendered whole, so what the client added by hand is named, never
// dropped (lib/mcp.mjs foreignMcpEntries)
const json = (root, rel) => JSON.parse(readFileSync(path.join(root, rel), "utf8"));
const SERVER = { command: "npx", args: ["-y", "@acme/mcp-jira"] };
const OVERLAY_HINT = "add it under 'servers:' in atf/mcp.yaml (an overlay: its servers merge into the framework's, server by server), then run npx atf sync";

test("installed: an MCP server the client added by hand fails build and check, naming the file, the server and atf/mcp.yaml; nothing is written", () => {
  const { root, framework } = installedWorkspace();
  const mine = JSON.stringify({ mcpServers: { playwright: { command: "old" }, jira: SERVER } }, null, 2);
  put(root, ".mcp.json", mine);
  put(root, ".vscode/mcp.json", JSON.stringify({ servers: { jira: SERVER, docs: { url: "https://docs.acme.test/mcp" } } }));
  for (const check of [true, false]) {
    const { errors, changed } = build({ root, framework, check });
    assert.deepEqual(changed, []);
    assert.deepEqual(errors, [
      `.mcp.json: MCP server 'jira' is yours: mcp.yaml (the framework's, with your atf/ overrides) doesn't define it, so atf sync would drop it: ${OVERLAY_HINT}`,
      `.vscode/mcp.json: MCP server 'jira' is yours: mcp.yaml (the framework's, with your atf/ overrides) doesn't define it, so atf sync would drop it: ${OVERLAY_HINT}`,
      `.vscode/mcp.json: MCP server 'docs' is yours: mcp.yaml (the framework's, with your atf/ overrides) doesn't define it, so atf sync would drop it: ${OVERLAY_HINT}`,
    ]);
  }
  assert.equal(readFileSync(path.join(root, ".mcp.json"), "utf8"), mine, "untouched");
  for (const f of [".claude", ".github", ".agents"]) assert.equal(existsSync(path.join(root, f)), false, `${f}: nothing written`);
  // ejected: the overlay would be ignored, so the pointer names the ejected copy
  put(root, "atf/config/mcp.yaml", readFileSync(path.join(framework, "config", "mcp.yaml"), "utf8"));
  assert.match(build({ root, framework, check: true }).errors[0], /add it under 'servers:' in atf\/config\/mcp\.yaml \(your ejected copy\), then run npx atf sync$/);
});

test("installed: a server defined through the atf/mcp.yaml overlay renders beside the framework's, and build and check pass", () => {
  const { root, framework } = installedWorkspace();
  put(root, ".mcp.json", JSON.stringify({ mcpServers: { jira: SERVER } }));
  put(root, "atf/mcp.yaml", "servers:\n  jira:\n    command: npx\n    args: ['-y', '@acme/mcp-jira']\n");
  assert.deepEqual(build({ root, framework }).errors, []);
  for (const [rel, key] of [[".mcp.json", "mcpServers"], [".vscode/mcp.json", "servers"], [".agents/mcp_config.json", "mcpServers"]]) {
    const servers = json(root, rel)[key];
    assert.deepEqual(Object.keys(servers), ["playwright", "jira"], rel);
    assert.deepEqual(servers.jira, SERVER, rel);
    assert.ok(servers.playwright.args.includes("node_modules/@testagentic/atf/scripts/browser/init-page.cjs"), rel);
  }
  assert.deepEqual(build({ root, framework, check: true }), { errors: [], changed: [] });
  // the framework's own server changed by hand is ours: drift, rewritten by a build, never an error
  const vs = json(root, ".vscode/mcp.json");
  vs.servers.playwright.args.push("--headless");
  put(root, ".vscode/mcp.json", JSON.stringify(vs));
  assert.deepEqual(build({ root, framework, check: true }), { errors: [], changed: [".vscode/mcp.json"] });
});

test("installed: a top-level key the render doesn't produce (VS Code's inputs) fails with where to keep it; so does a file that isn't a JSON object", () => {
  const { root, framework } = installedWorkspace();
  const vs = { inputs: [{ type: "promptString", id: "jira-token", password: true }], servers: {} };
  put(root, ".vscode/mcp.json", JSON.stringify(vs));
  assert.deepEqual(build({ root, framework, check: true }).errors, [
    ".vscode/mcp.json: 'inputs' is not rendered from mcp.yaml (only its servers are), so atf sync would drop it: move it out of .vscode/mcp.json (atf sync renders the whole file), for example into your own user-level MCP configuration, then run npx atf sync",
  ]);
  // an overlay can't carry it: mcp.yaml renders only servers, so the error stands
  put(root, "atf/mcp.yaml", "inputs:\n  - { type: promptString, id: jira-token }\n");
  assert.equal(build({ root, framework }).errors.length, 1);
  assert.deepEqual(json(root, ".vscode/mcp.json"), vs, "untouched");
  rmSync(path.join(root, "atf", "mcp.yaml"));
  for (const [text, want] of [
    ["{ not json", /^\.vscode\/mcp\.json: not valid JSON \(.*\); atf sync renders this file whole from mcp\.yaml, so it can't tell which servers are yours: fix the JSON or remove the file, then run npx atf sync$/],
    ["[]", /^\.vscode\/mcp\.json: must be a JSON object with 'servers' \(atf sync renders it from mcp\.yaml\); fix it or remove the file, then run npx atf sync$/],
    ['{ "servers": [] }', /^\.vscode\/mcp\.json: 'servers' must be an object of servers; fix it or remove the file, then run npx atf sync$/],
  ]) {
    put(root, ".vscode/mcp.json", text);
    const { errors } = build({ root, framework });
    assert.equal(errors.length, 1, text);
    assert.match(errors[0], want);
    assert.equal(readFileSync(path.join(root, ".vscode/mcp.json"), "utf8"), text);
  }
  // only the framework's server, as a sync left it: no error
  rmSync(path.join(root, ".vscode/mcp.json"));
  assert.deepEqual(build({ root, framework }).errors, []);
  assert.deepEqual(build({ root, framework }), { errors: [], changed: [] });
});

test("a source checkout renders its MCP files whole, as before: every server there is ours (D-018)", () => {
  const root = scratch();
  put(root, ".mcp.json", JSON.stringify({ mcpServers: { jira: SERVER }, extra: true }));
  const checked = build({ root, check: true });
  assert.deepEqual(checked.errors, []);
  assert.ok(checked.changed.includes(".mcp.json"), "drift, not an error");
  assert.deepEqual(build({ root }).errors, []);
  assert.deepEqual(Object.keys(json(root, ".mcp.json")), ["mcpServers"]);
  assert.deepEqual(Object.keys(json(root, ".mcp.json").mcpServers), ["playwright"]);
});

// ---- .claude/settings.json: the build owns only the framework's own hook entries (lib/hook-registrations.mjs)
const CLIENT_PRE = { matcher: "Bash", hooks: [{ type: "command", command: "node scripts/hooks/pretooluse.mjs" }] }; // theirs: no --host claude-code
const CLIENT_POST = { matcher: "Edit|Write", hooks: [{ type: "command", command: "npx prettier --write \"$CLAUDE_FILE_PATHS\"" }] };
const CLIENT_STOP = { hooks: [{ type: "command", command: "say done" }] };
const settingsOf = (root) => json(root, ".claude/settings.json");
const frameworkCommands = (hooks) =>
  Object.entries(hooks).flatMap(([event, groups]) => groups.flatMap((g) => g.hooks.filter((h) => / --host claude-code$/.test(h.command)).map((h) => `${event}: ${h.command}`)));

test("installed: the client's own Claude hooks and settings survive build and check, after the framework's entries, in their order", () => {
  const { root, framework } = installedWorkspace();
  const mine = { permissions: { allow: ["Bash(ls:*)"] }, hooks: { Stop: [CLIENT_STOP], PreToolUse: [CLIENT_PRE], PostToolUse: [CLIENT_POST] }, model: "opus" };
  put(root, ".claude/settings.json", JSON.stringify(mine));
  assert.deepEqual(build({ root, framework }).errors, []);
  const s = settingsOf(root);
  assert.deepEqual(Object.keys(s), ["permissions", "hooks", "model"], "the keys keep their order");
  assert.deepEqual(s.permissions, mine.permissions);
  assert.deepEqual(Object.keys(s.hooks), ["PreToolUse", "PostToolUse", "Stop"], "the framework's events first, then the client's");
  assert.equal(s.hooks.PreToolUse.length, 2);
  assert.match(s.hooks.PreToolUse[0].hooks[0].command, /node_modules\/@testagentic\/atf\/scripts\/hooks\/pretooluse\.mjs" --host claude-code$/);
  assert.deepEqual(s.hooks.PreToolUse[1], CLIENT_PRE, "a client's own scripts/hooks/pretooluse.mjs (no --host claude-code) is theirs");
  assert.match(s.hooks.PostToolUse[0].hooks[0].command, /posttooluse\.mjs" --host claude-code$/);
  assert.deepEqual(s.hooks.PostToolUse.slice(1), [CLIENT_POST]);
  assert.deepEqual(s.hooks.Stop, [CLIENT_STOP]);
  // stable: check is clean, and a second build writes nothing
  assert.deepEqual(build({ root, framework, check: true }), { errors: [], changed: [] });
  assert.deepEqual(build({ root, framework }), { errors: [], changed: [] });
  // the client edits, reformats and reorders their own: not drift, and the file is left as they wrote it
  s.hooks.Stop.push({ hooks: [{ type: "command", command: "say again" }] });
  const reformatted = JSON.stringify({ model: s.model, hooks: { Stop: s.hooks.Stop, PostToolUse: s.hooks.PostToolUse, PreToolUse: s.hooks.PreToolUse }, permissions: s.permissions }, null, 4);
  put(root, ".claude/settings.json", reformatted);
  assert.deepEqual(build({ root, framework, check: true }), { errors: [], changed: [] });
  assert.deepEqual(build({ root, framework }), { errors: [], changed: [] });
  assert.equal(readFileSync(path.join(root, ".claude/settings.json"), "utf8"), reformatted);
  // an edit of the framework's entry is drift, and a build restores only that entry
  const edited = JSON.parse(reformatted);
  edited.hooks.PreToolUse[0].matcher = "Bash";
  put(root, ".claude/settings.json", JSON.stringify(edited));
  assert.deepEqual(build({ root, framework, check: true }), { errors: [], changed: [".claude/settings.json"] });
  assert.deepEqual(build({ root, framework }).changed, [".claude/settings.json"]);
  const restored = settingsOf(root);
  assert.notEqual(restored.hooks.PreToolUse[0].matcher, "Bash");
  assert.deepEqual(restored.hooks.PreToolUse.slice(1), [CLIENT_PRE]);
  assert.deepEqual(restored.hooks.Stop, s.hooks.Stop);
});

test("an older framework's hook entries (another {fw}, the pre-move path, the old prefix, a shared group) are replaced, never duplicated", () => {
  const { root, framework } = installedWorkspace();
  const old = (entry, p) => ({ type: "command", command: `node "${p}/scripts/hooks/${entry}.mjs" --host claude-code` });
  put(root, ".claude/settings.json", JSON.stringify({
    hooks: {
      PreToolUse: [
        { matcher: "Bash|Write", hooks: [old("pretooluse", "${CLAUDE_PROJECT_DIR:-.}")] },
        CLIENT_PRE,
        { matcher: "Bash", hooks: [{ type: "command", command: "node \"${CLAUDE_PROJECT_DIR:+$CLAUDE_PROJECT_DIR/}node_modules/@testagentic/atf-old/scripts/hooks/pretooluse.mjs\" --host claude-code" }] },
      ],
      // a client hook added inside the framework's own group: theirs stays, in a group of its own
      PostToolUse: [{ matcher: "Edit", hooks: [{ type: "command", async: true, command: "node scripts\\hooks\\posttooluse.mjs --host claude-code" }, CLIENT_POST.hooks[0]] }],
      // a framework entry in another event is ours too; the event goes once nothing of the client's is left
      Notification: [{ hooks: [old("posttooluse", "$CLAUDE_PROJECT_DIR")] }],
    },
  }));
  assert.deepEqual(build({ root, framework }).errors, []);
  const { hooks } = settingsOf(root);
  const fwPath = 'node "${CLAUDE_PROJECT_DIR:+$CLAUDE_PROJECT_DIR/}node_modules/@testagentic/atf/scripts/hooks/';
  assert.deepEqual(frameworkCommands(hooks), [`PreToolUse: ${fwPath}pretooluse.mjs" --host claude-code`, `PostToolUse: ${fwPath}posttooluse.mjs" --host claude-code`]);
  assert.deepEqual(hooks.PreToolUse.slice(1), [CLIENT_PRE]);
  assert.deepEqual(hooks.PostToolUse.slice(1), [{ matcher: "Edit", hooks: [CLIENT_POST.hooks[0]] }]);
  assert.deepEqual(Object.keys(hooks), ["PreToolUse", "PostToolUse"]);
  assert.deepEqual(build({ root, framework, check: true }), { errors: [], changed: [] });
});

test("the PreToolUse guard is always registered first, whatever the client's hooks hold; off drops only the framework's PostToolUse", () => {
  const { root, framework } = installedWorkspace();
  put(root, "atf/hooks.yaml", "post_tool_use: off\n");
  for (const hooks of [{}, { PreToolUse: [] }, { PreToolUse: [CLIENT_PRE] }, { PostToolUse: [CLIENT_POST] }]) {
    put(root, ".claude/settings.json", JSON.stringify({ hooks }));
    assert.deepEqual(build({ root, framework }).errors, [], JSON.stringify(hooks));
    const got = settingsOf(root).hooks;
    assert.match(got.PreToolUse[0].hooks[0].command, /scripts\/hooks\/pretooluse\.mjs" --host claude-code$/, JSON.stringify(hooks));
    assert.equal(got.PreToolUse[0].hooks[0].async, undefined, "the guard always blocks");
    assert.deepEqual(got.PreToolUse.slice(1), hooks.PreToolUse ?? []);
    assert.deepEqual(got.PostToolUse, hooks.PostToolUse, "off: the client's PostToolUse stays, the framework's is not registered");
  }
});

test("a malformed hooks key, or settings that aren't a JSON object, is an error naming .claude/settings.json; nothing is written", () => {
  const { root, framework } = installedWorkspace();
  for (const [settings, want] of [
    [{ hooks: [] }, "'hooks' must be an object (event -> list of matcher groups), not a list"],
    [{ hooks: "none" }, "'hooks' must be an object (event -> list of matcher groups), not a string"],
    [{ hooks: { PreToolUse: { matcher: "Bash" } } }, "hooks.PreToolUse must be a list of matcher groups, not an object"],
    [{ hooks: { Stop: [CLIENT_STOP, "say"] } }, "hooks.Stop[1] must be an object with a 'hooks' list, not a string"],
    [{ hooks: { PreToolUse: [{ matcher: "Bash", command: "x" }] } }, "hooks.PreToolUse[0] must be an object with a 'hooks' list, not an object"],
    [[], "must be a JSON object, not a list"],
  ]) {
    const text = JSON.stringify(settings);
    put(root, ".claude/settings.json", text);
    for (const check of [true, false]) assert.deepEqual(build({ root, framework, check }), { errors: [`.claude/settings.json: ${want}; fix it, nothing was written`], changed: [] }, text);
    assert.equal(readFileSync(path.join(root, ".claude/settings.json"), "utf8"), text);
    assert.equal(existsSync(path.join(root, ".mcp.json")), false, "nothing else written either");
  }
  put(root, ".claude/settings.json", "{ not json");
  assert.match(build({ root, framework }).errors[0], /^\.claude\/settings\.json: /);
});

test("a source checkout's settings: the same merge, and its output byte for byte what the framework-only file was", () => {
  // this repo's committed file holds only the framework's entries: --check leaves it exactly as it is
  const committed = readFileSync(path.join(workspaceRoot, ".claude", "settings.json"), "utf8");
  const fw = frameworkRel(workspaceRoot, frameworkRoot);
  assert.equal(renderHookRegistrations("async", committed, fw).get(".claude/settings.json"), committed);
  // and the whole-key render of before (no file, or a file with no hooks) is still what a merge produces
  for (const mode of ["async", "sync", "off"]) {
    const fresh = renderHookRegistrations(mode, undefined, fw).get(".claude/settings.json");
    assert.equal(renderHookRegistrations(mode, fresh, fw).get(".claude/settings.json"), fresh, mode);
    assert.equal(renderHookRegistrations(mode, "{}", fw).get(".claude/settings.json"), fresh, mode);
    assert.equal(renderHookRegistrations(mode, "", fw).get(".claude/settings.json"), fresh, mode);
  }
  // a switch of mode rewrites only the framework's entries, in the source checkout too
  const root = scratch();
  put(root, ".claude/settings.json", JSON.stringify({ hooks: { Stop: [CLIENT_STOP] } }));
  assert.deepEqual(build({ root, postHook: "sync" }).errors, []);
  assert.deepEqual(build({ root, postHook: "off" }).errors, []);
  assert.deepEqual(settingsOf(root).hooks.Stop, [CLIENT_STOP]);
  assert.deepEqual(Object.keys(settingsOf(root).hooks), ["PreToolUse", "Stop"]);
});

// ---- dev-only agents (docs/packaging.md §3.8): a source checkout's workspace renders agents the package never ships ----
// The framework is a scratch source checkout; the workspace names its dev folder in atf/atf.json and gives each dev
// agent its row in atf/permissions.yaml, as the monorepo does.
const DEV = "dev-probe";
const DEV_ROW = { layer: 1, spawns: [], shell: "project", filesystem: { read: ["feedback/**"], write: ["feedback/**"] } };
const devSource = (name = DEV, body = "Maintain the framework from feedback files.\n") => `---\nname: ${name}\ndescription: A dev-only maintainer.\nuser_invocable: true\n---\n\n${body}`;
function devPair({ framework = scratch(), atf = { dev_agents: "dev/agents" }, rows = { [DEV]: DEV_ROW }, sources = { [DEV]: devSource() } } = {}) {
  const ws = mkdtempSync(path.join(tmpdir(), "atf-dev-"));
  put(ws, "atf/atf.json", JSON.stringify(atf));
  if (rows) put(ws, "atf/permissions.yaml", yaml.dump({ agents: rows }));
  mkdirSync(path.join(ws, "dev", "agents"), { recursive: true });
  for (const [name, text] of Object.entries(sources)) put(ws, `dev/agents/${name}.md`, text);
  return { framework, ws, run: (opts = {}) => build({ root: ws, framework, ...opts }) };
}

test("a dev agent is rendered from the folder atf.json names, in every platform's file, with its own source in the note", () => {
  const { framework, ws, run } = devPair();
  assert.ok(!isInstalled(framework));
  assert.deepEqual(run().errors, []);
  const fw = frameworkRel(ws, framework);
  for (const rel of OUTS(DEV)) {
    const text = readFileSync(path.join(ws, rel), "utf8");
    assert.equal(noteOf(ws, rel), `# GENERATED from dev/agents/${DEV}.md by ${fw}/scripts/build-agents.mjs -- edit the source, then run npm run build-agents.`, rel);
    assert.ok(isGenerated(text), rel);
    assert.equal(rel.endsWith(".toml") ? tomlName(text) : splitFrontmatter(text, rel).meta.name, DEV);
    assert.match(text, /Maintain the framework from feedback files\./);
  }
  // its tools come from its row like any agent's; the framework's agents are rendered beside it, unchanged
  assert.equal(generatedNote("pw-ui-fixer", fw), noteOf(ws, OUTS("pw-ui-fixer")[0]));
  assert.ok(splitFrontmatter(readFileSync(path.join(ws, OUTS(DEV)[0]), "utf8"), "x").meta.tools.includes("Write"));
  assert.deepEqual(run({ check: true }), { errors: [], changed: [] });
  // its files are ordinary generated files: a hand edit is drift, and once the source goes they are stray
  writeFileSync(path.join(ws, OUTS(DEV)[0]), readFileSync(path.join(ws, OUTS(DEV)[0]), "utf8") + "x");
  assert.deepEqual(run({ check: true }).changed, [OUTS(DEV)[0]]);
  rmSync(path.join(ws, "dev", "agents", `${DEV}.md`));
  rmSync(path.join(ws, "atf", "permissions.yaml"));
  assert.ok(run({ check: true }).errors.some((e) => new RegExp(`${DEV}\\.md: not generated from agents/ or dev/agents/`).test(e)));
});

test("a dev agent's includes come from the framework's agents/_shared/, and it gets the same lint, its errors naming its source", () => {
  const framework = scratch();
  withInclude(framework);
  const { ws, run } = devPair({ framework, sources: { [DEV]: devSource(DEV, "Intro.\n\n<!-- include: _shared/probe.md -->\n") } });
  assert.deepEqual(run().errors, []);
  for (const rel of OUTS(DEV)) assert.match(readFileSync(path.join(ws, rel), "utf8"), /Intro\.\n\nShared fixer rule: report, do not guess\.\n/);
  put(ws, `dev/agents/${DEV}.md`, devSource(DEV, "<!-- include: _shared/nope.md -->\n"));
  assert.ok(run({ check: true }).errors.some((e) => e.startsWith(`dev/agents/${DEV}.md: include '_shared/nope.md' names no file`)));
  put(ws, `dev/agents/${DEV}.md`, devSource(DEV, "Use AskUserQuestion when unsure.\n"));
  assert.ok(run({ check: true }).errors.some((e) => e.startsWith(`dev/agents/${DEV}.md: body names platform-specific 'AskUserQuestion'`)));
  put(ws, `dev/agents/${DEV}.md`, devSource(DEV, "Run node {fw}scripts/run.mjs.\n"));
  assert.ok(run({ check: true }).errors.some((e) => e.startsWith(`dev/agents/${DEV}.md: '{fw}s'`)));
  put(ws, `dev/agents/${DEV}.md`, devSource("someone-else", "x\n"));
  assert.ok(run({ check: true }).errors.some((e) => e === `dev/agents/${DEV}.md: frontmatter name must be '${DEV}'`));
  // its source is the workspace's own: an add-on fragment for it is refused like one for an unknown agent
  put(ws, `dev/agents/${DEV}.md`, devSource());
  put(ws, `atf/agents/${DEV}.extra.md`, "More.\n");
  assert.ok(run({ check: true }).errors.some((e) => e === `atf/agents/${DEV}.extra.md: the framework has no agent '${DEV}' to add to`));
});

test("a dev agent with a framework agent's name (in any case) or without a permissions row fails, named; so does a row with no source", () => {
  const read = (ws) => (existsSync(path.join(ws, ".claude", "agents")) ? readdirSync(path.join(ws, ".claude", "agents")) : []);
  const clash = devPair({ sources: { [DEV]: devSource(), "pw-ui-fixer": devSource("pw-ui-fixer") } });
  const r = clash.run();
  assert.ok(r.errors.includes("dev/agents/pw-ui-fixer.md: 'pw-ui-fixer' is the name of a framework agent (agents/pw-ui-fixer.md); give the dev agent a name of its own"), r.errors.join("\n"));
  assert.deepEqual(r.changed, []);
  assert.deepEqual(read(clash.ws), [], "nothing is written on error");
  const cased = devPair({ sources: { "Testcase-Writer": devSource("Testcase-Writer") }, rows: { "Testcase-Writer": DEV_ROW } });
  assert.ok(cased.run({ check: true }).errors.some((e) => e.startsWith("dev/agents/Testcase-Writer.md: 'Testcase-Writer' is the name of a framework agent (agents/testcase-writer.md)")));
  const unlisted = devPair({ rows: null });
  assert.deepEqual(unlisted.run().errors, [`dev/agents/${DEV}.md: no permissions row for '${DEV}' in the effective permissions.yaml; add one under agents: in atf/permissions.yaml`]);
  assert.deepEqual(read(unlisted.ws), []);
  const orphan = devPair({ rows: { [DEV]: DEV_ROW, "dev-ghost": DEV_ROW } });
  assert.ok(orphan.run({ check: true }).errors.includes("agents/dev-ghost.md: missing (nor in dev/agents/)"));
});

test("dev_agents must name an existing folder inside the workspace and outside the framework; otherwise the build fails naming atf/atf.json", () => {
  const key = 'atf/atf.json "dev_agents"';
  const errorFor = (value, setup) => {
    const { ws, run } = devPair({ atf: { dev_agents: value } });
    setup?.(ws);
    const r = run();
    assert.deepEqual(r.changed, [], JSON.stringify(value));
    assert.equal(r.errors.length, 1, `${JSON.stringify(value)}: ${r.errors.join("; ")}`);
    return r.errors[0];
  };
  for (const v of ["../outside", "dev/../../outside", "/etc", "C:\\agents", "C:agents", "\\\\server\\share\\agents", ".", "dev/.."])
    assert.equal(errorFor(v), `${key} (${v}) must name a folder inside the workspace, relative to it`, v);
  for (const v of [true, "", "  ", ["dev/agents"]]) assert.equal(errorFor(v), `${key} must be a workspace-relative folder, not ${JSON.stringify(v)}`);
  assert.equal(errorFor("dev/nope"), `${key} (dev/nope) names no folder`);
  assert.equal(errorFor("dev/agents/x.md", (ws) => put(ws, "dev/agents/x.md", "x")), `${key} (dev/agents/x.md) names no folder`);
  // a link that leaves the workspace is outside it too
  const outside = mkdtempSync(path.join(tmpdir(), "atf-out-"));
  assert.match(errorFor("linked", (ws) => symlinkSync(outside, path.join(ws, "linked"), "junction")), /^atf\/atf\.json "dev_agents" \(linked\) must name a folder inside the workspace/);
  // the monorepo's shape, the framework inside the workspace: a folder in it would ship with the package
  const ws = mkdtempSync(path.join(tmpdir(), "atf-mono-"));
  for (const d of ["config", "agents"]) cpSync(path.join(frameworkRoot, d), path.join(ws, "packages", "core", d), { recursive: true });
  put(ws, "atf/atf.json", JSON.stringify({ dev_agents: "packages/core/agents" }));
  assert.deepEqual(build({ root: ws, framework: path.join(ws, "packages", "core") }).errors, [`${key} (packages/core/agents) is inside the framework (packages/core), which the package ships; keep dev-only agents outside it`]);
  // and an unreadable atf.json is an error too, not a build without the dev agents
  const broken = devPair();
  put(broken.ws, "atf/atf.json", "{ nope");
  assert.match(broken.run({ check: true }).errors[0], /^atf\/atf\.json could not be read as JSON/);
});

test("installed: dev_agents is refused, naming atf/atf.json, and nothing is written; without the key nothing changes", () => {
  const { root, framework } = installedWorkspace();
  assert.ok(isInstalled(framework));
  assert.deepEqual(build({ root, framework }).errors, []);
  const before = readdirSync(path.join(root, ".claude", "agents")).sort();
  put(root, "atf/atf.json", JSON.stringify({ dev_agents: "dev/agents" }));
  put(root, `dev/agents/${DEV}.md`, devSource());
  put(root, "atf/permissions.yaml", yaml.dump({ agents: { [DEV]: DEV_ROW } }));
  const r = build({ root, framework });
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /^atf\/atf\.json "dev_agents": dev-only agents belong to the framework's own source checkout/);
  assert.deepEqual(r.changed, []);
  assert.deepEqual(readdirSync(path.join(root, ".claude", "agents")).sort(), before);
  // a dev folder nobody names is just a folder; the overlay row without a source is the usual error
  put(root, "atf/atf.json", "{}");
  assert.ok(build({ root, framework, check: true }).errors.includes(`agents/${DEV}.md: missing`));
});

test("this repository's own workspace renders its dev agents from its real atf/ config, beside the framework's", { skip: !devAgentsDir(workspaceRoot, frameworkRoot).dir && "no dev_agents in this workspace" }, () => {
  // a temp workspace with the real atf/ and dev folder, against the real framework (a source checkout): the files a
  // build writes there are what the committed ones must be
  const dev = devAgentsDir(workspaceRoot, frameworkRoot);
  const names = readdirSync(dev.dir).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3));
  assert.ok(names.length > 0);
  const ws = mkdtempSync(path.join(tmpdir(), "atf-repo-"));
  cpSync(path.join(workspaceRoot, "atf"), path.join(ws, "atf"), { recursive: true });
  cpSync(dev.dir, path.join(ws, dev.rel), { recursive: true });
  const { errors, changed } = build({ root: ws, framework: frameworkRoot, check: true });
  assert.deepEqual(errors, []);
  for (const name of names) for (const rel of OUTS(name)) assert.ok(changed.includes(rel), `${rel} would be written`);
  assert.ok(OUTS("orchestrator-agent").every((rel) => changed.includes(rel)), "the framework's agents too");
  // the package never sees them: no dev agent is among the framework's own sources
  for (const name of names) assert.ok(!existsSync(path.join(frameworkRoot, "agents", `${name}.md`)), name);
});
