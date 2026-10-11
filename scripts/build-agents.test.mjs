// The single-source agent build: one neutral source per agent -> one generated file per platform, tools derived from
// config/permissions.yaml only, platform syntax only from config/platforms.yaml.
import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

test("a source may not carry platform syntax: generated keys and platform tool names are rejected", () => {
  const root = scratch();
  const file = path.join(root, "agents", "question-writer.md");
  const text = readFileSync(file, "utf8");
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
  writeFileSync(path.join(clean, ".claude", "agents", "hand-made.md"), "---\nname: hand-made\n---\n");
  assert.ok(build({ check: true, root: clean }).errors.some((e) => /hand-made\.md: not generated from agents\//.test(e)));
});

test("a hand edit of a generated file is drift", () => {
  const root = scratch();
  build({ root });
  const rel = ".claude/agents/pw-ui-healer.md";
  writeFileSync(path.join(root, rel), readFileSync(path.join(root, rel), "utf8").replace("tools: ", "tools: WebSearch, "));
  assert.deepEqual(build({ check: true, root }).changed, [rel]);
});

test("MCP servers are defined once and rendered for each platform", () => {
  const claude = JSON.parse(readFileSync(path.join(repoRoot, ".mcp.json"), "utf8"));
  assert.deepEqual(claude.mcpServers, load("config/mcp.yaml").servers);
});
