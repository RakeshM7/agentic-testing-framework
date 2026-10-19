// Host adapters, the per-host rules (unidentified full-run calls, unknown tools, liveness canary) and the hook entry end to end.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { checkTool } from "./lib/guard.mjs";
import { guardStatus, markAbsent, recordCanary } from "./lib/guard-check.mjs";
import { logHookError } from "./lib/hook-log.mjs";
import { repoRoot } from "./lib/contract.mjs";
import { initRun, setStage, status } from "./run.mjs";
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

test("full-run on a host that cannot identify the caller: the run's combined permissions", () => {
  const post = "curl -X POST https://app.acme.test/api/contacts -d '{}'";
  const bash = (command) => cli({ toolName: "bash", toolArgs: { command } });
  const write = (rel) => cli({ toolName: "create", toolArgs: { path: path.join(FULL.root, rel) } });
  assert.equal(allowed(FULL.root, bash(post)), true, "some agent of the run may mutate over HTTP");
  assert.equal(allowed(FULL.root, write("playwright-tests/acme/pages/contacts.page.ts")), true);
  const outside = checkTool(write("config/permissions.yaml"), FULL.root, {});
  assert.equal(outside.rule, "fs-write", "no agent of the run may write the framework's own files");
  assert.match(outside.reason, /Copilot CLI cannot tell the guard which agent is calling, so it allows what at least one of this run's agents may do/);
  assert.equal(checkTool(bash("curl -X DELETE https://app.acme.test/api/contacts/1"), FULL.root, {}).rule, "delete-not-owned", "deletes stay ledger-scoped");
  const spawn = (agent_type) => allowed(FULL.root, cli({ toolName: "task", toolArgs: { agent_type, prompt: "x" } }));
  assert.deepEqual([spawn("orchestrator-agent"), spawn("pw-ui-fixer"), spawn("feedback-implementor-agent")], [true, true, false], "the chat may start the entry agent; agents outside a run stay out");
  assert.equal(checkTool(cli({ toolName: "write_bash", toolArgs: { shellId: "1", input: post } }), FULL.root, {}).rule, "unmapped-tool");
  assert.equal(allowed(FULL.root, cli({ toolName: "read_bash", toolArgs: { shellId: "1" } })), true);
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
  assert.match(checkTool(write, FULL.root, {}).reason, /VS Code chat on its Copilot CLI engine cannot tell the guard which agent is calling/);

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
  assert.equal(checkTool(unknown("pw-ui-fixer"), FULL.root, {}).rule, "unmapped-tool");
  assert.equal(allowed(FULL.root, unknown(undefined)), true);
  assert.equal(allowed(tempRoot(), unknown("pw-ui-fixer")), true, "no active run");
  const noPath = vscode("pw-ui-fixer", { tool_name: "create_file", tool_input: {} });
  assert.equal(checkTool(noPath, FULL.root, {}).rule, "fs-write", "a write whose target is unknown is refused");
});

test("a Copilot block of the canary (exit 2, shown by the host as 'hook errored') shows as guard.ready in run.mjs status", async () => {
  const { root } = startRun({ verified: false });
  assert.equal((await status("acme", { root })).guard.ready, false, "nothing recorded yet");
  const r = spawnSync(process.execPath, [path.join(repoRoot, "scripts", "hooks", "pretooluse.mjs"), "--host", "copilot"], { input: JSON.stringify({ cwd: root, toolName: "powershell", toolArgs: { command: "node scripts/run.mjs guard-check acme" } }), cwd: root, encoding: "utf8", env: { PATH: process.env.PATH } });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /\(canary\)/);
  assert.deepEqual((await status("acme", { root })).guard, { ready: true });
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

test("run.mjs init accepts full-run on every host and records where it started", () => {
  const root = tempRoot();
  const r = initRun(writeConfig(root, { mode: "full-run" }), { root, env: { GITHUB_ACTIONS: "true" } });
  assert.equal(r.errors, undefined);
  assert.deepEqual([r.run.mode, r.run.startedOnHost], ["full-run", "copilot-cloud"]);
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

test("hook entry: Copilot CLI gets a deny decision on stdout and exit 2", () => {
  const r = hook(["--host", "copilot"], { cwd: FULL.root, toolName: "create", toolArgs: { path: path.join(FULL.root, "config/permissions.yaml") } });
  assert.equal(r.status, 2);
  assert.equal(JSON.parse(r.stdout).permissionDecision, "deny");
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
  const idle = spawnSync(process.execPath, [path.join(repoRoot, "scripts", "hooks", "pretooluse.mjs"), "--host", "copilot"], { input: "not json", cwd: tempRoot(), encoding: "utf8", env: { PATH: process.env.PATH } });
  assert.equal(idle.status, 0, "no run: cwd has no artifacts/ lock");
  const r = spawnSync(process.execPath, [path.join(repoRoot, "scripts", "hooks", "pretooluse.mjs"), "--host", "copilot"], { input: "not json", cwd: FULL.root, encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /failing closed/);
  const v = spawnSync(process.execPath, [path.join(repoRoot, "scripts", "hooks", "pretooluse.mjs"), "--host", "vscode"], { input: "not json", cwd: FULL.root, encoding: "utf8" });
  assert.deepEqual([v.status, JSON.parse(v.stdout).hookSpecificOutput.permissionDecision], [0, "deny"], "VS Code: in its own format");
  assert.equal(hook(["--host", "nonsense"], { cwd: FULL.root, tool_name: "Bash", tool_input: {} }, { CLAUDE_PROJECT_DIR: FULL.root }).status, 2);
});

test("hook errors are logged with their stack and context, blocked or not, PreToolUse and PostToolUse (D-065)", () => {
  const entries = (root) => readFileSync(path.join(root, "artifacts", "hook-errors.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const { root } = startRun();
  const r = spawnSync(process.execPath, [path.join(repoRoot, "scripts", "hooks", "pretooluse.mjs"), "--host", "copilot"], { input: "not json", cwd: root, encoding: "utf8", env: { PATH: process.env.PATH } });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /details in .*hook-errors\.jsonl/);
  const [blocked] = entries(root);
  assert.deepEqual([blocked.hook, blocked.host, blocked.outcome, blocked.raw], ["pretooluse", "copilot", "blocked: a run is active", "not json"]);
  assert.match(blocked.stack, /SyntaxError/);

  const idle = tempRoot();
  const i = spawnSync(process.execPath, [path.join(repoRoot, "scripts", "hooks", "pretooluse.mjs"), "--host", "copilot"], { input: "not json", cwd: idle, encoding: "utf8", env: { PATH: process.env.PATH } });
  assert.equal(i.status, 0);
  assert.match(i.stderr, /no run is active, so the call is allowed; details in/);
  assert.equal(entries(idle)[0].outcome, "allowed: no active run");

  const post = spawnSync(process.execPath, [path.join(repoRoot, "scripts", "hooks", "posttooluse.mjs"), "--host", "nonsense"], { input: "{}", cwd: idle, encoding: "utf8", env: { PATH: process.env.PATH } });
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
  copyFileSync(path.join(repoRoot, "scripts", "hooks", "pretooluse.mjs"), entry); // no hosts/ beside it
  const run = (...args) => spawnSync(process.execPath, [entry, ...args], { input: "{}", cwd: FULL.root, encoding: "utf8", env: { PATH: process.env.PATH } });
  const v = run("--host", "vscode", "--agent", "orchestrator-agent");
  assert.equal(v.status, 0);
  assert.match(JSON.parse(v.stdout).hookSpecificOutput.permissionDecisionReason, /failing closed/);
  assert.equal(run("--host=vscode").status, 0);
  assert.deepEqual([run("--host", "claude-code").status, run("--host", "copilot").status, run("--host", "vscode-x").status], [2, 2, 2]);
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

test("hook registrations: the .claude/settings.json command reaches the entry from bash and from PowerShell", () => {
  // Copilot CLI and VS Code's Copilot CLI engine also run it ("repo settings"), through PowerShell on Windows, from the
  // repo root and without CLAUDE_PROJECT_DIR. A bash-only path there crashed node before the guard ran ("hook errored").
  const { hooks } = JSON.parse(readFileSync(path.join(repoRoot, ".claude", "settings.json"), "utf8"));
  const command = hooks.PreToolUse[0].hooks[0].command;
  const input = JSON.stringify({ tool_name: "Read", tool_input: { file_path: "README.md" } });
  const { CLAUDE_PROJECT_DIR, ...env } = process.env;
  const reached = (r, shell) => {
    assert.doesNotMatch(r.stderr ?? "", /Cannot find module/, `${shell}: ${r.stderr}`);
    assert.notEqual(r.status, 1, `${shell}: ${r.stderr}`);
  };
  const gitBash = path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "bin", "bash.exe");
  const bash = process.platform === "win32" ? (existsSync(gitBash) ? gitBash : undefined) : "bash";
  if (bash) reached(spawnSync(bash, ["-c", command], { cwd: tempRoot(), input, encoding: "utf8", env: { ...env, CLAUDE_PROJECT_DIR: repoRoot } }), "bash");
  if (process.platform === "win32")
    reached(spawnSync("powershell.exe", ["-NoProfile", "-Command", command], { cwd: repoRoot, input, encoding: "utf8", env }), "powershell");
});

test("hook entries read a payload that starts with a BOM (Windows PowerShell 5.1 relays stdin with one)", () => {
  const bom = (payload) => `\uFEFF${JSON.stringify(payload)}`;
  const r = hook(["--host", "claude-code"], bom({ tool_name: "Bash", tool_input: { command: "curl -X POST https://x/api" } }), { CLAUDE_PROJECT_DIR: FULL.root, AUTHORIZATIONS_MODE: "readonly" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /http-mutate/, "judged by the guard, not failed closed");
  const root = tempRoot();
  const post = spawnSync(process.execPath, [path.join(repoRoot, "scripts", "hooks", "posttooluse.mjs"), "--host", "copilot"], { input: bom({ cwd: root, toolName: "bash", toolArgs: {} }), cwd: root, encoding: "utf8", env: { PATH: process.env.PATH } });
  assert.equal(post.status, 0);
  assert.ok(!existsSync(path.join(root, "artifacts", "hook-errors.jsonl")), post.stderr);
});
