// Host adapters, the per-host rules (full-run cap, unknown tools, liveness canary) and the hook entry end to end.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { checkTool } from "./lib/guard.mjs";
import { guardStatus, markAbsent, recordCanary } from "./lib/guard-check.mjs";
import { repoRoot } from "./lib/contract.mjs";
import { initRun, setStage } from "./run.mjs";
import * as claude from "./hooks/hosts/claude.mjs";
import * as copilot from "./hooks/hosts/copilot.mjs";
import { startRun, tempRoot, writeConfig } from "./test-helpers.mjs";

const FULL = startRun({ mode: "full-run" });
const cli = (payload) => copilot.normalize(payload, { env: {}, host: "copilot" });
const vscode = (agent, payload) => copilot.normalize(payload, { env: {}, host: "vscode", agent });
const allowed = (root, c) => checkTool(c, root, {}).allowed;

test("the Copilot adapter reads both payload casings and every host's tool names", () => {
  assert.deepEqual(
    [cli({ tool_name: "Bash", tool_input: { command: "ls" } }), cli({ toolName: "bash", toolArgs: '{"command":"ls"}' })].map((c) => [c.kind, c.command, c.host]),
    [["shell", "ls", "copilot-cli"], ["shell", "ls", "copilot-cli"]]
  );
  assert.equal(copilot.normalize({ toolName: "bash", toolArgs: {} }, { env: { GITHUB_ACTIONS: "true" }, host: "copilot" }).host, "copilot-cloud");
  assert.equal(copilot.normalize({ toolName: "bash", toolArgs: {} }, { env: { GITHUB_COPILOT_INTEGRATION_ID: "vscode-chat" }, host: "copilot" }).host, "vscode-agent-host");
  assert.deepEqual(vscode("x", { tool_name: "create_file", tool_input: { filePath: "/r/a.md" } }).paths, ["/r/a.md"]);
  assert.deepEqual(vscode("x", { tool_name: "multi_replace_string_in_file", tool_input: { replacements: [{ filePath: "a" }, { filePath: "b" }] } }).paths, ["a", "b"]);
  assert.deepEqual(vscode("x", { tool_name: "apply_patch", tool_input: { input: "*** Begin Patch\n*** Update File: /r/x.ts\n@@\n*** Add File: /r/y.ts\n" } }).paths, ["/r/x.ts", "/r/y.ts"]);
  assert.deepEqual(vscode("x", { tool_name: "fetch_webpage", tool_input: { urls: ["https://a.test", "https://b.test"] } }).urls, ["https://a.test", "https://b.test"]);
  assert.equal(vscode("x", { tool_name: "runSubagent", tool_input: { agentName: "pw-ui-healer" } }).subagent, "pw-ui-healer");
  const b = vscode("x", { tool_name: "mcp_playwright_browser_type", tool_input: {} });
  assert.deepEqual([b.kind, b.browserAction], ["browser", "type"]);
  assert.equal(vscode("x", { tool_name: "brand_new_tool", tool_input: {} }).kind, "unknown");
});

test("identity comes only from a trusted source: Copilot payloads cannot name the agent; Claude's must be Claude's", () => {
  assert.equal(cli({ tool_name: "Bash", tool_input: {}, agent_type: "orchestrator-agent" }).agent, undefined);
  assert.equal(vscode("pw-ui-healer", { tool_name: "read_file", tool_input: {} }).agent, "pw-ui-healer");
  const viaCli = claude.normalize({ tool_name: "Bash", tool_input: {}, agent_type: "orchestrator-agent" }, { env: {}, host: "claude-code" });
  assert.deepEqual([viaCli.host, viaCli.agent], ["unknown", undefined], "Copilot CLI reading .claude/settings.json is not Claude Code");
});

test("full-run is capped to readonly on hosts that cannot identify the calling agent", () => {
  const post = "curl -X POST https://app.acme.test/api/contacts -d '{}'";
  assert.equal(allowed(FULL.root, cli({ tool_name: "Bash", tool_input: { command: post } })), false);
  assert.match(checkTool(cli({ tool_name: "Bash", tool_input: { command: post } }), FULL.root, {}).reason, /full-run is not honoured on Copilot CLI/);
  assert.equal(allowed(FULL.root, vscode("pw-api-test-runner-triager", { tool_name: "run_in_terminal", tool_input: { command: post } })), true);
  assert.equal(allowed(FULL.root, vscode("pw-api-tests-writer", { tool_name: "run_in_terminal", tool_input: { command: post } })), false, "per-agent rules on VS Code");
  assert.equal(allowed(FULL.root, vscode(undefined, { tool_name: "run_in_terminal", tool_input: { command: post } })), true, "VS Code unmanaged: mode rules, as on Claude Code");
});

test("VS Code chat on its Copilot CLI engine is recognised and treated like Copilot CLI", () => {
  const env = { GITHUB_COPILOT_INTEGRATION_ID: "vscode-chat" };
  const engine = (payload) => copilot.normalize(payload, { env, host: "copilot" });
  const post = engine({ tool_name: "bash", tool_input: { command: "curl -X POST https://app.acme.test/api/contacts -d '{}'" }, agent_type: "orchestrator-agent" });
  assert.equal(post.agent, undefined, "its payload cannot name the agent");
  assert.match(checkTool(post, FULL.root, {}).reason, /full-run is not honoured on VS Code chat on its Copilot CLI engine/);

  const { root: r2 } = startRun({ mode: "full-run", verified: false });
  recordCanary("acme", r2, { host: "vscode-agent-host" });
  assert.match(guardStatus("acme", "full-run", r2).reason, /VS Code's local agent, not its Copilot CLI engine\); the guard was verified only on: VS Code chat on its Copilot CLI engine\./);
  assert.equal(guardStatus("acme", "readonly", r2).ready, true);
});

test("per-agent rules apply on VS Code through the agent's own hook", () => {
  const w = (agent, rel) => allowed(FULL.root, vscode(agent, { tool_name: "create_file", tool_input: { filePath: path.join(FULL.root, rel) } }));
  assert.equal(w("pw-ui-pom-writer", "playwright-tests/acme/pages/contacts.page.ts"), true);
  assert.equal(w("pw-ui-pom-writer", "config/permissions.yaml"), false);
  assert.equal(allowed(FULL.root, vscode("pw-ui-healer", { tool_name: "runSubagent", tool_input: { agentName: "pw-ui-reviewer" } })), false);
  assert.equal(allowed(FULL.root, vscode("pw-ui-reviewer", { tool_name: "mcp_playwright_browser_navigate", tool_input: {} })), false);
});

test("an unmapped tool fails closed for a managed agent during a run, and only then", () => {
  const unknown = (agent) => vscode(agent, { tool_name: "brand_new_tool", tool_input: {} });
  assert.equal(checkTool(unknown("pw-ui-healer"), FULL.root, {}).rule, "unmapped-tool");
  assert.equal(allowed(FULL.root, unknown(undefined)), true);
  assert.equal(allowed(tempRoot(), unknown("pw-ui-healer")), true, "no active run");
  const noPath = vscode("pw-ui-healer", { tool_name: "create_file", tool_input: {} });
  assert.equal(checkTool(noPath, FULL.root, {}).rule, "fs-write", "a write whose target is unknown is refused");
});

test("liveness canary: always blocked; the session is verified per mode; init and resume reset it", () => {
  const { root } = startRun({ mode: "full-run", verified: false });
  const canary = claude.normalize({ tool_name: "Bash", tool_input: { command: "node scripts/run.mjs guard-check acme" } }, { env: { CLAUDE_PROJECT_DIR: root }, host: "claude-code" });
  assert.deepEqual([checkTool(canary, root, {}).rule, checkTool(canary, root, {}).canary], ["canary", { product: "acme" }]);
  const shell = (command) => checkTool(cli({ tool_name: "bash", tool_input: { command } }), root, {});
  for (const c of [`cd ${root} && node scripts/run.mjs guard-check acme`, `node ${root}/scripts/run.mjs guard-check acme 2>&1`, "true; node scripts/run.mjs guard-check acme"])
    assert.deepEqual(shell(c).canary, { product: "acme" }, `as agents actually write it: ${c}`);
  assert.equal(shell("echo node scripts/run.mjs guard-check acme").canary, undefined, "only as a command, not as an argument");
  assert.equal(shell("node scripts/run.mjs guard-check acme-x").canary.product, "acme-x");
  assert.equal(guardStatus("acme", "full-run", root).ready, false);
  recordCanary("acme", root, { host: "copilot-cli" });
  assert.match(guardStatus("acme", "full-run", root).reason, /verified only on: Copilot CLI/);
  assert.equal(guardStatus("acme", "readonly", root).ready, true);
  recordCanary("acme", root, { host: "vscode" });
  assert.equal(guardStatus("acme", "full-run", root).ready, false, "VS Code without the agent's own hook proves nothing about identity");
  recordCanary("acme", root, { host: "vscode", agent: "orchestrator-agent" });
  assert.equal(guardStatus("acme", "full-run", root).ready, true);
  markAbsent("acme", root);
  assert.equal(guardStatus("acme", "readonly", root).ready, false, "a session where the canary ran is never verified");
  recordCanary("acme", root, { host: "claude-code" });
  assert.equal(guardStatus("acme", "full-run", root).ready, true, "a later block clears the absent record");
  initRun(path.join(root, "config", "acme.yaml"), { root, resume: true, env: {} });
  assert.equal(guardStatus("acme", "readonly", root).ready, false, "resume starts unverified");
});

test("a stage cannot start until the session's guard is verified", async () => {
  const { root } = startRun({ verified: false });
  const r = await setStage("acme", "knowledge", undefined, "start", undefined, { root });
  assert.match(r.errors[0], /guard not verified/);
  recordCanary("acme", root, { host: "copilot-cli" });
  assert.equal((await setStage("acme", "knowledge", undefined, "start", undefined, { root })).errors, undefined, "readonly: any working hook");
});

test("run.mjs init refuses full-run on a host that cannot identify agents, and warns on an unknown host", () => {
  const root = tempRoot();
  const cfg = writeConfig(root, { mode: "full-run" });
  assert.match(initRun(cfg, { root, env: { GITHUB_ACTIONS: "true" } }).errors[0], /not available on Copilot cloud coding agent/);
  const r = initRun(cfg, { root, env: {} });
  assert.equal(r.run.startedOnHost, "unknown");
  assert.match(r.warnings[0], /could not recognize the host/);
});

// ---- the hook entry, as each host runs it ----------------------------------------------------------------------
const hook = (args, payload, env = {}) =>
  spawnSync(process.execPath, [path.join(repoRoot, "scripts", "hooks", "pretooluse.mjs"), ...args], { input: typeof payload === "string" ? payload : JSON.stringify(payload), encoding: "utf8", env: { PATH: process.env.PATH, ...env } });

test("hook entry: Claude Code blocks with exit 2 and records the canary", () => {
  const r = hook(["--host", "claude-code"], { tool_name: "Bash", tool_input: { command: "curl -X POST https://x/api" } }, { CLAUDE_PROJECT_DIR: FULL.root, AUTHORIZATIONS_MODE: "readonly" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /http-mutate/);
  const { root } = startRun({ verified: false });
  const c = hook(["--host", "claude-code"], { agent_type: "orchestrator-agent", tool_name: "Bash", tool_input: { command: "node scripts/run.mjs guard-check acme" } }, { CLAUDE_PROJECT_DIR: root });
  assert.equal(c.status, 2);
  assert.deepEqual(readdirSync(path.join(root, "artifacts/acme/state/guard-check")), ["claude-code--orchestrator-agent.json"]);
});

test("hook entry: Copilot gets a deny decision on stdout and exit 2", () => {
  const r = hook(["--host", "vscode", "--agent", "pw-ui-pom-writer"], { cwd: FULL.root, tool_name: "create_file", tool_input: { filePath: path.join(FULL.root, "config/permissions.yaml") } });
  assert.equal(r.status, 2);
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, "deny");
});

test("hook entry fails closed on garbage while a run is active, and stays out of the way otherwise", () => {
  const idle = spawnSync(process.execPath, [path.join(repoRoot, "scripts", "hooks", "pretooluse.mjs"), "--host", "copilot"], { input: "not json", cwd: tempRoot(), encoding: "utf8", env: { PATH: process.env.PATH } });
  assert.equal(idle.status, 0, "no run: cwd has no artifacts/ lock");
  const r = spawnSync(process.execPath, [path.join(repoRoot, "scripts", "hooks", "pretooluse.mjs"), "--host", "copilot"], { input: "not json", cwd: FULL.root, encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /failing closed/);
  assert.equal(hook(["--host", "nonsense"], { cwd: FULL.root, tool_name: "Bash", tool_input: {} }, { CLAUDE_PROJECT_DIR: FULL.root }).status, 2);
});

test("hook registrations: every host runs the same entry with a valid --host", () => {
  const settings = JSON.parse(readFileSync(path.join(repoRoot, ".claude", "settings.json"), "utf8"));
  const commands = [
    ...Object.values(settings.hooks).flatMap((xs) => xs.flatMap((x) => x.hooks.map((h) => h.command))),
    ...[".github/hooks/framework-guard.json", ".vscode/hooks/framework-guard.json"].flatMap((f) =>
      Object.values(JSON.parse(readFileSync(path.join(repoRoot, f), "utf8")).hooks).flatMap((xs) => xs.map((h) => h.command))
    ),
  ];
  assert.ok(commands.length >= 6);
  for (const c of commands) assert.match(c, /scripts\/hooks\/(pre|post)tooluse\.mjs"? --host (claude-code|vscode|copilot)$/, c);
  assert.ok(!existsSync(path.join(repoRoot, ".claude", "hooks")), "the old Claude-only hook is gone");
});
