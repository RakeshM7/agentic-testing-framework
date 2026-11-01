// Host adapters, the per-host rules (unidentified full-run calls, unknown tools, liveness canary) and the hook entry end to end.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { checkTool } from "./lib/guard.mjs";
import { frameworkHook, mergeClaudeHooks } from "./lib/hook-registrations.mjs";
import { guardStatus, markAbsent, recordCanary } from "./lib/guard-check.mjs";
import { logHookError } from "./lib/hook-log.mjs";
import { frameworkRoot, workspaceRoot } from "./lib/contract.mjs";
import { initRun, setStage, status } from "./run.mjs";
import * as claude from "./hooks/hosts/claude.mjs";
import { PLUGIN_MCP_PREFIX, PLUGIN_NAME, detectShellHost, identityOf, labelOf, resolveHost } from "./lib/hosts.mjs";
import * as copilot from "./hooks/hosts/copilot.mjs";
import * as antigravity from "./hooks/hosts/antigravity.mjs";
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
  assert.deepEqual([run("--host", "claude-code").stdout, run("--host", "antigravity-x").stdout], ["", ""]);
  // Antigravity: exit 2 and its documented deny decision on stdout, since which one it honours is unverified (D-099)
  const a = run("--host", "antigravity");
  assert.equal(a.status, 2);
  assert.equal(JSON.parse(a.stdout).decision, "deny");
  assert.match(JSON.parse(a.stdout).reason, /^Blocked: the framework guard failed .* failing closed/);
  assert.equal(JSON.parse(run("--host=antigravity").stdout).decision, "deny");
});

test("hook registrations: every host runs the same entry with a valid --host", () => {
  const settings = JSON.parse(readFileSync(path.join(workspaceRoot, ".claude", "settings.json"), "utf8"));
  const commands = [
    ...Object.values(settings.hooks).flatMap((xs) => xs.flatMap((x) => x.hooks.map((h) => h.command))),
    ...[".github/hooks/framework-guard.json", ".vscode/hooks/framework-guard.json"].flatMap((f) =>
      Object.values(JSON.parse(readFileSync(path.join(workspaceRoot, f), "utf8")).hooks).flatMap((xs) => xs.map((h) => h.command))
    ),
    // Antigravity (D-099): the framework's own named set in the shared .agents/hooks.json
    ...Object.values(JSON.parse(readFileSync(path.join(workspaceRoot, ".agents", "hooks.json"), "utf8"))["atf-guard"])
      .filter(Array.isArray).flatMap((xs) => xs.flatMap((x) => x.hooks.map((h) => h.command))),
    // Codex (D-115): the framework's entries in the shared .codex/hooks.json
    ...Object.values(JSON.parse(readFileSync(path.join(workspaceRoot, ".codex", "hooks.json"), "utf8")).hooks).flatMap((xs) => xs.flatMap((x) => x.hooks.map((h) => h.command))),
  ];
  assert.ok(commands.length >= 10);
  assert.ok(commands.some((c) => c.endsWith("pretooluse.mjs --host antigravity")), "Antigravity registers the guard");
  assert.ok(commands.some((c) => c.endsWith("pretooluse.mjs --host codex")), "Codex registers the guard");
  for (const c of commands) assert.match(c, /scripts\/hooks\/(pre|post)tooluse\.mjs"? --host (claude-code|vscode|copilot|antigravity|codex)$/, c);
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

// ---- Antigravity (App, agy CLI, IDE): built from its documentation; the payloads are `documented` fixtures until the
// spike (docs/antigravity-spike/) captures live ones ----------------------------------------------------------------
const AG_FIXTURES = new URL("./fixtures/hooks/", import.meta.url);
// A documented payload with `{root}` standing for the workspace (JSON-escaped, so a Windows path stays one string).
const agPayload = (tool, root = FULL.root) =>
  JSON.parse(readFileSync(new URL(`antigravity-documented-${tool}.json`, AG_FIXTURES), "utf8").replaceAll("{root}", JSON.stringify(root).slice(1, -1)));
const ag = (payload, agent) => antigravity.normalize(payload, { env: {}, host: "antigravity", agent });
const agCall = (name, args, root = FULL.root) => ag({ toolCall: { name, args }, conversationId: "ag-conv-0001", workspacePaths: [root] });
const agUnmapped = ["define_subagent", "send_message", "manage_subagents", "schedule", "generate_image", "browser_subagent", "browser_click", "browser_navigate", "evaluate_script",
  "mcp_chrome-devtools_click", "mcp_chrome-devtools_evaluate_script", "mcp_playwright_evaluate_script", "mcp_other_browser_click", "mcp_playwright_x_browser_click"];

test("Antigravity adapter: every documented payload normalizes to its canonical call", () => {
  const at = (rel) => `${FULL.root}/${rel}`;
  const pom = at("playwright-tests/acme/pages/contacts/contacts.page.ts");
  const expected = {
    run_command: { kind: "shell", command: "node scripts/run.mjs status acme" },
    write_to_file: { kind: "write", paths: [pom] },
    replace_file_content: { kind: "write", paths: [pom] },
    view_file: { kind: "read", paths: [at("artifacts/acme/state/run.json")] },
    invoke_subagent: { kind: "spawn", subagent: "pw-ui-fixer" },
    ask_question: { kind: "ask" },
    read_url_content: { kind: "web_fetch", urls: ["https://docs.acme.test/api/contacts"] },
    mcp_playwright_browser_click: { kind: "browser", browserAction: "click" },
    define_subagent: { kind: "unknown" },
    browser_subagent: { kind: "unknown" },
  };
  const files = readdirSync(AG_FIXTURES).filter((f) => f.startsWith("antigravity-")).sort();
  assert.deepEqual(files, Object.keys(expected).map((t) => `antigravity-documented-${t}.json`).sort(), "one fixture per representative tool");
  for (const [tool, want] of Object.entries(expected)) {
    const payload = agPayload(tool);
    const c = ag(payload);
    assert.deepEqual(
      { host: c.host, agent: c.agent, tool: c.tool, kind: c.kind, command: c.command, paths: c.paths, urls: c.urls, subagent: c.subagent, browserAction: c.browserAction, sessionId: c.sessionId },
      { host: "antigravity", agent: undefined, tool, command: undefined, paths: [], urls: [], subagent: undefined, browserAction: undefined, sessionId: "ag-conv-0001", ...want },
      tool
    );
    assert.equal(antigravity.rootOf(payload), FULL.root, `${tool}: the workspace from workspacePaths`);
  }
});

test("Antigravity adapter: argument keys are read tolerantly, and keys that disagree never pick the value the host may not run", () => {
  assert.equal(ag({ toolCall: { name: "run_command", args: '{"CommandLine":"ls"}' } }).command, "ls", "args as a JSON string");
  assert.deepEqual(ag({ toolCall: { name: "run_command", args: "not json" } }).command, undefined);
  // a command under no known key is unknown, so refused during a run, never judged as an empty line
  for (const args of ["not json", {}, { Cmd: "curl -X DELETE https://app.acme.test/api/contacts/1" }, { CommandLine: 42 }]) {
    assert.equal(ag({ toolCall: { name: "run_command", args } }).kind, "unknown", JSON.stringify(args));
    assert.equal(checkTool(agCall("run_command", args), FULL.root, {}, { framework: FULL.root }).rule, "unmapped-tool", JSON.stringify(args));
  }
  assert.equal(agCall("run_command", { command: "ls" }).command, "ls");
  assert.equal(agCall("run_command", { CommandLine: "ls", command: "ls" }).command, "ls");
  assert.equal(agCall("run_command", { CommandLine: "ls", command: "curl -X DELETE https://x/a" }).command, "ls ; curl -X DELETE https://x/a", "both are judged");
  for (const key of ["TargetFile", "AbsolutePath", "FilePath", "file_path", "path", "DirectoryPath", "SearchPath", "SearchDirectory"])
    assert.deepEqual(agCall("write_to_file", { [key]: "/w/a.ts" }).paths, ["/w/a.ts"], key);
  assert.deepEqual(agCall("write_to_file", { TargetFile: "/w/a.ts", file_path: "/w/b.ts", path: "/w/a.ts" }).paths, ["/w/a.ts", "/w/b.ts"], "every target is checked");
  assert.deepEqual(agCall("write_to_file", { TargetFile: 42 }).paths, [], "not a string: no target (refused for a managed caller)");
  assert.deepEqual(agCall("read_url_content", { url: "https://a.test" }).urls, ["https://a.test"]);
  for (const key of ["Name", "name", "AgentName", "agentName", "agent", "subagent", "SubagentName"])
    assert.equal(agCall("invoke_subagent", { [key]: "pw-ui-fixer" }).subagent, "pw-ui-fixer", key);
  assert.equal(agCall("invoke_subagent", { Name: "pw-ui-fixer", AgentName: "pw-ui-fixer" }).subagent, "pw-ui-fixer");
  assert.equal(agCall("invoke_subagent", { Name: "pw-ui-fixer", AgentName: "feedback-implementor-agent" }).subagent, undefined, "two different agents: none");
  assert.equal(agCall("define_subagent", { Name: "helper" }).subagent, undefined, "only a spawn names a subagent");
  // the payload never names the caller; only a build-baked --agent does (D-021)
  assert.equal(ag({ ...agPayload("run_command"), agent: "orchestrator-agent", agentName: "orchestrator-agent" }).agent, undefined);
  assert.equal(ag(agPayload("run_command"), "module-explorer").agent, "module-explorer");
  // tool names: exact, own keys only
  for (const t of ["", "toString", "__proto__", "constructor", "run_command_v2", "Run_Command"]) assert.equal(agCall(t, {}).kind, "unknown", t);
  assert.deepEqual([ag({}).kind, ag({}).tool, ag({}).sessionId], ["unknown", "", undefined]);
  assert.equal(ag({ toolCall: { name: "view_file", args: {} }, conversationId: 7 }).sessionId, undefined);
});

test("Antigravity adapter: only the Playwright MCP server's tools are browser tools; built-in browsers stay unknown (D-070)", () => {
  for (const name of ["click", "type", "navigate", "navigate_back", "file_upload", "evaluate"]) {
    assert.deepEqual([agCall(`mcp_playwright_browser_${name}`, {}).kind, agCall(`mcp_playwright_browser_${name}`, {}).browserAction], ["browser", name]);
    assert.equal(agCall(`mcp__playwright__browser_${name}`, {}).browserAction, name, "Claude's form too");
  }
  for (const t of [...agUnmapped, "mcp_playwright_browser_", "mcp_playwright_browser_a-b", "mcp_play wright_browser_click", "mcp_playwright_browser_a\nb", "playwright_browser_click", "mcp__plugin_atf_playwright__browser_click"])
    assert.deepEqual([agCall(t, {}).kind, agCall(t, {}).browserAction], ["unknown", undefined], JSON.stringify(t));
  const n = 200_000;
  for (const tool of [`mcp_${"playwright_".repeat(n / 10)}!`, `mcp_${"_browser_".repeat(n / 9)}x!`, `mcp__${"playwright".repeat(n / 10)}__browser_${"x".repeat(n)}!`]) {
    const t = performance.now();
    assert.equal(agCall(tool, {}).kind, "unknown");
    assert.ok(performance.now() - t < 250, "linear in the name's length");
  }
});

test("Antigravity adapter: the workspace is the payload's, never the model's", () => {
  const other = tempRoot();
  assert.equal(antigravity.rootOf({ workspacePaths: [other, FULL.root] }), FULL.root, "multi-root: the folder holding the run");
  assert.equal(antigravity.rootOf({ workspacePaths: [other] }), other);
  assert.equal(antigravity.rootOf({ workspacePaths: [pathToFileURL(FULL.root).href] }), FULL.root, "a file:// URI");
  assert.equal(antigravity.rootOf({ workspacePaths: [], cwd: other }), other);
  assert.equal(antigravity.rootOf({ toolCall: { name: "run_command", args: { Cwd: other } } }), process.cwd(), "run_command's Cwd is the model's: never the root");
  assert.equal(antigravity.rootOf(null), process.cwd());
});

test("Antigravity host: identity none (D-035), asserted by its registration, never inferred from a shell", () => {
  assert.deepEqual([identityOf("antigravity"), labelOf("antigravity")], ["none", "Antigravity"]);
  assert.equal(resolveHost("antigravity", {}), "antigravity");
  assert.equal(resolveHost("antigravity", { CLAUDE_PROJECT_DIR: "/w", GITHUB_ACTIONS: "true" }), "antigravity");
  assert.equal(detectShellHost({}), "unknown", "no documented Antigravity environment variable yet");
});

test("Antigravity full-run: the run's combined ceiling; unmapped built-ins and built-in browsers are refused (D-035, D-036, D-070)", () => {
  const check = (c, root = FULL.root) => checkTool(c, root, {}, { framework: root });
  assert.equal(allowed(FULL.root, ag(agPayload("write_to_file"))), true);
  assert.equal(allowed(FULL.root, ag(agPayload("replace_file_content"))), true);
  const outside = check(agCall("write_to_file", { TargetFile: path.join(FULL.root, "config/permissions.yaml") }));
  assert.equal(outside.rule, "fs-write");
  assert.match(outside.reason, /Antigravity cannot tell the guard which agent is calling, so it allows what at least one of this run's agents may do/);
  assert.equal(check(agCall("write_to_file", {})).rule, "fs-write", "a write whose target is unknown is refused");
  assert.equal(allowed(FULL.root, agCall("run_command", { CommandLine: "curl -X POST https://app.acme.test/api/contacts -d '{}'" })), true, "some agent of the run may mutate over HTTP");
  assert.equal(check(agCall("run_command", { CommandLine: "curl -X DELETE https://app.acme.test/api/contacts/1" })).rule, "delete-not-owned", "deletes stay ledger-scoped");
  assert.equal(allowed(FULL.root, ag(agPayload("invoke_subagent"))), true);
  assert.equal(check(agCall("invoke_subagent", { Name: "feedback-implementor-agent" })).rule, "spawn", "agents outside the run stay out");
  assert.equal(check(agCall("invoke_subagent", { Name: "pw-ui-fixer", AgentName: "feedback-implementor-agent" })).rule, "spawn", "an ambiguous spawn is refused");
  assert.equal(allowed(FULL.root, ag(agPayload("mcp_playwright_browser_click"))), true);
  for (const t of ["view_file", "ask_question", "read_url_content", "run_command"]) assert.equal(allowed(FULL.root, ag(agPayload(t))), true, t);
  for (const t of ["list_permissions", "ask_permission", "manage_task"]) assert.equal(allowed(FULL.root, agCall(t, {})), true, t);
  for (const t of agUnmapped) {
    const v = check(agCall(t, {}));
    assert.equal(v.rule, "unmapped-tool", t);
    assert.match(v.reason, /is not a tool the guard knows on Antigravity/);
  }
  assert.equal(check(ag(agPayload("define_subagent"))).rule, "unmapped-tool");
  assert.equal(check(ag(agPayload("browser_subagent"))).rule, "unmapped-tool");
  // with a build-baked --agent (none is rendered yet): its own row, and a built-in browser stays refused even for an
  // agent the browser is granted to
  assert.equal(allowed(FULL.root, ag(agPayload("mcp_playwright_browser_click"), "module-explorer")), true);
  for (const t of ["browser_subagent", "browser_click", "evaluate_script", "mcp_chrome-devtools_click"])
    assert.equal(check(ag({ toolCall: { name: t, args: {} }, workspacePaths: [FULL.root] }, "module-explorer")).rule, "unmapped-tool", `${t} for module-explorer`);
  assert.equal(check(ag(agPayload("mcp_playwright_browser_click"), "pw-ui-reviewer")).rule, "browser-none");
  // readonly: unidentified calls keep the mode rules only (D-036); outside a run nothing is in the way
  const RO = startRun();
  assert.equal(allowed(RO.root, agCall("run_command", { CommandLine: "curl -X POST https://app.acme.test/api/contacts -d '{}'" }, RO.root)), false, "readonly is unchanged");
  assert.equal(allowed(tempRoot(), agCall("define_subagent", {})), true, "no active run");
});

test("Antigravity run_command: Cwd is a base for the relative files the line writes, never the root (S8-01)", () => {
  const { root } = startRun();
  assert.deepEqual(agCall("run_command", { CommandLine: "ls", Cwd: path.join(root, "atf") }, root).cwds, [path.join(root, "atf")]);
  assert.deepEqual(agCall("run_command", { CommandLine: "ls", Cwd: "/a", cwd: "/b" }, root).cwds, ["/a", "/b"], "two cwd keys: both are read");
  assert.equal("cwds" in agCall("run_command", { CommandLine: "ls" }, root), false);
  assert.equal("cwds" in agCall("write_to_file", { TargetFile: "/w/a", Cwd: "/w" }, root), false, "only a shell runs in a cwd");
  // the validator's repro: the same line with `cd atf &&` was denied, with Cwd it was allowed
  const inAtf = agCall("run_command", { CommandLine: "echo x > atf.json", Cwd: path.join(root, "atf") }, root);
  assert.equal(checkTool(inAtf, root, {}, { framework: root }).rule, "workspace-settings");
  assert.equal(checkTool(agCall("run_command", { CommandLine: "cd atf && echo x > atf.json" }, root), root, {}, { framework: root }).rule, "workspace-settings");
  const e2e = hook(["--host", "antigravity"], { toolCall: { name: "run_command", args: { CommandLine: "echo x > atf.json", Cwd: path.join(root, "atf") } }, workspacePaths: [root] });
  assert.deepEqual([e2e.status, JSON.parse(e2e.stdout).decision], [0, "deny"]);
  assert.match(e2e.stderr, /\(workspace-settings\): atf\/atf\.json is under atf\//);
  // an installed framework (D-085), written relative to a Cwd inside it
  const fw = path.join(tempRoot(), "node_modules", "@testagentic", "atf");
  mkdirSync(path.join(fw, "scripts", "lib"), { recursive: true });
  for (const r of [root, tempRoot()])
    assert.equal(checkTool(agCall("run_command", { CommandLine: "echo x > scripts/lib/guard.mjs", Cwd: fw }, r), r, {}, { framework: fw }).rule, "framework-readonly");
  // a Cwd is still never the root: the run in the payload's workspace is the one judged
  assert.equal(antigravity.rootOf({ toolCall: { name: "run_command", args: { Cwd: tempRoot() } }, workspacePaths: [root] }), root);
});

test("Antigravity multi-root: every listed folder with an active run is judged; a decoy listed first hides none (S8-02)", () => {
  const decoy = tempRoot();
  mkdirSync(path.join(decoy, "artifacts"));
  const A = startRun();
  const B = startRun();
  assert.deepEqual(antigravity.rootsOf({ workspacePaths: [decoy, A.root] }), [A.root], "the folder with the run, not the first marked one");
  assert.equal(antigravity.rootOf({ workspacePaths: [decoy, A.root] }), A.root);
  assert.deepEqual(antigravity.rootsOf({ workspacePaths: [B.root, decoy, A.root, B.root] }), [B.root, A.root], "every active one, in the payload's order");
  const C = startRun();
  mkdirSync(path.join(C.root, "atf"));
  writeFileSync(path.join(C.root, "atf", "atf.json"), "{}");
  assert.deepEqual(antigravity.rootsOf({ workspacePaths: [decoy, path.join(C.root, "config")] }), [path.join(C.root, "config")], "a folder inside a workspace (atf/atf.json above it) with a run");
  assert.deepEqual(antigravity.rootsOf({ workspacePaths: [tempRoot(), decoy] }), [decoy], "no run anywhere: the first marked folder, as before");
  // end to end: the decoy first no longer hides the run
  const builtin = hook(["--host", "antigravity"], { toolCall: { name: "browser_subagent", args: {} }, workspacePaths: [decoy, A.root] });
  assert.deepEqual([builtin.status, JSON.parse(builtin.stdout).decision], [0, "deny"]);
  assert.match(builtin.stderr, /\(unmapped-tool\)/);
  // two runs: a call only the second one refuses is refused (an unattributed readonly write, here into B's atf/)
  const call = (paths) => ({ toolCall: { name: "write_to_file", args: { TargetFile: path.join(B.root, "atf", "permissions.yaml") } }, workspacePaths: paths });
  assert.equal(checkTool(ag(call([A.root, B.root])), A.root, {}, { framework: A.root }).allowed, true, "judged in A alone, it passes");
  const both = hook(["--host", "antigravity"], call([A.root, B.root]));
  assert.deepEqual([both.status, JSON.parse(both.stdout).decision], [0, "deny"]);
  assert.match(both.stderr, /\(workspace-settings\)/);
  assert.deepEqual([hook(["--host", "antigravity"], { toolCall: { name: "view_file", args: { AbsolutePath: path.join(B.root, "x") } }, workspacePaths: [A.root, B.root] }).stdout], [""], "allowed in both: silent");
});

test("Antigravity readonly run: an unmapped tool is refused for every caller, attributed or not (D-101 narrows D-036)", () => {
  const RO = startRun();
  const check = (c, root = RO.root) => checkTool(c, root, {}, { framework: root });
  for (const t of ["browser_subagent", "define_subagent"]) {
    const v = check(ag(agPayload(t, RO.root)));
    assert.equal(v.rule, "unmapped-tool", `${t}: unattributed`);
    assert.match(v.reason, /refused for every caller during a run, readonly included \(D-101[^)]*\); if the tool is safe, map it in scripts\/hooks\/hosts\/antigravity\.mjs$/);
    assert.equal(check(ag(agPayload(t, RO.root), "module-explorer")).rule, "unmapped-tool", `${t}: a named agent`);
  }
  for (const t of agUnmapped) assert.equal(check(agCall(t, {}, RO.root)).rule, "unmapped-tool", t);
  // the rest of readonly is unchanged: mapped tools keep the mode rules, and outside a run nothing is in the way
  for (const t of ["view_file", "ask_question", "write_to_file", "mcp_playwright_browser_click"]) assert.equal(check(ag(agPayload(t, RO.root))).allowed, true, t);
  const none = tempRoot();
  for (const t of ["browser_subagent", "define_subagent"]) assert.equal(check(ag(agPayload(t, none)), none).allowed, true, `${t}: no active run`);
  // end to end through the hook entry
  const builtin = hook(["--host", "antigravity"], agPayload("browser_subagent", RO.root));
  assert.deepEqual([builtin.status, JSON.parse(builtin.stdout).decision], [0, "deny"]);
  assert.match(builtin.stderr, /\(unmapped-tool\): 'browser_subagent' .*D-101/);
});

test("Antigravity emit: allow is silent, deny and ask are a decision on stdout with exit 0", () => {
  const capture = (verdict) => {
    const out = [];
    const err = [];
    const [o, e] = [process.stdout.write, process.stderr.write];
    process.stdout.write = (s) => out.push(String(s)) > 0;
    process.stderr.write = (s) => err.push(String(s)) > 0;
    try {
      return [antigravity.emit(verdict), out.join(""), err.join("")];
    } finally {
      [process.stdout.write, process.stderr.write] = [o, e];
    }
  };
  assert.deepEqual(capture({ decision: "allow" }), [0, "", ""], "never an auto-approve: the host's own policy still applies");
  const [code, out, err] = capture({ decision: "deny", rule: "fs-write", reason: "no" });
  assert.deepEqual([code, JSON.parse(out)], [0, { decision: "deny", reason: "Blocked by the framework guard (fs-write): no" }]);
  assert.equal(err, "Blocked by the framework guard (fs-write): no\n");
  const ask = capture({ decision: "ask", reason: "D-001 governs this file" });
  assert.deepEqual([ask[0], JSON.parse(ask[1]), ask[2]], [0, { decision: "ask", reason: "D-001 governs this file" }, ""]);
});

test("hook entry: Antigravity gets a decision on stdout with exit 0, and records the canary unidentified", () => {
  const deny = hook(["--host", "antigravity"], { ...agPayload("write_to_file"), toolCall: { name: "write_to_file", args: { TargetFile: path.join(FULL.root, "config/permissions.yaml") } } });
  assert.equal(deny.status, 0);
  assert.equal(JSON.parse(deny.stdout).decision, "deny");
  assert.match(JSON.parse(deny.stdout).reason, /^Blocked by the framework guard \(fs-write\): /);
  assert.match(deny.stderr, /\(fs-write\)/);
  assert.deepEqual([hook(["--host", "antigravity"], agPayload("write_to_file")).status, hook(["--host", "antigravity"], agPayload("write_to_file")).stdout], [0, ""], "allowed: silent");
  const builtin = hook(["--host", "antigravity"], agPayload("browser_subagent"));
  assert.deepEqual([builtin.status, JSON.parse(builtin.stdout).decision], [0, "deny"]);
  assert.match(builtin.stderr, /\(unmapped-tool\): 'browser_subagent' is not a tool the guard knows on Antigravity/);
  const { root } = startRun({ mode: "full-run", verified: false });
  const c = hook(["--host", "antigravity"], { ...agPayload("run_command", root), toolCall: { name: "run_command", args: { CommandLine: "node scripts/run.mjs guard-check acme" } } });
  assert.deepEqual([c.status, JSON.parse(c.stdout).decision], [0, "deny"]);
  assert.match(c.stderr, /\(canary\)/);
  assert.deepEqual(readdirSync(path.join(root, "artifacts/acme/state/guard-check")), ["antigravity--unidentified.json"]);
  assert.equal(guardStatus("acme", "full-run", root).ready, true, "a host without identity is verified by any block (D-037)");
  const post = spawnSync(process.execPath, [path.join(frameworkRoot, "scripts", "hooks", "posttooluse.mjs"), "--host", "antigravity"], { input: JSON.stringify(agPayload("invoke_subagent", root)), cwd: root, encoding: "utf8", env: { PATH: process.env.PATH } });
  assert.equal(post.status, 0);
  assert.ok(!existsSync(path.join(root, "artifacts", "hook-errors.jsonl")), post.stderr);
});
