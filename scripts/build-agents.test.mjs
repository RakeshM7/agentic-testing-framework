// The single-source agent build: one neutral source per agent -> one generated file per platform, tools derived from
// config/permissions.yaml only, platform syntax only from config/platforms.yaml.
import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { build } from "./build-agents.mjs";
import { capabilitiesFor, toolNames } from "./lib/agents/capabilities.mjs";
import { splitFrontmatter } from "./lib/agents/source.mjs";
import { repoRoot } from "./lib/contract.mjs";
import { resolvePermissions } from "./lib/permissions.mjs";

const load = (rel) => yaml.load(readFileSync(path.join(repoRoot, rel), "utf8"));
const perms = resolvePermissions(load("config/permissions.yaml")).resolved;
const { platforms } = load("config/platforms.yaml");
const { browser_server: server } = load("config/mcp.yaml");
const tools = (agent, platform) => toolNames(capabilitiesFor(perms.agents[agent]), platforms[platform], server);
const generated = (rel) => splitFrontmatter(readFileSync(path.join(repoRoot, rel), "utf8"), rel).meta;

// A throwaway repo root with the real config/ and agents/, so tests can break things safely.
function scratch() {
  const root = mkdtempSync(path.join(tmpdir(), "atf-build-"));
  for (const d of ["config", "agents"]) cpSync(path.join(repoRoot, d), path.join(root, d), { recursive: true });
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
  assert.ok(!tools("question-writer", "claude").includes("Write"));
});

test("Copilot tools are the same capabilities in Copilot's names", () => {
  assert.deepEqual(tools("question-writer", "copilot"), ["read", "search", "execute"]);
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
  const worker = generated(".github/agents/pw-ui-healer.agent.md");
  assert.equal(worker["user-invocable"], false);
  assert.equal(worker.agents, undefined);
  assert.equal(worker.hooks.PreToolUse[0].command, "node scripts/hooks/pretooluse.mjs --host vscode --agent pw-ui-healer");
  assert.equal(worker.color, undefined, "color is Claude-only");
  const claude = generated(".claude/agents/pw-ui-healer.md");
  assert.equal(claude.hooks, undefined, "Claude Code identifies agents from its own hook payload");
  for (const name of Object.keys(perms.agents)) assert.equal(generated(`.github/agents/${name}.agent.md`).name, name);
});

test("a source may not carry platform syntax: generated keys and platform tool names are rejected", () => {
  const root = scratch();
  const file = path.join(root, "agents", "question-writer.md");
  const text = readFileSync(file, "utf8").replaceAll("\r\n", "\n"); // core.autocrlf checkouts on Windows
  writeFileSync(file, text.replace("---\n\n", "---\n\nUse AskUserQuestion when unsure.\n"));
  assert.ok(build({ check: true, root }).errors.some((e) => /question-writer\.md: body names platform-specific 'AskUserQuestion'/.test(e)));
  writeFileSync(file, text.replace("name: question-writer\n", "name: question-writer\ntools: Read, Bash\n"));
  assert.ok(build({ check: true, root }).errors.some((e) => /'tools' does not belong in a source/.test(e)));
});

test("missing and stray sources and stray generated files are errors, and nothing is written on error", () => {
  const root = scratch();
  writeFileSync(path.join(root, "agents", "rogue.md"), "---\nname: rogue\ndescription: x\n---\n");
  rmSync(path.join(root, "agents", "question-writer.md"));
  const { errors, changed } = build({ root });
  assert.ok(errors.some((e) => /agents\/rogue\.md: not in config\/permissions\.yaml/.test(e)));
  assert.ok(errors.some((e) => /agents\/question-writer\.md: missing/.test(e)));
  assert.deepEqual(changed, []);

  const clean = scratch();
  assert.deepEqual(build({ root: clean }).errors, []);
  writeFileSync(path.join(clean, ".github", "agents", "hand-made.agent.md"), "---\nname: hand-made\n---\n");
  assert.ok(build({ check: true, root: clean }).errors.some((e) => /hand-made\.agent\.md: not generated from agents\//.test(e)));
});

test("a hand edit of a generated file is drift", () => {
  const root = scratch();
  build({ root });
  const rel = ".claude/agents/pw-ui-healer.md";
  writeFileSync(path.join(root, rel), readFileSync(path.join(root, rel), "utf8").replace("tools: ", "tools: WebSearch, "));
  assert.deepEqual(build({ check: true, root }).changed, [rel]);
});

test("a body over the Copilot prompt limit fails the build", () => {
  const root = scratch();
  const file = path.join(root, "agents", "question-writer.md");
  writeFileSync(file, readFileSync(file, "utf8") + "x".repeat(platforms.copilot.body_limit));
  assert.ok(build({ check: true, root }).errors.some((e) => /over the copilot limit/.test(e)));
});

test("MCP servers are defined once and rendered for each platform", () => {
  const claude = JSON.parse(readFileSync(path.join(repoRoot, ".mcp.json"), "utf8"));
  const vscode = JSON.parse(readFileSync(path.join(repoRoot, ".vscode", "mcp.json"), "utf8"));
  assert.deepEqual(claude.mcpServers, vscode.servers);
  assert.deepEqual(claude.mcpServers, load("config/mcp.yaml").servers);
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
