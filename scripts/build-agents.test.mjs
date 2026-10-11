import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import yaml from "js-yaml";
import { renderBody, renderAgent, lintOutput, buildAll } from "./build-agents.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = yaml.load(readFileSync(path.join(root, "agents", "manifest.yaml"), "utf8"));

test("standalone section markers keep only the active platform's lines", () => {
  const body = "a\n{{#claude}}\nclaude line\n{{/claude}}\n{{#copilot}}\ncopilot line\n{{/copilot}}\nb\n";
  assert.equal(renderBody(body, "claude", manifest), "a\nclaude line\nb\n");
  assert.equal(renderBody(body, "copilot", manifest), "a\ncopilot line\nb\n");
});
test("inline sections and tokens render per platform", () => {
  const body = "ask via {{v:ask_tool}}{{#copilot}} (main session){{/copilot}}; use `{{browser:browser_click}}`.";
  assert.equal(renderBody(body, "claude", manifest), "ask via `AskUserQuestion`; use `mcp__playwright-isolated__browser_click`.");
  assert.match(renderBody(body, "copilot", manifest), /vscode\/askQuestions.*\(main session\); use `playwright\/browser_click`\./);
});
test("rejects nested, unbalanced and unknown markers", () => {
  assert.throws(() => renderBody("{{#claude}}a{{#copilot}}b{{/copilot}}{{/claude}}", "claude", manifest), /nested/);
  assert.throws(() => renderBody("{{#claude}}a", "claude", manifest), /unbalanced/);
  assert.throws(() => renderBody("{{v:nope}}", "claude", manifest), /unknown vocab/);
  assert.throws(() => renderBody("{{other}}", "claude", manifest), /unknown token/);
});

const source = '---\nname: demo-agent\ndescription: "Demo."\n---\n\nBody.\n';
const models = { claude: "sonnet", copilot: ["Claude Sonnet 4.5", "GPT-5"] };
test("frontmatter per platform: tools, subagents, model", () => {
  const spec = { tools: ["ask", "agent", "read", "write", "search", "shell"], subagents: ["x-agent", "y-agent"], claude: { color: "cyan" } };
  const out = renderAgent({ name: "demo-agent", source, spec, models, manifest });
  assert.match(out.claude, /^tools: AskUserQuestion, Agent\(x-agent, y-agent\), Read, Write, Glob, Grep, Bash$/m);
  assert.match(out.claude, /^model: sonnet$/m);
  assert.match(out.claude, /^color: cyan$/m);
  assert.match(out.copilot, /^tools: \['vscode\/askQuestions', 'ask_user', 'agent', 'read', 'edit', 'search', 'execute'\]$/m);
  assert.match(out.copilot, /^agents: \[x-agent, y-agent\]$/m);
  assert.match(out.copilot, /^model: 'Claude Sonnet 4.5'$/m);
  assert.doesNotMatch(out.copilot, /color:/);
  for (const text of Object.values(out)) assert.match(text, /\n---\n<!-- GENERATED from agents\/src\/demo-agent\.md/);
});
test("sources may not carry platform frontmatter", () => {
  const bad = '---\nname: demo-agent\ndescription: "Demo."\nmodel: opus\n---\nBody.\n';
  assert.throws(() => renderAgent({ name: "demo-agent", source: bad, spec: { tools: ["read"] }, models, manifest }), /belongs in agents\/manifest\.yaml/);
});
test("leak lint flags the other platform's vocabulary in the body only", () => {
  const leaked = '---\nname: a\ntools: Agent(x)\n---\nUse AskUserQuestion here.\n';
  assert.equal(lintOutput("a", "copilot", leaked, manifest).length, 1);
  assert.deepEqual(lintOutput("a", "claude", '---\nname: a\ntools: Agent(x)\n---\nUse AskUserQuestion.\n', manifest), []);
});
test("the committed generated files are up to date and lint-clean", () => {
  const { files, errors } = buildAll(root);
  assert.deepEqual(errors, []);
  for (const [rel, content] of files) assert.equal(readFileSync(path.join(root, rel), "utf8"), content, `${rel} is stale -- run node scripts/build-agents.mjs`);
});
