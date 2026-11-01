// The Codex host (CLI, app, IDE extension): its hook adapter, host entry and the per-host rules (identity none, unknown
// tools refused during every run), and the hook entries end to end. Built from Codex's documentation; the payloads are
// `documented` fixtures until the spike (docs/codex-spike/) captures live ones.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { checkTool } from "./lib/guard.mjs";
import { guardStatus } from "./lib/guard-check.mjs";
import { frameworkRoot } from "./lib/contract.mjs";
import { HOSTS, canIdentify, deniesUnknownInRun, detectShellHost, identityOf, labelOf, resolveHost } from "./lib/hosts.mjs";
import { readSpawns } from "./lib/telemetry.mjs";
import * as codex from "./hooks/hosts/codex.mjs";
import * as antigravity from "./hooks/hosts/antigravity.mjs";
import * as copilot from "./hooks/hosts/copilot.mjs";
import { adapterFor } from "./hooks/hosts/index.mjs";
import { startRun, tempRoot } from "./test-helpers.mjs";

const FULL = startRun({ mode: "full-run" });
const RO = startRun();
const FIXTURES = new URL("./fixtures/hooks/", import.meta.url);
// A documented payload with `{root}` standing for the workspace (JSON-escaped, so a Windows path stays one string).
const cxPayload = (tool, root = FULL.root) =>
  JSON.parse(readFileSync(new URL(`codex-documented-${tool}.json`, FIXTURES), "utf8").replaceAll("{root}", JSON.stringify(root).slice(1, -1)));
const cx = (payload, agent) => codex.normalize(payload, { env: {}, host: "codex", agent });
const call = (tool, input, root = FULL.root, extra = {}) => cx({ session_id: "cx-sess-0001", cwd: root, tool_name: tool, tool_input: input, ...extra });
// the same with no session directory in the payload: the names exactly as the call gives them (the session-directory
// bases are their own test)
const bare = (tool, input) => cx({ session_id: "cx-sess-0001", tool_name: tool, tool_input: input });
const patch = (...lines) => `*** Begin Patch\n${lines.join("\n")}\n*** End Patch\n`;
const check = (c, root = FULL.root) => checkTool(c, root, {}, { framework: root });
const allowed = (c, root = FULL.root) => check(c, root).allowed;
const hook = (args, payload, env = {}) =>
  spawnSync(process.execPath, [path.join(frameworkRoot, "scripts", "hooks", "pretooluse.mjs"), ...args], { input: typeof payload === "string" ? payload : JSON.stringify(payload), encoding: "utf8", env: { PATH: process.env.PATH, ...env } });
const capture = (verdict) => {
  const out = [];
  const err = [];
  const [o, e] = [process.stdout.write, process.stderr.write];
  process.stdout.write = (s) => out.push(String(s)) > 0;
  process.stderr.write = (s) => err.push(String(s)) > 0;
  try {
    return [codex.emit(verdict), out.join(""), err.join("")];
  } finally {
    [process.stdout.write, process.stderr.write] = [o, e];
  }
};

// ---- the adapter -------------------------------------------------------------------------------------------------
test("Codex adapter: every documented payload normalizes to its canonical call", () => {
  const at = (rel) => `${FULL.root}/${rel}`;
  const expected = {
    Bash: { kind: "shell", command: "node scripts/run.mjs status acme", cwds: [FULL.root] },
    exec_command: { kind: "shell", command: "node scripts/run.mjs status acme", cwds: [FULL.root] },
    apply_patch: { kind: "write", paths: [at("playwright-tests/acme/pages/contacts/contacts.page.ts")] },
    "mcp__playwright__browser_click": { kind: "browser", browserAction: "click" },
    spawn_agent: { kind: "spawn", subagent: "pw-ui-fixer" },
    update_plan: { kind: "other" },
    view_image: { kind: "read" },
    computer_use: { kind: "unknown" },
  };
  const files = readdirSync(FIXTURES).filter((f) => f.startsWith("codex-")).sort();
  assert.deepEqual(files, Object.keys(expected).map((t) => `codex-documented-${t}.json`).sort(), "one fixture per mapped tool, plus an unknown one");
  for (const [tool, want] of Object.entries(expected)) {
    const payload = cxPayload(tool);
    const c = cx(payload);
    const wantAll = { host: "codex", agent: undefined, tool, command: undefined, paths: [], urls: [], subagent: undefined, browserAction: undefined, sessionId: "cx-sess-0001", ...want };
    const { cwds, ...rest } = c;
    assert.deepEqual({ ...rest, cwds }, { ...wantAll, ...(want.cwds ? {} : { cwds: undefined }) }, tool);
    assert.equal(codex.rootOf(payload), FULL.root, `${tool}: the workspace from cwd`);
  }
  assert.equal(codex.rootOf({}), process.cwd());
  assert.equal(codex.rootOf(null), process.cwd());
  assert.equal(codex.rootOf({ cwd: 7 }), process.cwd());
});

test("Codex adapter: shell commands as a string, an argv array, or under either key; a shell without a command is unknown", () => {
  const shell = (input, tool = "Bash") => bare(tool, input);
  assert.equal(shell({ command: "ls -la" }).command, "ls -la");
  assert.equal(shell({ command: "ls -la" }, "exec_command").kind, "shell");
  for (const sh of ["bash", "sh", "zsh", "/bin/bash", "/usr/bin/zsh", "/opt/homebrew/bin/sh", "C:\\Git\\bin\\bash"])
    for (const flag of ["-lc", "-c"]) assert.equal(shell({ command: [sh, flag, "echo hi > a.txt"] }).command, "echo hi > a.txt", `${sh} ${flag}`);
  // anything else is joined with spaces, so the guard reads the whole line
  assert.equal(shell({ command: ["bash", "-lc", "echo hi", "extra"] }).command, "bash -lc echo hi extra");
  assert.equal(shell({ command: ["bash", "-x", "echo hi"] }).command, "bash -x echo hi");
  assert.equal(shell({ command: ["fish", "-c", "echo hi"] }).command, "fish -c echo hi");
  assert.equal(shell({ command: ["mybash", "-lc", "echo hi"] }).command, "mybash -lc echo hi");
  assert.equal(shell({ command: ["git", "status"] }).command, "git status");
  // the exec_command spelling of the key, and two keys that disagree: both are judged
  assert.equal(shell({ cmd: "ls" }, "exec_command").command, "ls");
  assert.equal(shell({ command: "ls", cmd: "ls" }, "exec_command").command, "ls");
  assert.equal(shell({ command: "ls", cmd: "rm -rf x" }, "exec_command").command, "ls ; rm -rf x");
  // no command under a key the adapter knows: unknown, never an empty line
  for (const input of [{}, { command: "" }, { command: [] }, { command: 7 }, { command: null }, { script: "ls" }]) assert.equal(shell(input).kind, "unknown", JSON.stringify(input));
  assert.equal(bare("Bash", undefined).kind, "unknown");
  assert.equal(bare("Bash", "ls -la").command, "ls -la", "a bare string input is the command");
  // workdir and cwd are an extra base for relative writes (cwds), never the root
  assert.deepEqual(shell({ command: "ls", workdir: "/w/atf" }).cwds, ["/w/atf"]);
  assert.deepEqual(shell({ command: "ls", cwd: "/w/atf" }).cwds, ["/w/atf"]);
  assert.deepEqual(shell({ command: "ls", workdir: "/a", cwd: "/b" }).cwds, ["/a", "/b"], "two keys: both read");
  assert.equal("cwds" in shell({ command: "ls" }), false);
  assert.equal("cwds" in bare("apply_patch", { command: patch("*** Add File: a.txt"), workdir: "/w" }), false, "only a shell runs in a cwd");
  assert.equal(codex.rootOf({ cwd: FULL.root, tool_input: { workdir: "/elsewhere" } }), FULL.root);
  // a patch fed through a shell writes files no shell heuristic sees: unknown, so refused during a run
  for (const command of ["apply_patch <<'EOF'\n*** Begin Patch\n*** Update File: atf/atf.json\n*** End Patch\nEOF", ["apply_patch", patch("*** Add File: x.ts")], ["bash", "-lc", "apply_patch <<EOF\n*** Add File: x.ts\nEOF"]])
    assert.equal(shell({ command }).kind, "unknown", JSON.stringify(command));
});

test("Codex adapter: apply_patch paths come from the patch text", () => {
  const paths = (input) => bare("apply_patch", input).paths;
  assert.deepEqual(
    paths({ command: patch("*** Add File: a/new.ts", "+x", "*** Update File: b/old.ts", "@@", "-1", "+2", "*** Delete File: c/gone.ts", "*** Update File: d/from.ts", "*** Move to: d/to.ts") }),
    ["a/new.ts", "b/old.ts", "c/gone.ts", "d/from.ts", "d/to.ts"]
  );
  // CRLF, bare CR, leading spaces, trailing spaces and tabs
  assert.deepEqual(paths({ command: "*** Begin Patch\r\n*** Add File: a.ts\r\n+x\r\n*** Delete File:   b.ts  \r\n*** End Patch\r\n" }), ["a.ts", "b.ts"]);
  assert.deepEqual(paths({ command: "*** Begin Patch\r*** Add File: a.ts\r*** Move to: b.ts\r" }), ["a.ts", "b.ts"]);
  assert.deepEqual(paths({ command: "  *** Begin Patch\n   *** Update File: a.ts\n\t*** Move to:\tb.ts\t\n" }), ["a.ts", "b.ts"]);
  // body lines are not headers, and a patch naming no file gives no paths (a write with no target: refused for a managed caller)
  assert.deepEqual(paths({ command: patch("*** Update File: a.ts", "@@", "+*** Add File: not-a-header.ts", "-*** Delete File: nor-this.ts") }), ["a.ts"]);
  assert.deepEqual(paths({ command: patch("@@", "+x") }), []);
  assert.deepEqual(paths({ command: "" }), []);
  assert.deepEqual(paths({}), []);
  assert.deepEqual(paths({ command: 42 }), []);
  assert.deepEqual(paths({ command: patch("*** Add File:") }), [], "an empty path is no path");
  // the patch under another key, as an argv array, or as the bare input
  assert.deepEqual(paths({ patch: patch("*** Add File: a.ts") }), ["a.ts"]);
  assert.deepEqual(paths({ input: patch("*** Add File: a.ts") }), ["a.ts"]);
  assert.deepEqual(paths({ command: ["apply_patch", patch("*** Add File: a.ts")] }), ["a.ts"]);
  assert.deepEqual(paths(patch("*** Add File: a.ts")), ["a.ts"], "a bare string tool_input");
  // two keys with different patches: every file of both is judged, so a decoy hides none
  assert.deepEqual(paths({ command: patch("*** Add File: decoy.ts"), patch: patch("*** Add File: atf/atf.json") }), ["decoy.ts", "atf/atf.json"]);
  assert.deepEqual(paths({ command: patch("*** Add File: a.ts"), patch: patch("*** Add File: a.ts") }), ["a.ts"], "no duplicates");
  assert.equal(codex.patchPaths("*** Add File: x\n*** Update File: y").length, 2);
});

test("Codex adapter: only Playwright MCP tools in the mcp__ form are browser tools", () => {
  const tool = (name) => {
    const c = call(name, {});
    return [c.kind, c.browserAction];
  };
  for (const name of ["click", "type", "fill_form", "navigate", "evaluate", "snapshot", "run_code_unsafe", "close"]) assert.deepEqual(tool(`mcp__playwright__browser_${name}`), ["browser", name]);
  assert.deepEqual(tool("mcp__my-playwright__browser_click"), ["browser", "click"]);
  for (const t of [
    "mcp_playwright_browser_click", "playwright__browser_click", "mcp__playwright__click", "mcp__playwright__browser_", "mcp__playwright__browser_a-b", "mcp__other__browser_click",
    "mcp__chrome-devtools__click", "mcp__my_playwright__browser_click", "mcp__playwright__evaluate_script", "mcp__playwright__browser_a\nb", "mcp__play\nwright__browser_click",
    "mcp____browser_click", "browser_click", "mcp__playwright", "mcp__", "mcp__github__create_issue",
  ])
    assert.deepEqual(tool(t), ["unknown", undefined], JSON.stringify(t));
  // linear time on long adversarial names
  const n = 200_000;
  for (const name of [`mcp__${"playwright".repeat(n / 10)}!`, `mcp__${"playwright__browser_".repeat(n / 20)}!`, `mcp__playwright${"__browser_".repeat(n / 10)}`, `mcp__${"a-".repeat(n)}__browser_${"x".repeat(n)}!`]) {
    const t = performance.now();
    const c = call(name, {});
    const ms = performance.now() - t;
    assert.ok(ms < 250, `${ms.toFixed(0)} ms for a ${name.length}-character name`);
    // a name that is all word characters after the first `__browser_` is a Playwright tool the guard classifies by its
    // short name, as on the other hosts; the others are unknown
    assert.equal(c.kind, name.endsWith("!") ? "unknown" : "browser");
  }
});

test("Codex adapter: spawn_agent names its subagent under tolerant keys; two different names name none", () => {
  const sub = (input) => call("spawn_agent", input).subagent;
  for (const key of ["agent_type", "agent", "name", "agent_name", "subagent_type", "role"]) assert.equal(sub({ [key]: "pw-ui-fixer", message: "x" }), "pw-ui-fixer", key);
  assert.equal(sub({ agent_type: "pw-ui-fixer", name: "pw-ui-fixer" }), "pw-ui-fixer", "the same name twice is one name");
  assert.equal(sub({ agent_type: "pw-ui-fixer", name: "feedback-implementor-agent" }), undefined, "two names: none, so the guard refuses the spawn");
  assert.equal(sub({ agent_type: "pw-ui-fixer", role: "worker" }), undefined);
  assert.equal(sub({ message: "no agent named" }), undefined);
  assert.equal(sub({ agent_type: 7 }), undefined);
  assert.equal(sub({ agent_type: "" }), undefined);
  assert.equal(sub({}), undefined);
  assert.equal(call("update_plan", { agent_type: "pw-ui-fixer" }).subagent, undefined, "only a spawn names a subagent");
});

test("Codex adapter: the agent is never read from the payload; the session id is", () => {
  for (const extra of [{ agent_type: "orchestrator-agent" }, { agent: "pw-ui-fixer" }, { agentType: "x" }, { subagent: "x" }, { tool_input: { agent_type: "orchestrator-agent", command: "ls", agent: "pw-ui-fixer" } }])
    assert.equal(call("Bash", { command: "ls" }, FULL.root, extra).agent, undefined, JSON.stringify(extra));
  assert.equal(cx({ tool_name: "Bash", tool_input: { command: "ls" } }, "pw-ui-fixer").agent, "pw-ui-fixer", "only a build-baked --agent names the caller");
  assert.equal(call("Bash", { command: "ls" }).sessionId, "cx-sess-0001");
  assert.equal(cx({ tool_name: "Bash", tool_input: { command: "ls" }, sessionId: "camel", conversationId: "c" }).sessionId, undefined, "session_id only");
  assert.equal(cx({ tool_name: "Bash", tool_input: { command: "ls" }, session_id: 5 }).sessionId, undefined);
  // unmapped names, aliases the docs only mention, and a payload with no tool
  for (const t of ["web_search", "WebSearch", "computer_use", "Edit", "Write", "Agent", "shell", "local_shell", "read_file", "Read", "request_user_input", "apply_patch ", "bash", "__proto__", "toString", ""])
    assert.equal(call(t, {}).kind, "unknown", JSON.stringify(t));
  assert.equal(cx({}).kind, "unknown");
  assert.equal(cx(null).kind, "unknown");
  assert.equal(cx({ tool_name: "Bash", tool_input: ["ls"] }).kind, "unknown");
});

// ---- the host ----------------------------------------------------------------------------------------------------
test("Codex host: identity none (D-035), unknown tools refused in a run (D-101), asserted by its registration, never inferred", () => {
  assert.deepEqual([identityOf("codex"), labelOf("codex"), canIdentify("codex")], ["none", "Codex", false]);
  assert.equal(HOSTS.codex.unknownTools, "deny-in-run");
  assert.equal(deniesUnknownInRun("codex"), true);
  for (const h of ["claude-code", "vscode", "copilot-cli", "copilot-cloud", "vscode-agent-host", "unknown"]) assert.equal(deniesUnknownInRun(h), false, `${h}: D-036 as recorded`);
  assert.equal(resolveHost("codex", {}), "codex");
  assert.equal(resolveHost("codex", { CLAUDE_PROJECT_DIR: "/w", GITHUB_ACTIONS: "true", CLAUDECODE: "1" }), "codex");
  assert.equal(detectShellHost({}), "unknown", "no documented Codex environment variable yet");
  assert.equal(cx({ tool_name: "Bash", tool_input: { command: "ls" } }).host, "codex");
  assert.equal(codex.normalize({ tool_name: "Bash", tool_input: { command: "ls" } }, { env: {} }).host, "codex", "the default host");
  assert.equal(codex.normalize({ tool_name: "Bash", tool_input: { command: "ls" } }, { env: {}, host: "claude-code" }).host, "unknown", "an assertion the host list doesn't know grants nothing");
});

test("Codex host: the hook entry loads the adapter, and a missing one is refused", async () => {
  const mod = await adapterFor("codex");
  assert.equal(mod.normalize, codex.normalize);
  assert.throws(() => adapterFor("codex-x"), /unknown --host 'codex-x' \(one of: .*\bcodex\b/);
});

// ---- the guard's rules on this host ------------------------------------------------------------------------------
test("Codex full-run: the run's combined ceiling for an unidentified caller (D-035)", () => {
  const pom = path.join(FULL.root, "playwright-tests/acme/pages/contacts.page.ts");
  assert.equal(allowed(cx(cxPayload("apply_patch"))), true, "a page object, some agent of the run may write it");
  assert.equal(allowed(call("apply_patch", { command: patch(`*** Add File: ${pom}`, "+x") })), true);
  const outside = check(call("apply_patch", { command: patch(`*** Update File: ${path.join(FULL.root, "config/permissions.yaml")}`, "@@", "+x") }));
  assert.equal(outside.rule, "fs-write", "no agent of the run may write the framework's own files");
  assert.match(outside.reason, /Codex cannot tell the guard which agent is calling, so it allows what at least one of this run's agents may do/);
  assert.equal(check(call("apply_patch", { command: patch("@@", "+x") })).rule, "fs-write", "a patch naming no file is a write with no target: refused");
  // one file outside the allowed paths refuses the whole patch, wherever it sits in it
  assert.equal(check(call("apply_patch", { command: patch(`*** Add File: ${pom}`, "+x", "*** Delete File: config/permissions.yaml") })).rule, "fs-write");
  assert.equal(check(call("apply_patch", { command: patch(`*** Update File: ${pom}`, "*** Move to: config/permissions.yaml") })).rule, "fs-write", "a move's destination counts");
  for (const rel of ["atf/atf.json", "atf/permissions.yaml"]) assert.equal(check(call("apply_patch", { command: patch(`*** Add File: ${rel}`, "+{}") })).rule, "workspace-settings", rel);
  assert.equal(allowed(call("Bash", { command: "curl -X POST https://app.acme.test/api/contacts -d '{}'" })), true, "some agent of the run may mutate over HTTP");
  assert.equal(check(call("Bash", { command: "curl -X DELETE https://app.acme.test/api/contacts/1" })).rule, "delete-not-owned", "deletes stay ledger-scoped");
  assert.equal(check(call("Bash", { command: ["bash", "-lc", "curl -X DELETE https://app.acme.test/api/contacts/1"] })).rule, "delete-not-owned", "an argv array is judged as its script");
  assert.equal(check(call("Bash", { command: ["curl", "-X", "DELETE", "https://app.acme.test/api/contacts/1"] })).rule, "delete-not-owned");
  for (const tool of ["Bash", "exec_command"])
    assert.equal(check(call(tool, { command: "ls", cmd: "curl -X DELETE https://app.acme.test/api/contacts/1" })).rule, "delete-not-owned", `${tool}: two command keys, both judged`);
  // a shell's workdir is a base for the relative files it writes, never the root
  const inAtf = call("Bash", { command: "echo x > atf.json", workdir: path.join(FULL.root, "atf") });
  assert.equal(check(inAtf).rule, "workspace-settings");
  assert.equal(check(call("Bash", { command: "cd atf && echo x > atf.json" })).rule, "workspace-settings");
  assert.equal(allowed(call("Bash", { command: "echo x > notes.txt", workdir: path.join(FULL.root, "artifacts") })), true);
  assert.equal(allowed(cx(cxPayload("mcp__playwright__browser_click"))), true);
  for (const t of ["Bash", "update_plan", "view_image"]) assert.equal(allowed(cx(cxPayload(t))), true, t);
  // a human-only action stays human-only
  assert.equal(check(call("Bash", { command: "node scripts/testcases.mjs approve acme contacts" })).rule, "human-only");
  assert.equal(check(call("apply_patch", { command: patch("*** Add File: artifacts/acme/state/sweep-confirm.json", "+{}") })).rule, "human-only");
  // with a build-baked --agent (none is rendered): its own row
  assert.equal(allowed(cx(cxPayload("mcp__playwright__browser_click"), "module-explorer")), true);
  assert.equal(check(cx(cxPayload("mcp__playwright__browser_click"), "pw-ui-reviewer")).rule, "browser-none");
});

test("Codex: the main session's spawn of orchestrator-agent, in a readonly and a full-run run", () => {
  const spawn = (agent_type, root = FULL.root, extra = {}) => call("spawn_agent", { agent_type, message: "x", ...extra }, root);
  // full-run: the entry agent is in the combined ceiling's spawn list (D-035), agents outside the run and ambiguous spawns are not
  assert.equal(allowed(spawn("orchestrator-agent")), true, "the main session starts the entry agent");
  assert.equal(allowed(spawn("pw-ui-fixer")), true, "the unidentified caller may be an orchestrator, so its workers are in the ceiling");
  assert.equal(check(spawn("feedback-implementor-agent")).rule, "spawn");
  assert.equal(check(spawn("no-such-worker")).rule, "spawn");
  assert.equal(check(spawn("orchestrator-agent", FULL.root, { name: "feedback-implementor-agent" })).rule, "spawn", "two names: refused");
  assert.equal(check(spawn(undefined)).rule, "spawn", "a spawn naming nobody is refused");
  assert.match(check(spawn("feedback-implementor-agent")).reason, /Codex cannot tell the guard which agent is calling/);
  // readonly: an unidentified caller gets the mode rules only (D-036), and a spawn has none: every spawn is allowed, as on Antigravity
  for (const a of ["orchestrator-agent", "pw-ui-fixer", "feedback-implementor-agent", undefined]) assert.equal(allowed(spawn(a, RO.root), RO.root), true, `readonly: ${a}`);
  // the same verdicts as Antigravity, the other host with identity none and no per-agent hook
  const viaAntigravity = (name, root) => {
    const c = antigravity.normalize({ toolCall: { name: "invoke_subagent", args: { Name: name } }, workspacePaths: [root] }, { env: {}, host: "antigravity" });
    return checkTool(c, root, {}, { framework: root });
  };
  for (const a of ["orchestrator-agent", "pw-ui-fixer", "feedback-implementor-agent", "no-such-worker"])
    for (const run of [RO, FULL]) {
      const [x, y] = [check(spawn(a, run.root), run.root), viaAntigravity(a, run.root)];
      assert.deepEqual([x.allowed, x.rule], [y.allowed, y.rule], `${run === RO ? "readonly" : "full-run"}: ${a}`);
    }
});

test("Codex: every verdict matches another identity-none host's for the same operation, readonly and full-run", () => {
  const viaCopilot = (tool, input, root) => checkTool(copilot.normalize({ tool_name: tool, tool_input: input }, { env: {}, host: "copilot" }), root, {}, { framework: root });
  const mutate = "curl -X POST https://app.acme.test/api/contacts";
  const remove = "curl -X DELETE https://app.acme.test/api/contacts/1";
  for (const run of [RO, FULL]) {
    const root = run.root;
    const ops = [
      ["apply_patch", { command: patch(`*** Add File: ${root}/playwright-tests/acme/pages/p.ts`, "+x") }, "Edit", patch(`*** Add File: ${root}/playwright-tests/acme/pages/p.ts`, "+x")],
      ["apply_patch", { command: patch("*** Add File: config/permissions.yaml", "+x") }, "Edit", patch("*** Add File: config/permissions.yaml", "+x")],
      ["apply_patch", { command: patch("*** Add File: atf/atf.json", "+x") }, "Edit", patch("*** Add File: atf/atf.json", "+x")],
      ["apply_patch", { command: patch("@@", "+x") }, "Edit", patch("@@", "+x")],
      ["Bash", { command: mutate }, "Bash", { command: mutate }],
      ["Bash", { command: remove }, "Bash", { command: remove }],
      ["Bash", { command: "git status" }, "Bash", { command: "git status" }],
      ["mcp__playwright__browser_click", {}, "mcp__playwright__browser_click", {}],
      ["mcp__playwright__browser_navigate", {}, "mcp__playwright__browser_navigate", {}],
      ["update_plan", {}, "TodoWrite", {}],
      ["view_image", { path: "x.png" }, "view_image", { path: "x.png" }],
      ["spawn_agent", { agent_type: "orchestrator-agent" }, "Task", { subagent_type: "orchestrator-agent" }],
      ["spawn_agent", { agent_type: "feedback-implementor-agent" }, "Task", { subagent_type: "feedback-implementor-agent" }],
    ];
    ops.forEach(([tool, input, otherTool, otherInput], i) => {
      const [x, y] = [check(call(tool, input, root), root), viaCopilot(otherTool, otherInput, root)];
      assert.deepEqual([x.allowed, x.rule], [y.allowed, y.rule], `${run === RO ? "readonly" : "full-run"}: ${tool} #${i}`);
    });
  }
});

test("Codex: during a run an unclassified tool is refused for every caller, readonly and full-run alike (D-101)", () => {
  const unknownTools = ["web_search", "WebSearch", "computer_use", "browser_use", "request_permissions", "mcp__github__create_issue", "mcp__chrome-devtools__click", "mcp__other__browser_click", "mcp_playwright_browser_click", "mcp__playwright__evaluate", "Edit", "Agent"];
  for (const run of [RO, FULL]) {
    const root = run.root;
    for (const t of unknownTools) {
      for (const agent of [undefined, "module-explorer", "pw-ui-reviewer", "orchestrator-agent"]) {
        const v = check(cx({ tool_name: t, cwd: root, tool_input: {} }, agent), root);
        assert.equal(v.rule, "unmapped-tool", `${run === RO ? "readonly" : "full-run"} ${agent ?? "unidentified"} ${t}`);
        assert.match(v.reason, /is not a tool the guard knows on Codex, and there an unrecognised tool is refused for every caller during a run, readonly included \(D-101[^)]*\); if the tool is safe, map it in scripts\/hooks\/hosts\/codex\.mjs$/);
      }
    }
    // a shell with no command or a patch fed to a shell is a call the adapter can't judge
    assert.equal(check(call("Bash", {}, root), root).rule, "unmapped-tool");
    assert.equal(check(call("Bash", { command: "apply_patch <<EOF\n*** Begin Patch\n*** Add File: atf/atf.json\n+{}\n*** End Patch\nEOF" }, root), root).rule, "unmapped-tool");
  }
  // the mapped tools keep the mode rules, and outside a run nothing is in the way
  for (const t of ["update_plan", "view_image", "Bash"]) assert.equal(allowed(cx(cxPayload(t, RO.root)), RO.root), true, `readonly ${t}`);
  assert.equal(allowed(call("mcp__playwright__browser_snapshot", {}, RO.root), RO.root), true);
  assert.equal(allowed(call("Bash", { command: "curl -X POST https://app.acme.test/api/contacts" }, RO.root), RO.root), false, "readonly keeps its shell rules");
  const none = tempRoot();
  for (const t of unknownTools) assert.equal(allowed(call(t, {}, none), none), true, `${t}: no active run, a human's own session`);
});

// ---- output ------------------------------------------------------------------------------------------------------
test("Codex emit: allow is silent; deny is a decision on stdout with exit 0, and on stderr; ask is a deny that says why", () => {
  assert.deepEqual(capture({ decision: "allow" }), [0, "", ""], "never an auto-approve: the host's own policy still applies");
  const message = "Blocked by the framework guard (fs-write): no";
  const [code, out, err] = capture({ decision: "deny", rule: "fs-write", reason: "no" });
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(out), { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: message } });
  assert.equal(out, JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: message } }), "exactly the documented keys");
  assert.equal(err, `${message}\n`);
  const [askCode, askOut, askErr] = capture({ decision: "ask", reason: "D-001 governs this file" });
  const reason = "Needs the user's confirmation, which Codex hooks can't ask for: D-001 governs this file";
  assert.equal(askCode, 0);
  assert.deepEqual(JSON.parse(askOut), { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } });
  assert.equal(askErr, `${reason}\n`);
  assert.equal(JSON.parse(askOut).hookSpecificOutput.permissionDecision, "deny", "Codex doesn't support ask, so it is never emitted");
});

test("hook entry: Codex gets a deny decision on stdout with exit 0, allow is silent, and the canary is recorded unidentified", () => {
  const deny = hook(["--host", "codex"], cx_(FULL.root, "apply_patch", { command: patch("*** Update File: config/permissions.yaml", "@@", "+x") }));
  assert.equal(deny.status, 0);
  const out = JSON.parse(deny.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.equal(out.hookSpecificOutput.permissionDecision, "deny");
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /^Blocked by the framework guard \(fs-write\): config\/permissions\.yaml is outside .*Codex cannot tell the guard which agent is calling/);
  assert.match(deny.stderr, /\(fs-write\)/);
  for (const t of ["apply_patch", "Bash", "update_plan", "view_image", "spawn_agent", "mcp__playwright__browser_click"]) {
    const r = hook(["--host", "codex"], cxPayload(t));
    assert.deepEqual([t, r.status, r.stdout, r.stderr], [t, 0, "", ""], "allowed: silent");
  }
  const unknown = hook(["--host", "codex"], cxPayload("computer_use", RO.root));
  assert.equal(unknown.status, 0);
  assert.equal(JSON.parse(unknown.stdout).hookSpecificOutput.permissionDecision, "deny", "readonly included (D-101)");
  assert.match(unknown.stderr, /\(unmapped-tool\): 'computer_use' is not a tool the guard knows on Codex/);
  const ro = hook(["--host", "codex"], cx_(RO.root, "Bash", { command: "curl -X POST https://app.acme.test/api/contacts" }));
  assert.match(ro.stderr, /\(http-mutate\)/);
  const { root } = startRun({ mode: "full-run", verified: false });
  const c = hook(["--host", "codex"], cx_(root, "Bash", { command: "node scripts/run.mjs guard-check acme" }));
  assert.deepEqual([c.status, JSON.parse(c.stdout).hookSpecificOutput.permissionDecision], [0, "deny"]);
  assert.match(c.stderr, /\(canary\)/);
  assert.deepEqual(readdirSync(path.join(root, "artifacts/acme/state/guard-check")), ["codex--unidentified.json"]);
  assert.equal(guardStatus("acme", "full-run", root).ready, true, "a host without identity is verified by any block (D-037)");
});

test("hook entry: a payload that isn't JSON during a run fails closed for Codex", () => {
  assert.equal(hook(["--host", "codex"], "not json", {}).status, 0, "no run is active in the hook's own cwd: allowed");
  const run = spawnSync(process.execPath, [path.join(frameworkRoot, "scripts", "hooks", "pretooluse.mjs"), "--host", "codex"], { input: "not json", cwd: FULL.root, encoding: "utf8", env: { PATH: process.env.PATH, ATF_WORKSPACE: FULL.root } });
  assert.equal(run.status, 0, "through the adapter, a guard error is a deny decision at exit 0, like every other verdict here");
  assert.match(run.stderr, /^Blocked by the framework guard \(guard-error\): the framework guard failed .* failing closed/);
  assert.equal(JSON.parse(run.stdout).hookSpecificOutput.permissionDecision, "deny");
  // and with no adapter module beside the entry, the entry's own fallback answers exit 2 with the reason on stderr
  const dir = path.join(tempRoot(), "scripts", "hooks");
  mkdirSync(dir, { recursive: true });
  const entry = path.join(dir, "pretooluse.mjs");
  copyFileSync(path.join(frameworkRoot, "scripts", "hooks", "pretooluse.mjs"), entry);
  const lone = spawnSync(process.execPath, [entry, "--host", "codex"], { input: "{}", cwd: FULL.root, encoding: "utf8", env: { PATH: process.env.PATH } });
  assert.equal(lone.status, 2);
  assert.match(lone.stderr, /^Blocked: the framework guard failed .* failing closed/);
  assert.equal(lone.stdout, "");
});

test("PostToolUse: Codex payloads run without error, remember nothing they shouldn't, and record a spawn", () => {
  const { root } = startRun({ mode: "full-run" });
  const post = (payload) => spawnSync(process.execPath, [path.join(frameworkRoot, "scripts", "hooks", "posttooluse.mjs"), "--host", "codex"], { input: JSON.stringify(payload), cwd: root, encoding: "utf8", env: { PATH: process.env.PATH } });
  for (const t of ["Bash", "exec_command", "apply_patch", "mcp__playwright__browser_click", "update_plan", "view_image", "computer_use"]) {
    const r = post({ ...cxPayload(t, root), hook_event_name: "PostToolUse", tool_response: { output: "ok" } });
    assert.deepEqual([t, r.status, r.stdout, r.stderr], [t, 0, "", ""]);
  }
  const spawn = post({ ...cxPayload("spawn_agent", root), hook_event_name: "PostToolUse", tool_response: { agent_id: "a1", duration_ms: 1234, usage: { total_tokens: 99 } } });
  assert.deepEqual([spawn.status, spawn.stdout, spawn.stderr], [0, "", ""]);
  // a response that is a string, or absent, never breaks the hook
  for (const tool_response of ["spawned agent a1", "", null, undefined, 7, ["x"]]) assert.equal(post({ ...cxPayload("spawn_agent", root), hook_event_name: "PostToolUse", tool_response }).status, 0);
  assert.ok(!existsSync(path.join(root, "artifacts", "hook-errors.jsonl")), "no error was logged");
  const lines = readSpawns(path.join(root, "artifacts", "acme", "state"), "acme-run-1");
  assert.ok(lines.length >= 1);
  assert.deepEqual([lines[0].host, lines[0].caller, lines[0].agent, lines[0].durationMs, lines[0].tokens], ["codex", null, "pw-ui-fixer", 1234, 99]);
  // garbage never blocks: the hook logs it and exits 0
  const bad = spawnSync(process.execPath, [path.join(frameworkRoot, "scripts", "hooks", "posttooluse.mjs"), "--host", "codex"], { input: "{", cwd: root, encoding: "utf8", env: { PATH: process.env.PATH } });
  assert.equal(bad.status, 0);
});

// A documented PreToolUse payload with a tool and its input, for the hook entry.
function cx_(root, tool_name, tool_input) {
  return { ...cxPayload("Bash", root), tool_name, tool_input };
}

test("Codex: relative names are judged from the session's directory too, so a session started in a subfolder can't reach atf/ by a relative name", () => {
  const sub = path.join(FULL.root, "atf");
  // a patch to `atf.json` from a session in atf/ writes atf/atf.json: judged as written and as resolved
  const p = call("apply_patch", { command: patch("*** Update File: atf.json", "@@", "-x", "+y") }, FULL.root, { cwd: sub });
  assert.deepEqual(p.paths, ["atf.json", path.join(sub, "atf.json")]);
  const verdict = check(p);
  assert.equal(verdict.allowed, false, JSON.stringify(verdict));
  // the same patch from the root is a different file (the root's atf.json), judged as before
  const fromRoot = call("apply_patch", { command: patch("*** Update File: atf.json", "@@", "-x", "+y") });
  assert.deepEqual(fromRoot.paths, ["atf.json", path.join(FULL.root, "atf.json")]);
  // a shell line's relative writes are read from the session directory and from its workdir, resolved from it
  const sh = call("Bash", { command: "echo x > atf.json", workdir: "." }, FULL.root, { cwd: sub });
  assert.deepEqual(sh.cwds, [sub, "."].filter((v, i, a) => a.indexOf(v) === i));
  assert.equal(check(sh).allowed, false, "echo into atf/atf.json from a session in atf/");
});
