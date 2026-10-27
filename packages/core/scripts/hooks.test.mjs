// Host adapters, the per-host rules (unidentified full-run calls, unknown tools, liveness canary) and the hook entry end to end.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { checkTool } from "./lib/guard.mjs";
import { frameworkHook, mergeClaudeHooks } from "./lib/hook-registrations.mjs";
import { guardStatus, markAbsent, recordCanary } from "./lib/guard-check.mjs";
import { logHookError } from "./lib/hook-log.mjs";
import { frameworkRoot, workspaceRoot } from "./lib/contract.mjs";
import { initRun, setStage, status } from "./run.mjs";
import * as claude from "./hooks/hosts/claude.mjs";
import { PLUGIN_MCP_PREFIX, PLUGIN_NAME } from "./lib/hosts.mjs";
import * as copilot from "./hooks/hosts/copilot.mjs";
import { startRun, tempRoot, writeConfig } from "./test-helpers.mjs";

const FULL = startRun({ mode: "full-run" });
const cli = (payload) => copilot.normalize(payload, { env: {}, host: "copilot" });
const vscode = (agent, payload) => copilot.normalize(payload, { env: {}, host: "vscode", agent });
const allowed = (root, c) => checkTool(c, root, {}, { framework: root }).allowed;

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
  assert.equal(vscode("x", { tool_name: "runSubagent", tool_input: { agentName: "pw-ui-fixer" } }).subagent, "pw-ui-fixer");
  const b = vscode("x", { tool_name: "mcp_playwright_browser_type", tool_input: {} });
  assert.deepEqual([b.kind, b.browserAction], ["browser", "type"]);
  assert.equal(vscode("x", { tool_name: "view_image", tool_input: { filePath: "/r/shot.png" } }).kind, "read");
  assert.equal(vscode("x", { tool_name: "brand_new_tool", tool_input: {} }).kind, "unknown");
});

test("identity comes only from a trusted source: Copilot payloads cannot name the agent; Claude's must be Claude's", () => {
  assert.equal(cli({ tool_name: "Bash", tool_input: {}, agent_type: "orchestrator-agent" }).agent, undefined);
  assert.equal(vscode("pw-ui-fixer", { tool_name: "read_file", tool_input: {} }).agent, "pw-ui-fixer");
  const viaCli = claude.normalize({ tool_name: "Bash", tool_input: {}, agent_type: "orchestrator-agent" }, { env: {}, host: "claude-code" });
  assert.deepEqual([viaCli.host, viaCli.agent], ["unknown", undefined], "Copilot CLI reading .claude/settings.json is not Claude Code");
});

// The framework's Claude Code plugin (packaging §3.12): its agents arrive as `atf:<name>` and its MCP tools as
// `mcp__plugin_atf_<server>__<tool>`. Record the strings a live session shows here (docs/claude-plugin-verification.md).
test("Claude Code plugin: atf:<name> is that framework agent; any other scoped agent_type is unattributed, never unmanaged", () => {
  assert.equal(PLUGIN_NAME, "atf");
  assert.equal(PLUGIN_MCP_PREFIX, "mcp__plugin_atf_");
  const env = { CLAUDE_PROJECT_DIR: FULL.root };
  const as = (agent_type, tool_name = "Bash", tool_input = {}) => claude.normalize({ agent_type, tool_name, tool_input }, { env, host: "claude-code" });
  const caller = (c) => [c.agent, c.unattributed];
  assert.deepEqual(caller(as("atf:pw-ui-fixer")), ["pw-ui-fixer", undefined]);
  assert.deepEqual(caller(as("atf:orchestrator-agent")), ["orchestrator-agent", undefined], "the main session started with --agent atf:orchestrator-agent");
  assert.ok(!("unattributed" in as("atf:pw-ui-fixer")), "the flag is absent unless set");
  for (const t of ["other:pw-ui-fixer", "atf:a:b", "atf:", ":x", ":", "atf::pw-ui-fixer", "ATF:pw-ui-fixer", "atf:PW-UI-FIXER", "atf: pw-ui-fixer", "atf:pw-ui-fixer ", "atf:pw--ui", "atf:-x", "atf:pw_ui", "atfx:pw-ui-fixer", "x:atf:pw-ui-fixer"])
    assert.deepEqual(caller(as(t)), [undefined, true], t);
  assert.deepEqual(caller(as(42)), [undefined, true], "not a string: unattributed");
  // bare names and no name behave as before
  assert.deepEqual(caller(as("pw-ui-fixer")), ["pw-ui-fixer", undefined]);
  assert.deepEqual(caller(as("general-purpose")), ["general-purpose", undefined]);
  for (const t of [undefined, null, ""]) assert.deepEqual(caller(as(t)), [undefined, undefined], `${t}: the main session`);
  // Copilot CLI reading .claude/settings.json is still not Claude Code, whatever agent_type says
  const viaCli = claude.normalize({ tool_name: "Bash", tool_input: {}, agent_type: "other:x" }, { env: {}, host: "claude-code" });
  assert.deepEqual([viaCli.host, viaCli.agent, viaCli.unattributed], ["unknown", undefined, undefined]);
  // a spawn of the plugin's agent starts that framework agent; another scoped name stays as given
  assert.equal(as("atf:playwright-ui-orchestrator", "Agent", { subagent_type: "atf:pw-ui-fixer" }).subagent, "pw-ui-fixer");
  for (const s of ["pw-ui-fixer", "other:pw-ui-fixer", "atf:a:b"]) assert.equal(as(undefined, "Agent", { subagent_type: s }).subagent, s);
});

test("Claude Code plugin: the framework plugin's MCP tools are its project tools; another plugin's are unknown", () => {
  const env = { CLAUDE_PROJECT_DIR: FULL.root };
  const tool = (tool_name) => {
    const c = claude.normalize({ agent_type: "atf:module-explorer", tool_name, tool_input: {} }, { env, host: "claude-code" });
    return [c.kind, c.browserAction];
  };
  for (const name of ["click", "type", "fill_form", "navigate", "evaluate", "close", "run_code_unsafe"]) {
    assert.deepEqual(tool(`mcp__plugin_atf_playwright__browser_${name}`), ["browser", name]);
    assert.deepEqual(tool(`mcp__plugin_atf_playwright__browser_${name}`), tool(`mcp__playwright__browser_${name}`), name);
  }
  for (const t of ["mcp__plugin_other_playwright__browser_click", "mcp__plugin_atf_x_playwright__browser_click", "mcp__plugin_atfx_playwright__browser_click",
    "mcp__plugin_other_srv__tool", "mcp__plugin_atf_srv__tool", "mcp__plugin_atf_playwright__browser_", "mcp__plugin_atf_playwright__browser_a-b", "mcp__other__browser_click", "mcp__playwright__browser_a\nb", "mcp__play\nwright__browser_click", "playwright__browser_click"])
    assert.deepEqual(tool(t), ["unknown", undefined], JSON.stringify(t));
});

test("Claude Code adapter: long adversarial agent types and tool names are read in linear time", () => {
  const env = { CLAUDE_PROJECT_DIR: FULL.root };
  const n = 200_000;
  const inputs = [
    { agent_type: `atf:${"a-".repeat(n)}!`, tool_name: `mcp__${"playwright".repeat(n / 10)}!` },
    { agent_type: `atf:${"a".repeat(n)}-`, tool_name: `mcp__${"playwright__browser_".repeat(n / 20)}!` },
    { agent_type: ":".repeat(n), tool_name: `mcp__plugin_atf_${"playwright".repeat(n / 10)}__browser_${"x".repeat(n)}!` },
    { agent_type: `${"atf:".repeat(n / 4)}x`, tool_name: `mcp__playwright${"__browser_".repeat(n / 10)}` },
  ];
  for (const p of inputs) {
    const t = performance.now();
    const c = claude.normalize({ ...p, tool_input: {} }, { env, host: "claude-code" });
    const ms = performance.now() - t;
    assert.ok(ms < 250, `${ms.toFixed(0)} ms for a ${p.tool_name.length}-character name`);
    assert.equal(c.unattributed, true);
  }
});

test("full-run on a host that cannot identify the caller: the run's combined permissions", () => {
  const post = "curl -X POST https://app.acme.test/api/contacts -d '{}'";
  const bash = (command) => cli({ toolName: "bash", toolArgs: { command } });
  const write = (rel) => cli({ toolName: "create", toolArgs: { path: path.join(FULL.root, rel) } });
  assert.equal(allowed(FULL.root, bash(post)), true, "some agent of the run may mutate over HTTP");
  assert.equal(allowed(FULL.root, write("playwright-tests/acme/pages/contacts.page.ts")), true);
  const outside = checkTool(write("config/permissions.yaml"), FULL.root, {}, { framework: FULL.root });
  assert.equal(outside.rule, "fs-write", "no agent of the run may write the framework's own files");
  assert.match(outside.reason, /Copilot CLI cannot tell the guard which agent is calling, so it allows what at least one of this run's agents may do/);
  assert.equal(checkTool(bash("curl -X DELETE https://app.acme.test/api/contacts/1"), FULL.root, {}, { framework: FULL.root }).rule, "delete-not-owned", "deletes stay ledger-scoped");
  const spawn = (agent_type) => allowed(FULL.root, cli({ toolName: "task", toolArgs: { agent_type, prompt: "x" } }));
  assert.deepEqual([spawn("orchestrator-agent"), spawn("pw-ui-fixer"), spawn("feedback-implementor-agent")], [true, true, false], "the chat may start the entry agent; agents outside a run stay out");
  assert.equal(checkTool(cli({ toolName: "write_bash", toolArgs: { shellId: "1", input: post } }), FULL.root, {}, { framework: FULL.root }).rule, "unmapped-tool");
  assert.equal(allowed(FULL.root, cli({ toolName: "read_bash", toolArgs: { shellId: "1" } })), true);
  assert.equal(allowed(FULL.root, cli({ tool_name: "tool_search_tool", tool_input: { query: "playwright browser_navigate" } })), true, "loading tool definitions runs nothing");
  // Copilot CLI's apply_patch: tool_name Edit, the bare patch text as tool_input (seen 2026-10-19).
  const patch = (rel) => cli({ tool_name: "Edit", tool_input: `*** Begin Patch\n*** Add File: ${rel}\n+{}\n*** End Patch` });
  assert.deepEqual(patch("playwright-tests/acme/pages/contacts.page.ts").paths, ["playwright-tests/acme/pages/contacts.page.ts"]);
  assert.equal(allowed(FULL.root, patch("playwright-tests/acme/pages/contacts.page.ts")), true);
  assert.equal(checkTool(patch("config/permissions.yaml"), FULL.root, {}, { framework: FULL.root }).rule, "fs-write", "the patch's own path is checked");
  assert.equal(cli({ toolName: "bash", toolArgs: "ls -la" }).command, "ls -la", "a bare non-patch string is still a command");
  assert.equal(allowed(FULL.root, copilot.normalize({ toolName: "bash", toolArgs: { command: post } }, { env: { GITHUB_ACTIONS: "true" }, host: "copilot" })), true, "the cloud agent too");
  assert.equal(allowed(FULL.root, claude.normalize({ tool_name: "Bash", tool_input: { command: post } }, { env: {}, host: "claude-code" })), true, "Copilot reading .claude/settings.json (unknown host)");

  const RO = startRun();
  assert.equal(allowed(RO.root, bash(post)), false, "readonly is unchanged");
  assert.equal(allowed(RO.root, write("config/permissions.yaml")), true, "readonly unidentified calls keep the mode rules only");
});

test("per-agent rules still apply wherever the caller is identified", () => {
  const post = "curl -X POST https://app.acme.test/api/contacts -d '{}'";
  assert.equal(allowed(FULL.root, vscode("pw-api-test-runner-triager", { tool_name: "run_in_terminal", tool_input: { command: post } })), true);
  assert.equal(allowed(FULL.root, vscode("pw-api-tests-writer", { tool_name: "run_in_terminal", tool_input: { command: post } })), false, "per-agent rules on VS Code");
  assert.equal(allowed(FULL.root, vscode(undefined, { tool_name: "run_in_terminal", tool_input: { command: post } })), true, "VS Code unmanaged: mode rules, as on Claude Code");
});

test("VS Code chat on its Copilot CLI engine is recognised and treated like Copilot CLI", () => {
  const env = { GITHUB_COPILOT_INTEGRATION_ID: "vscode-chat" };
  const engine = (payload) => copilot.normalize(payload, { env, host: "copilot" });
  const write = engine({ tool_name: "create", tool_input: { path: path.join(FULL.root, "config/permissions.yaml") }, agent_type: "orchestrator-agent" });
  assert.equal(write.agent, undefined, "its payload cannot name the agent");
  assert.match(checkTool(write, FULL.root, {}, { framework: FULL.root }).reason, /VS Code chat on its Copilot CLI engine cannot tell the guard which agent is calling/);

  const { root: r2 } = startRun({ mode: "full-run", verified: false });
  recordCanary("acme", r2, { host: "vscode-agent-host" });
  assert.equal(guardStatus("acme", "full-run", r2).ready, true);
  assert.equal(guardStatus("acme", "readonly", r2).ready, true);
});

test("per-agent rules apply on VS Code through the agent's own hook", () => {
  const w = (agent, rel) => allowed(FULL.root, vscode(agent, { tool_name: "create_file", tool_input: { filePath: path.join(FULL.root, rel) } }));
  assert.equal(w("pw-ui-pom-writer", "playwright-tests/acme/pages/contacts/contacts.page.ts"), true);
  assert.equal(w("pw-ui-pom-writer", "config/permissions.yaml"), false);
  const shot = path.join(FULL.root, "artifacts/acme/modules/contacts/explore/screenshots/list.png");
  assert.equal(allowed(FULL.root, vscode("pw-ui-reviewer", { tool_name: "view_image", tool_input: { filePath: shot } })), true, "a read: no longer an unmapped tool during a run");
  assert.equal(allowed(FULL.root, vscode("pw-ui-fixer", { tool_name: "runSubagent", tool_input: { agentName: "pw-ui-reviewer" } })), false);
  assert.equal(allowed(FULL.root, vscode("pw-ui-reviewer", { tool_name: "mcp_playwright_browser_navigate", tool_input: {} })), false);
});

test("an unmapped tool fails closed for a managed agent during a run, and only then", () => {
  const unknown = (agent) => vscode(agent, { tool_name: "brand_new_tool", tool_input: {} });
  assert.equal(checkTool(unknown("pw-ui-fixer"), FULL.root, {}, { framework: FULL.root }).rule, "unmapped-tool");
  assert.equal(allowed(FULL.root, unknown(undefined)), true);
  assert.equal(allowed(tempRoot(), unknown("pw-ui-fixer")), true, "no active run");
  const noPath = vscode("pw-ui-fixer", { tool_name: "create_file", tool_input: {} });
  assert.equal(checkTool(noPath, FULL.root, {}, { framework: FULL.root }).rule, "fs-write", "a write whose target is unknown is refused");
});

test("task_complete (autopilot's end-of-turn signal) is allowed during a full-run; unknown tools still fail closed", () => {
  // Payload as Copilot's autopilot sends it (session record, 2026-10-19): { summary } only, in every casing.
  const shapes = [
    { toolName: "task_complete", toolArgs: { summary: "done" } },
    { toolName: "task_complete", toolArgs: '{"summary":"done"}' },
    { tool_name: "task_complete", tool_input: { summary: "done" } },
  ];
  for (const p of shapes) {
    const c = cli(p);
    assert.deepEqual([c.kind, c.tool, c.paths, c.command], ["other", "task_complete", [], undefined]);
    assert.equal(allowed(FULL.root, c), true, "under the combined ceiling");
  }
  assert.equal(allowed(startRun().root, cli(shapes[0])), true, "readonly run");
  assert.equal(checkTool(cli({ toolName: "brand_new_tool", toolArgs: {} }), FULL.root, {}, { framework: FULL.root }).rule, "unmapped-tool");
  assert.equal(checkTool(cli({ toolName: "task_complete_v2", toolArgs: {} }), FULL.root, {}, { framework: FULL.root }).rule, "unmapped-tool", "an exact name, not a prefix");
});

test("a Copilot block of the canary (exit 2, shown by the host as 'hook errored') shows as guard.ready in run.mjs status", async () => {
  const { root } = startRun({ verified: false });
  assert.equal((await status("acme", { root })).guard.ready, false, "nothing recorded yet");
  const r = spawnSync(process.execPath, [path.join(frameworkRoot, "scripts", "hooks", "pretooluse.mjs"), "--host", "copilot"], { input: JSON.stringify({ cwd: root, toolName: "powershell", toolArgs: { command: "node scripts/run.mjs guard-check acme" } }), cwd: root, encoding: "utf8", env: { PATH: process.env.PATH } });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /\(canary\)/);
  assert.deepEqual((await status("acme", { root })).guard, { ready: true });
});

test("liveness canary: always blocked; the session is verified per mode; init and resume reset it", () => {
  const { root } = startRun({ mode: "full-run", verified: false });
  const canary = claude.normalize({ tool_name: "Bash", tool_input: { command: "node scripts/run.mjs guard-check acme" } }, { env: { CLAUDE_PROJECT_DIR: root }, host: "claude-code" });
  assert.deepEqual([checkTool(canary, root, {}, { framework: root }).rule, checkTool(canary, root, {}, { framework: root }).canary], ["canary", { product: "acme" }]);
  const shell = (command) => checkTool(cli({ tool_name: "bash", tool_input: { command } }), root, {}, { framework: root });
  for (const c of [`cd ${root} && node scripts/run.mjs guard-check acme`, `node ${root}/scripts/run.mjs guard-check acme 2>&1`, "true; node scripts/run.mjs guard-check acme"])
    assert.deepEqual(shell(c).canary, { product: "acme" }, `as agents actually write it: ${c}`);
  assert.equal(shell("echo node scripts/run.mjs guard-check acme").canary, undefined, "only as a command, not as an argument");
  assert.equal(shell("node scripts/run.mjs guard-check acme-x").canary.product, "acme-x");
  assert.equal(guardStatus("acme", "full-run", root).ready, false);
  recordCanary("acme", root, { host: "vscode" });
  assert.match(guardStatus("acme", "full-run", root).reason, /full-run on VS Code's local agent needs the custom agents' own hooks/, "there an unidentified caller is unmanaged");
  assert.equal(guardStatus("acme", "readonly", root).ready, true);
  recordCanary("acme", root, { host: "vscode", agent: "orchestrator-agent" });
  assert.equal(guardStatus("acme", "full-run", root).ready, true);
  const { root: cliRoot } = startRun({ mode: "full-run", verified: false });
  recordCanary("acme", cliRoot, { host: "copilot-cli" });
  assert.equal(guardStatus("acme", "full-run", cliRoot).ready, true, "Copilot CLI: unidentified calls get the combined permissions");
  markAbsent("acme", root);
  assert.equal(guardStatus("acme", "readonly", root).ready, false, "a session where the canary ran is never verified");
  recordCanary("acme", root, { host: "claude-code" });
  assert.equal(guardStatus("acme", "full-run", root).ready, true, "a later block clears the absent record");
  initRun(path.join(root, "config", "acme.yaml"), { root, framework: root, resume: true, env: {} });
  assert.equal(guardStatus("acme", "readonly", root).ready, false, "resume starts unverified");
});

test("a stage cannot start until the session's guard is verified", async () => {
  const { root } = startRun({ verified: false });
  const r = await setStage("acme", "knowledge", undefined, "start", undefined, { root });
  assert.match(r.errors[0], /guard not verified/);
  recordCanary("acme", root, { host: "copilot-cli" });
  assert.equal((await setStage("acme", "knowledge", undefined, "start", undefined, { root })).errors, undefined, "readonly: any working hook");
});

test("run.mjs init accepts full-run on every host and records where it started", () => {
  const root = tempRoot();
  const r = initRun(writeConfig(root, { mode: "full-run" }), { root, framework: root, env: { GITHUB_ACTIONS: "true" } });
  assert.equal(r.errors, undefined);
  assert.deepEqual([r.run.mode, r.run.startedOnHost], ["full-run", "copilot-cloud"]);
});

// ---- the hook entry, as each host runs it ----------------------------------------------------------------------
const hook = (args, payload, env = {}) =>
  spawnSync(process.execPath, [path.join(frameworkRoot, "scripts", "hooks", "pretooluse.mjs"), ...args], { input: typeof payload === "string" ? payload : JSON.stringify(payload), encoding: "utf8", env: { PATH: process.env.PATH, ...env } });

test("hook entry: Claude Code blocks with exit 2 and records the canary", () => {
  const r = hook(["--host", "claude-code"], { tool_name: "Bash", tool_input: { command: "curl -X POST https://x/api" } }, { CLAUDE_PROJECT_DIR: FULL.root, AUTHORIZATIONS_MODE: "readonly" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /http-mutate/);
  const { root } = startRun({ verified: false });
  const c = hook(["--host", "claude-code"], { agent_type: "orchestrator-agent", tool_name: "Bash", tool_input: { command: "node scripts/run.mjs guard-check acme" } }, { CLAUDE_PROJECT_DIR: root });
  assert.equal(c.status, 2);
  assert.deepEqual(readdirSync(path.join(root, "artifacts/acme/state/guard-check")), ["claude-code--orchestrator-agent.json"]);
});

test("hook entry: a plugin agent gets its own row, another plugin's agent the run's combined ceiling (packaging §3.12)", () => {
  const write = (agent_type, rel) => hook(["--host", "claude-code"], { agent_type, tool_name: "Write", tool_input: { file_path: path.join(FULL.root, rel) } }, { CLAUDE_PROJECT_DIR: FULL.root });
  const evidence = "artifacts/acme/modules/contacts/clarification-evidence/contacts-1/notes.md";
  assert.equal(write("atf:pw-ui-fixer", "playwright-tests/acme/pages/contacts/contacts.page.ts").status, 0);
  const own = write("atf:pw-ui-fixer", evidence);
  assert.equal(own.status, 2);
  assert.match(own.stderr, /\(fs-write\).*outside this agent's filesystem\.write allow-list/);
  assert.equal(write("other:pw-ui-fixer", evidence).status, 0, "what at least one of the run's agents may write");
  const other = write("other:pw-ui-fixer", "config/permissions.yaml");
  assert.equal(other.status, 2);
  assert.match(other.stderr, /\(fs-write\).*Claude Code named a caller that is none of the framework's agents.*so it allows what at least one of this run's agents may do/);
  const settings = write("other:x", "atf/permissions.yaml");
  assert.equal(settings.status, 2);
  assert.match(settings.stderr, /\(workspace-settings\)/);
  const browser = hook(["--host", "claude-code"], { agent_type: "atf:pw-ui-reviewer", tool_name: "mcp__plugin_atf_playwright__browser_navigate", tool_input: { url: "https://app.acme.test" } }, { CLAUDE_PROJECT_DIR: FULL.root });
  assert.equal(browser.status, 2);
  assert.match(browser.stderr, /\(browser-none\)/);
  const unknown = hook(["--host", "claude-code"], { agent_type: "atf:module-explorer", tool_name: "mcp__plugin_other_srv__tool", tool_input: {} }, { CLAUDE_PROJECT_DIR: FULL.root });
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /\(unmapped-tool\): 'mcp__plugin_other_srv__tool' is not a tool the guard knows on Claude Code/);
});

test("hook entry: Copilot CLI gets a deny decision on stdout and exit 2", () => {
  const r = hook(["--host", "copilot"], { cwd: FULL.root, toolName: "create", toolArgs: { path: path.join(FULL.root, "config/permissions.yaml") } });
  assert.equal(r.status, 2);
  assert.equal(JSON.parse(r.stdout).permissionDecision, "deny");
});

test("hook entry: Copilot's task_complete passes during a full-run and leaves the run's state alone", async () => {
  const { root } = startRun({ mode: "full-run" });
  const state = path.join(root, "artifacts/acme/state");
  const snapshot = () =>
    readdirSync(state, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => [path.join(e.parentPath, e.name), readFileSync(path.join(e.parentPath, e.name), "utf8")]);
  const before = snapshot();
  const r = hook(["--host", "copilot"], { cwd: root, toolName: "task_complete", toolArgs: { summary: "Implemented the fix; tests pass." } });
  assert.deepEqual([r.status, r.stdout, r.stderr], [0, "", ""]);
  assert.deepEqual(snapshot(), before, "completing the assistant's task is not a stage or run transition");
  const s = await status("acme", { root });
  assert.deepEqual([s.active, s.mode], [true, "full-run"], "the run stays active in full-run");
  assert.equal(hook(["--host", "copilot"], { cwd: root, toolName: "brand_new_tool", toolArgs: {} }).status, 2, "unknown tools still fail closed");
});

test("hook entry: VS Code blocks with a deny decision and exit 0, never by exit code (D-040)", () => {
  const r = hook(["--host", "vscode", "--agent", "pw-ui-pom-writer"], { cwd: FULL.root, tool_name: "create_file", tool_input: { filePath: path.join(FULL.root, "config/permissions.yaml") } });
  assert.equal(r.status, 0, "on Windows, VS Code's PowerShell wrapper turns exit 2 into 1, a non-blocking warning");
  const out = JSON.parse(r.stdout).hookSpecificOutput;
  assert.deepEqual([out.hookEventName, out.permissionDecision], ["PreToolUse", "deny"]);
  assert.match(out.permissionDecisionReason, /^Blocked by the framework guard \(fs-write\): /);
  const { root } = startRun({ mode: "full-run", verified: false });
  const c = hook(["--host", "vscode", "--agent", "orchestrator-agent"], { cwd: root, tool_name: "run_in_terminal", tool_input: { command: "node scripts/run.mjs guard-check acme" } });
  assert.deepEqual([c.status, JSON.parse(c.stdout).hookSpecificOutput.permissionDecision], [0, "deny"], "the guard-check canary from orchestrator-agent");
  assert.deepEqual(readdirSync(path.join(root, "artifacts/acme/state/guard-check")), ["vscode--orchestrator-agent.json"]);
  assert.equal(guardStatus("acme", "full-run", root).ready, true);
});

test("hook entry fails closed on garbage while a run is active, and stays out of the way otherwise", () => {
  const idle = spawnSync(process.execPath, [path.join(frameworkRoot, "scripts", "hooks", "pretooluse.mjs"), "--host", "copilot"], { input: "not json", cwd: tempRoot(), encoding: "utf8", env: { PATH: process.env.PATH } });
  assert.equal(idle.status, 0, "no run: cwd has no artifacts/ lock");
  const r = spawnSync(process.execPath, [path.join(frameworkRoot, "scripts", "hooks", "pretooluse.mjs"), "--host", "copilot"], { input: "not json", cwd: FULL.root, encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /failing closed/);
  const v = spawnSync(process.execPath, [path.join(frameworkRoot, "scripts", "hooks", "pretooluse.mjs"), "--host", "vscode"], { input: "not json", cwd: FULL.root, encoding: "utf8" });
  assert.deepEqual([v.status, JSON.parse(v.stdout).hookSpecificOutput.permissionDecision], [0, "deny"], "VS Code: in its own format");
  assert.equal(hook(["--host", "nonsense"], { cwd: FULL.root, tool_name: "Bash", tool_input: {} }, { CLAUDE_PROJECT_DIR: FULL.root }).status, 2);
});

test("hook errors are logged with their stack and context, blocked or not, PreToolUse and PostToolUse (D-065)", () => {
  const entries = (root) => readFileSync(path.join(root, "artifacts", "hook-errors.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const { root } = startRun();
  const r = spawnSync(process.execPath, [path.join(frameworkRoot, "scripts", "hooks", "pretooluse.mjs"), "--host", "copilot"], { input: "not json", cwd: root, encoding: "utf8", env: { PATH: process.env.PATH } });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /details in .*hook-errors\.jsonl/);
  const [blocked] = entries(root);
  assert.deepEqual([blocked.hook, blocked.host, blocked.outcome, blocked.raw], ["pretooluse", "copilot", "blocked: a run is active", "not json"]);
  assert.match(blocked.stack, /SyntaxError/);

  const idle = tempRoot();
  const i = spawnSync(process.execPath, [path.join(frameworkRoot, "scripts", "hooks", "pretooluse.mjs"), "--host", "copilot"], { input: "not json", cwd: idle, encoding: "utf8", env: { PATH: process.env.PATH } });
  assert.equal(i.status, 0);
  assert.match(i.stderr, /no run is active, so the call is allowed; details in/);
  assert.equal(entries(idle)[0].outcome, "allowed: no active run");

  const post = spawnSync(process.execPath, [path.join(frameworkRoot, "scripts", "hooks", "posttooluse.mjs"), "--host", "nonsense"], { input: "{}", cwd: idle, encoding: "utf8", env: { PATH: process.env.PATH } });
  assert.equal(post.status, 0, "PostToolUse never blocks");
  const logged = entries(idle)[1];
  assert.deepEqual([logged.hook, logged.host, logged.outcome], ["posttooluse", "nonsense", "ignored: confirmation not remembered"]);
  assert.match(logged.error, /unknown --host 'nonsense'/);

  logHookError(idle, { hook: "posttooluse", args: { host: "claude-code" }, error: new Error("boom"), payload: { session_id: "s1", tool_name: "Write", tool_input: { file_path: "x", content: "secret" } }, raw: "secret" });
  const parsed = entries(idle)[2];
  assert.deepEqual([parsed.tool, parsed.inputKeys, parsed.sessionId, parsed.raw], ["Write", ["file_path", "content"], "s1", undefined]);
  assert.equal(JSON.stringify(parsed).includes("secret"), false, "input values are never logged");
});

test("hook entry fails closed even when no adapter loads, in a form the asserted host honours", () => {
  const dir = path.join(tempRoot(), "scripts", "hooks");
  mkdirSync(dir, { recursive: true });
  const entry = path.join(dir, "pretooluse.mjs");
  copyFileSync(path.join(frameworkRoot, "scripts", "hooks", "pretooluse.mjs"), entry); // no hosts/ beside it
  const run = (...args) => spawnSync(process.execPath, [entry, ...args], { input: "{}", cwd: FULL.root, encoding: "utf8", env: { PATH: process.env.PATH } });
  const v = run("--host", "vscode", "--agent", "orchestrator-agent");
  assert.equal(v.status, 0);
  assert.match(JSON.parse(v.stdout).hookSpecificOutput.permissionDecisionReason, /failing closed/);
  assert.equal(run("--host=vscode").status, 0);
  assert.deepEqual([run("--host", "claude-code").status, run("--host", "copilot").status, run("--host", "vscode-x").status], [2, 2, 2]);
});

test("hook registrations: every host runs the same entry with a valid --host", () => {
  const settings = JSON.parse(readFileSync(path.join(workspaceRoot, ".claude", "settings.json"), "utf8"));
  const commands = [
    ...Object.values(settings.hooks).flatMap((xs) => xs.flatMap((x) => x.hooks.map((h) => h.command))),
    ...[".github/hooks/framework-guard.json", ".vscode/hooks/framework-guard.json"].flatMap((f) =>
      Object.values(JSON.parse(readFileSync(path.join(workspaceRoot, f), "utf8")).hooks).flatMap((xs) => xs.map((h) => h.command))
    ),
  ];
  assert.ok(commands.length >= 6);
  for (const c of commands) assert.match(c, /scripts\/hooks\/(pre|post)tooluse\.mjs"? --host (claude-code|vscode|copilot)$/, c);
  assert.ok(!existsSync(path.join(workspaceRoot, ".claude", "hooks")), "the old Claude-only hook is gone");
});

test("hook registrations: the .claude/settings.json command reaches the entry from bash and from PowerShell", () => {
  // Copilot CLI and VS Code's Copilot CLI engine also run it ("repo settings"), through PowerShell on Windows, from the
  // repo root and without CLAUDE_PROJECT_DIR. A bash-only path there crashed node before the guard ran ("hook errored").
  const { hooks } = JSON.parse(readFileSync(path.join(workspaceRoot, ".claude", "settings.json"), "utf8"));
  const command = hooks.PreToolUse[0].hooks[0].command;
  const input = JSON.stringify({ tool_name: "Read", tool_input: { file_path: "README.md" } });
  const { CLAUDE_PROJECT_DIR, ...env } = process.env;
  const reached = (r, shell) => {
    assert.doesNotMatch(r.stderr ?? "", /Cannot find module/, `${shell}: ${r.stderr}`);
    assert.notEqual(r.status, 1, `${shell}: ${r.stderr}`);
  };
  const gitBash = path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "bin", "bash.exe");
  const bash = process.platform === "win32" ? (existsSync(gitBash) ? gitBash : undefined) : "bash";
  if (bash) reached(spawnSync(bash, ["-c", command], { cwd: tempRoot(), input, encoding: "utf8", env: { ...env, CLAUDE_PROJECT_DIR: workspaceRoot } }), "bash");
  if (process.platform === "win32")
    reached(spawnSync("powershell.exe", ["-NoProfile", "-Command", command], { cwd: workspaceRoot, input, encoding: "utf8", env }), "powershell");
});

test("hook entries read a payload that starts with a BOM (Windows PowerShell 5.1 relays stdin with one)", () => {
  const bom = (payload) => `\uFEFF${JSON.stringify(payload)}`;
  const r = hook(["--host", "claude-code"], bom({ tool_name: "Bash", tool_input: { command: "curl -X POST https://x/api" } }), { CLAUDE_PROJECT_DIR: FULL.root, AUTHORIZATIONS_MODE: "readonly" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /http-mutate/, "judged by the guard, not failed closed");
  const root = tempRoot();
  const post = spawnSync(process.execPath, [path.join(frameworkRoot, "scripts", "hooks", "posttooluse.mjs"), "--host", "copilot"], { input: bom({ cwd: root, toolName: "bash", toolArgs: {} }), cwd: root, encoding: "utf8", env: { PATH: process.env.PATH } });
  assert.equal(post.status, 0);
  assert.ok(!existsSync(path.join(root, "artifacts", "hook-errors.jsonl")), post.stderr);
});

test("the PostToolUse hook records an agent spawn of the active run with what the host reports, and nothing else (D-079)", () => {
  const { root, run } = startRun({ mode: "readonly" });
  const post = (payload) => spawnSync(process.execPath, [path.join(frameworkRoot, "scripts", "hooks", "posttooluse.mjs"), "--host", "claude-code"], { input: JSON.stringify({ cwd: root, session_id: "s1", ...payload }), cwd: root, encoding: "utf8", env: { PATH: process.env.PATH, CLAUDE_PROJECT_DIR: root } });
  assert.equal(post({ agent_type: "orchestrator-agent", tool_name: "Agent", tool_input: { subagent_type: "module-explorer", prompt: "product=acme module=contacts" }, tool_response: { totalDurationMs: 1200, totalTokens: 3400, totalToolUseCount: 7, content: [] } }).status, 0);
  assert.equal(post({ agent_type: "orchestrator-agent", tool_name: "Task", tool_input: { subagent_type: "report-generator" }, tool_response: "done" }).status, 0);
  assert.equal(post({ tool_name: "Bash", tool_input: { command: "ls" } }).status, 0);
  const lines = readFileSync(path.join(root, "artifacts", "acme", "state", "telemetry.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(lines.map(({ at, ...x }) => x), [
    { runId: run.runId, host: "claude-code", caller: "orchestrator-agent", agent: "module-explorer", durationMs: 1200, tokens: 3400, toolUses: 7 },
    { runId: run.runId, host: "claude-code", caller: "orchestrator-agent", agent: "report-generator" },
  ], "only spawns, with the numbers the host gave and no others; never the prompt or the response");
});

test("hook registrations: the framework's Claude entries are recognised in every form a version rendered, and nothing else is", () => {
  const cmd = (command, extra = {}) => ({ type: "command", command, ...extra });
  // every form this repo's .claude/settings.json has carried since the single hook entry (git history), and the
  // installed package's, from another {fw} or either separator
  for (const [command, entry] of [
    ['node "${CLAUDE_PROJECT_DIR:+$CLAUDE_PROJECT_DIR/}packages/core/scripts/hooks/pretooluse.mjs" --host claude-code', "pretooluse"],
    ['node "${CLAUDE_PROJECT_DIR:+$CLAUDE_PROJECT_DIR/}scripts/hooks/posttooluse.mjs" --host claude-code', "posttooluse"],
    ['node "${CLAUDE_PROJECT_DIR:-.}/scripts/hooks/pretooluse.mjs" --host claude-code', "pretooluse"],
    ['node "$CLAUDE_PROJECT_DIR/scripts/hooks/pretooluse.mjs" --host claude-code', "pretooluse"],
    ['node "${CLAUDE_PROJECT_DIR:+$CLAUDE_PROJECT_DIR/}node_modules/@testagentic/atf/scripts/hooks/pretooluse.mjs" --host claude-code', "pretooluse"],
    ["node node_modules/@testagentic/atf/scripts/hooks/posttooluse.mjs --host claude-code", "posttooluse"],
    ["node ..\\atf\\scripts\\hooks\\pretooluse.mjs --host claude-code", "pretooluse"],
    ["  node scripts/hooks/pretooluse.mjs --host claude-code --verbose  ", "pretooluse"],
  ])
    assert.equal(frameworkHook(cmd(command)), entry, command);
  assert.equal(frameworkHook(cmd("node scripts/hooks/posttooluse.mjs --host claude-code", { async: true })), "posttooluse");
  // the client's own: another host, no host, another script, a look-alike path, not a command hook
  for (const hook of [
    cmd("node scripts/hooks/pretooluse.mjs --host copilot"),
    cmd("node scripts/hooks/pretooluse.mjs"),
    cmd("node scripts/hooks/pretooluse.mjs --host"),
    cmd('node "$CLAUDE_PROJECT_DIR/.claude/hooks/guard.mjs"'),
    cmd("node myscripts/hooks/pretooluse.mjs --host claude-code"),
    cmd("node scripts/hooks/pretooluse.mjs.bak --host claude-code"),
    cmd("bash -c 'node scripts/hooks/pretooluse.mjs --host claude-code'"),
    cmd("nodemon scripts/hooks/pretooluse.mjs --host claude-code"),
    { type: "prompt", command: "node scripts/hooks/pretooluse.mjs --host claude-code" },
    { type: "command" },
    "node scripts/hooks/pretooluse.mjs --host claude-code",
    null,
  ])
    assert.equal(frameworkHook(hook), null, JSON.stringify(hook));
});

test("hook registrations: a merge keeps every client entry, puts the guard first, and never yields settings without it", () => {
  const ours = mergeClaudeHooks(undefined, "async", "fw");
  assert.deepEqual(Object.keys(ours), ["PreToolUse", "PostToolUse"]);
  const pre = ours.PreToolUse[0];
  const mine = { matcher: "Bash", hooks: [{ type: "command", command: "./lint.sh" }] };
  // a client copy of the guard's own group, under another event or twice: one guard, first, and nothing of theirs lost
  const merged = mergeClaudeHooks({ PreToolUse: [mine, pre, pre], SessionStart: [pre, { hooks: [{ type: "command", command: "echo hi" }] }] }, "off", "fw");
  assert.deepEqual(merged, { PreToolUse: [pre, mine], SessionStart: [{ hooks: [{ type: "command", command: "echo hi" }] }] });
  // a key that is data, not the object's prototype
  const proto = mergeClaudeHooks(JSON.parse('{"__proto__": [{"hooks": []}]}'), "off", "fw");
  assert.deepEqual(Object.keys(proto), ["PreToolUse", "__proto__"]);
  assert.equal(Object.getPrototypeOf(proto), Object.prototype);
  // an empty event the client wrote stays as written; one the merge emptied goes
  assert.deepEqual(Object.keys(mergeClaudeHooks({ Stop: [], PostToolUse: ours.PostToolUse }, "off", "fw")), ["PreToolUse", "Stop"]);
});
